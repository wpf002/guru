import { prisma, type Prisma, type StrategicBrief } from "@guru/db";
import { analyzeNetwork, formatStats, analyzeVoice, postingCadence } from "@guru/core";
import { CURRENT, render } from "@guru/prompts";
import { BriefSchema, type GuruLlm } from "@guru/llm";

/**
 * The strategic brief — roadmap §1.3.
 *
 * Versioned and user-editable. Re-running intake creates v2; nothing
 * overwrites. That is not filing-cabinet tidiness: every roadmap, draft, and
 * comment traces back to the brief version that produced it, so overwriting one
 * would rewrite the explanation for work that already shipped.
 *
 * The never-say list and compliance flags recorded here become hard filters in
 * packages/core/src/constraints.ts — enforced on generated output in code, not
 * as prompt suggestions.
 */

export async function synthesizeBrief(
  llm: GuruLlm,
  sessionId: string,
): Promise<StrategicBrief> {
  const session = await prisma.intakeSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: { slots: true, turns: { orderBy: { index: "asc" } } },
  });

  if (session.status !== "COMPLETE") {
    throw new Error("Intake is not complete — finish the remaining areas before synthesizing.");
  }

  const existing = await prisma.strategicBrief.findUnique({ where: { sessionId } });
  if (existing) return existing;

  const archiveSummary = await summarizeArchive(session.userId);

  const prompt = render(CURRENT.briefSynthesize, {
    transcript: session.turns
      .map((t) => `${t.role.toUpperCase()}: ${t.content}`)
      .join("\n\n"),
    archiveSummary,
  });

  const { value } = await llm.structured(
    {
      userId: session.userId,
      purpose: "brief.synthesize",
      promptName: CURRENT.briefSynthesize.name,
      promptVersion: CURRENT.briefSynthesize.version,
      system: BRIEF_SYSTEM,
      prompt,
      effort: "high",
      auditInputs: {
        sessionId,
        slots: session.slots.map((s) => ({ area: s.area, data: s.data })),
      },
    },
    BriefSchema,
  );

  const previous = await prisma.strategicBrief.findFirst({
    where: { userId: session.userId },
    orderBy: { version: "desc" },
    select: { id: true, version: true },
  });

  const voiceSummary = await currentVoiceSummary(session.userId);

  const brief = await prisma.strategicBrief.create({
    data: {
      userId: session.userId,
      version: (previous?.version ?? 0) + 1,
      sessionId,
      role: value.role,
      industry: value.industry,
      niche: value.niche,
      subNiche: value.subNiche,
      offer: value.offer,
      currentState: value.currentState as Prisma.InputJsonValue,
      targetState: value.targetState as Prisma.InputJsonValue,
      persona: value.persona as Prisma.InputJsonValue,
      voiceProfileSummary: voiceSummary,
      neverSay: value.neverSay,
      complianceFlags: value.complianceFlags,
    },
  });

  if (previous) {
    await prisma.strategicBrief.update({
      where: { id: previous.id },
      data: { supersededById: brief.id },
    });
  }

  return brief;
}

const BRIEF_SYSTEM = `You turn a consulting intake into a structured strategic brief.

The brief is shown back to the user and drives every downstream artifact, so it
must sound like them, not like a consultant's summary of them.

Persona signals must be observable on a LinkedIn profile — they are used to score
a connection list, so anything unobservable is dead weight.

The never-say list becomes a hard filter on generated output. Include only what
they actually said they will not say; do not invent cautious-sounding additions.`;

/**
 * User edits are first-class (§1.3). Editing marks the brief so the confidence
 * layer can tell an accepted brief from a corrected one.
 */
export async function editBrief(
  briefId: string,
  patch: Partial<{
    role: string;
    industry: string;
    niche: string;
    subNiche: string;
    offer: string;
    neverSay: string[];
    complianceFlags: string[];
    persona: unknown;
    targetState: unknown;
  }>,
): Promise<StrategicBrief> {
  return prisma.strategicBrief.update({
    where: { id: briefId },
    data: {
      ...patch,
      persona: patch.persona as Prisma.InputJsonValue | undefined,
      targetState: patch.targetState as Prisma.InputJsonValue | undefined,
      editedByUser: true,
    },
  });
}

/** The brief every downstream generation reads. */
export async function activeBrief(userId: string): Promise<StrategicBrief | null> {
  return prisma.strategicBrief.findFirst({
    where: { userId, supersededById: null },
    orderBy: { version: "desc" },
  });
}

/** Rendered into every generation's system prefix — kept stable for caching. */
export function briefContext(brief: StrategicBrief): string {
  return [
    `Role: ${brief.role ?? "unknown"}`,
    `Industry: ${brief.industry ?? "unknown"}`,
    `Niche: ${brief.niche ?? "unknown"} / ${brief.subNiche ?? "unknown"}`,
    `Offer: ${brief.offer ?? "unknown"}`,
    `Target state: ${JSON.stringify(brief.targetState)}`,
    `Target persona: ${JSON.stringify(brief.persona)}`,
    brief.neverSay.length > 0 ? `Never say: ${brief.neverSay.join(", ")}` : "",
    brief.complianceFlags.length > 0
      ? `Compliance flags: ${brief.complianceFlags.join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function summarizeArchive(userId: string): Promise<string> {
  const [connections, shares, invitations] = await Promise.all([
    prisma.connection.findMany({
      where: { userId },
      select: { company: true, position: true, personaFitScore: true },
      take: 20000,
    }),
    prisma.shareRecord.findMany({
      where: { userId },
      select: { publishedAt: true, content: true },
    }),
    prisma.invitationRecord.findMany({
      where: { userId },
      select: { direction: true, status: true },
    }),
  ]);

  if (connections.length === 0 && shares.length === 0) {
    return "No archive has been ingested yet.";
  }

  const network = analyzeNetwork(connections);
  const cadence = postingCadence(shares);
  const sent = invitations.filter((i) => i.direction?.toUpperCase() === "OUTGOING").length;

  return [
    `Connections: ${network.connectionCount} (${network.density.toLowerCase()})`,
    `Posts: ${cadence.totalPosts}${
      cadence.postsPerWeek ? `, ~${cadence.postsPerWeek.toFixed(1)}/week` : ""
    }${cadence.longestGapDays ? `, longest gap ${Math.round(cadence.longestGapDays)} days` : ""}`,
    `Invitations sent: ${sent}`,
    shares[0]?.content
      ? `Most recent post opens: "${shares[shares.length - 1]?.content?.slice(0, 160)}"`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function currentVoiceSummary(userId: string): Promise<string | null> {
  const profile = await prisma.voiceProfile.findFirst({
    where: { userId, active: true },
    orderBy: { version: "desc" },
    select: { summary: true },
  });
  if (profile?.summary) return profile.summary;

  // No modeled profile yet — the raw statistics are still better than nothing,
  // and they're what the voice model would be built from anyway.
  const [comments, shares] = await Promise.all([
    prisma.commentRecord.findMany({ where: { userId }, select: { message: true }, take: 500 }),
    prisma.shareRecord.findMany({ where: { userId }, select: { content: true }, take: 500 }),
  ]);
  const corpus = [
    ...comments.map((c) => c.message ?? ""),
    ...shares.map((s) => s.content ?? ""),
  ].filter(Boolean);

  return corpus.length > 0 ? formatStats(analyzeVoice(corpus)) : null;
}
