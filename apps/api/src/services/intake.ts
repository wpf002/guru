import { prisma, type IntakeArea, type Prisma } from "@guru/db";
import {
  INTAKE_FRAMEWORK,
  analyzeNetwork,
  analyzeVoice,
  areaDefinition,
  formatStats,
  isSlotComplete,
  nextArea,
  postingCadence,
} from "@guru/core";
import { CURRENT, render } from "@guru/prompts";
import { IntakeFollowupSchema, type GuruLlm } from "@guru/llm";

/**
 * The intake state machine — roadmap §1.2.
 *
 * "Preset framework, adaptive within it." The framework owns the state machine:
 * which area is open, which criteria are still unmet, when to advance. The model
 * owns the path through it — what to ask next and how to read the answer.
 *
 * The split matters because it is what stops the conversation wandering while
 * still letting it follow up like a consultant rather than a form. The model
 * never decides it's done with an area; it reports which criteria an answer
 * satisfied, and `isSlotComplete` decides.
 */

export interface TurnResult {
  sessionId: string;
  area: IntakeArea | null;
  question: string | null;
  complete: boolean;
  progress: { area: IntakeArea; complete: boolean; seeded: boolean }[];
}

/**
 * Opens a session with areas 2 and 5 pre-populated from the archive, so intake
 * is a conversation between informed parties rather than an interrogation.
 */
export async function startIntake(userId: string): Promise<TurnResult> {
  const existing = await prisma.intakeSession.findFirst({
    where: { userId, status: "IN_PROGRESS" },
    orderBy: { lastActiveAt: "desc" },
  });
  // Resumable across sittings — an abandoned tab should not cost the user their
  // answers.
  if (existing) return summarize(existing.id);

  const snapshot = await prisma.archiveSnapshot.findFirst({
    where: { userId, status: { in: ["FIRST_INSTALLMENT_INGESTED", "COMPLETE"] } },
    orderBy: { requestedAt: "desc" },
    select: { id: true },
  });

  const seeds = snapshot ? await buildSeeds(userId, snapshot.id) : {};

  const session = await prisma.intakeSession.create({
    data: {
      userId,
      seededFromSnapshotId: snapshot?.id ?? null,
      slots: {
        create: INTAKE_FRAMEWORK.map((area) => ({
          area: area.area,
          criteria: area.criteria as unknown as Prisma.InputJsonValue,
          seeded: Boolean(seeds[area.area]),
          data: (seeds[area.area] ?? undefined) as Prisma.InputJsonValue | undefined,
        })),
      },
    },
  });

  return summarize(session.id);
}

type Seeds = Partial<Record<IntakeArea, Record<string, unknown>>>;

async function buildSeeds(userId: string, snapshotId: string): Promise<Seeds> {
  const [connections, shares, comments, invitations] = await Promise.all([
    prisma.connection.findMany({
      where: { snapshotId },
      select: { connectedOn: true, personaFitScore: true, company: true, position: true },
    }),
    prisma.shareRecord.findMany({
      where: { userId },
      select: { publishedAt: true, content: true },
    }),
    prisma.commentRecord.findMany({
      where: { userId },
      select: { message: true },
      take: 500,
    }),
    prisma.invitationRecord.findMany({
      where: { userId },
      select: { direction: true, status: true },
    }),
  ]);

  const seeds: Seeds = {};

  if (connections.length > 0 || shares.length > 0) {
    const network = analyzeNetwork(connections);
    const cadence = postingCadence(shares);
    const topCompanies = topValues(connections.map((c) => c.company));

    seeds.WHERE_THEY_ARE_TODAY = {
      networkSize: network.connectionCount,
      networkDensity: network.density,
      topCompanies,
      topTitles: topValues(connections.map((c) => c.position)),
      postsTotal: cadence.totalPosts,
      postsPerWeek: cadence.postsPerWeek,
      longestGapDays: cadence.longestGapDays,
      lastPostedAt: cadence.lastPostedAt,
      invitationsSent: invitations.filter((i) => i.direction?.toUpperCase() === "OUTGOING")
        .length,
    };
  }

  const corpus = [
    ...comments.map((c) => c.message ?? ""),
    ...shares.map((s) => s.content ?? ""),
  ].filter(Boolean);

  if (corpus.length > 0) {
    // The voice half of area 5 is already answered by their real writing; what
    // intake still needs from them is the hard limits.
    seeds.VOICE_AND_CONSTRAINTS = { voiceStats: formatStats(analyzeVoice(corpus)) };
  }

  return seeds;
}

function topValues(values: (string | null)[], limit = 8): string[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = value?.trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value, count]) => `${value} (${count})`);
}

/**
 * One turn: record the user's answer, ask the model what it established and what
 * to ask next, then let the framework decide whether to advance.
 */
export async function submitAnswer(
  llm: GuruLlm,
  sessionId: string,
  userMessage: string | null,
): Promise<TurnResult> {
  const session = await prisma.intakeSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: { slots: true, turns: { orderBy: { index: "asc" } } },
  });

  if (session.status !== "IN_PROGRESS") return summarize(sessionId);

  const area = nextArea(session.slots.map((s) => ({ area: s.area, complete: s.complete })));
  if (!area) {
    await prisma.intakeSession.update({
      where: { id: sessionId },
      data: { status: "COMPLETE", completedAt: new Date() },
    });
    return summarize(sessionId);
  }

  let turns = session.turns;
  if (userMessage) {
    const turn = await prisma.intakeTurn.create({
      data: {
        sessionId,
        index: turns.length,
        role: "user",
        content: userMessage,
        area,
      },
    });
    turns = [...turns, turn];
  }

  const slot = session.slots.find((s) => s.area === area)!;
  const definition = areaDefinition(area);
  const met = new Set(slot.metCriteria);
  const open = definition.criteria.filter((c) => !met.has(c.key));

  const prompt = render(CURRENT.intakeFollowup, {
    areaTitle: definition.title,
    areaIntent: definition.intent,
    openCriteria: open.map((c) => `- ${c.key}: ${c.description}`).join("\n"),
    seededContext: slot.data ? JSON.stringify(slot.data, null, 2) : "(nothing seeded)",
    transcript:
      turns.map((t) => `${t.role.toUpperCase()}: ${t.content}`).join("\n\n") ||
      "(no messages yet)",
  });

  const { value, generationId } = await llm.structured(
    {
      userId: session.userId,
      purpose: "intake.followup",
      promptName: CURRENT.intakeFollowup.name,
      promptVersion: CURRENT.intakeFollowup.version,
      system: INTAKE_SYSTEM,
      prompt,
      effort: "medium",
      auditInputs: { sessionId, area, openCriteria: open.map((c) => c.key) },
    },
    IntakeFollowupSchema,
  );

  // The model reports what it established; the framework decides whether that's
  // enough. Accepting `areaComplete` directly would let a persuasive answer
  // close an area with its required criteria still open.
  const validKeys = new Set(definition.criteria.map((c) => c.key));
  const newlyMet = value.satisfiedCriteria.filter((key) => validKeys.has(key));
  const allMet = [...new Set([...slot.metCriteria, ...newlyMet])];
  const complete = isSlotComplete(area, allMet);

  await prisma.intakeSlot.update({
    where: { id: slot.id },
    data: {
      metCriteria: allMet,
      complete,
      completedAt: complete ? new Date() : null,
      data: {
        ...((slot.data as Record<string, unknown> | null) ?? {}),
        ...value.extracted,
      } as Prisma.InputJsonValue,
    },
  });

  if (!complete) {
    await prisma.intakeTurn.create({
      data: {
        sessionId,
        index: turns.length,
        role: "assistant",
        content: value.question,
        area,
        generationId,
      },
    });
    return { ...(await summarize(sessionId)), area, question: value.question };
  }

  // Area closed — immediately open the next one so the user never sees a turn
  // with nothing to answer.
  return submitAnswer(llm, sessionId, null);
}

const INTAKE_SYSTEM = `You are a go-to-market strategist running a structured consulting intake.

You work one area at a time within a fixed framework. You do not choose when an
area is finished — you report which completion criteria the conversation has
satisfied, and the system decides.

Be a consultant, not a form. Follow up on vague answers. Use what you already
know from their LinkedIn archive rather than asking them to recite it.`;

async function summarize(sessionId: string): Promise<TurnResult> {
  const session = await prisma.intakeSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: {
      slots: true,
      turns: { orderBy: { index: "desc" }, take: 1 },
    },
  });

  const progress = INTAKE_FRAMEWORK.map((a) => {
    const slot = session.slots.find((s) => s.area === a.area);
    return {
      area: a.area as IntakeArea,
      complete: slot?.complete ?? false,
      seeded: slot?.seeded ?? false,
    };
  });

  const open = nextArea(progress);
  const last = session.turns[0];

  return {
    sessionId,
    area: open,
    question: last?.role === "assistant" ? last.content : null,
    complete: session.status === "COMPLETE",
    progress,
  };
}
