import { prisma, type ProspectTarget } from "@guru/db";
import { assertConstraints } from "@guru/core";
import { OutreachDraftSchema, type GuruLlm } from "@guru/llm";
import { briefContext } from "./brief.js";
import { voiceContext } from "./voice.js";

/**
 * Persona-matched prospecting and assisted outreach — roadmap §2.3 and §2.4.
 *
 * Guru builds the list, drafts the message, and hands the user a deep link with
 * the draft ready to paste. A human taps send.
 *
 * There is deliberately no send function in this file, and there should never be
 * one. Connection requests and DMs have no sanctioned API path (§0.4); every
 * available alternative is session-cookie automation that risks the member's
 * account — the asset this product exists to grow. Assisted send gets most of
 * the throughput at none of that risk.
 */

/**
 * Identify who is worth connecting with.
 *
 * Sourced from the user's *existing* network — connections already scored as
 * strong persona matches whose relationship has never gone anywhere. That is a
 * genuinely warm list, and it needs no discovery API to build.
 */
export async function identifyProspects(
  userId: string,
  options: { limit?: number; minFit?: number } = {},
): Promise<ProspectTarget[]> {
  const minFit = options.minFit ?? 0.7;

  const roadmap = await prisma.roadmap.findFirst({
    where: { userId },
    orderBy: { version: "desc" },
    include: { elements: { orderBy: [{ phase: "asc" }, { order: "asc" }], take: 1 } },
  });

  const existing = await prisma.prospectTarget.findMany({
    where: { userId },
    select: { profileUrl: true, name: true },
  });
  const seen = new Set(existing.map((p) => (p.profileUrl ?? p.name).toLowerCase()));

  const candidates = await prisma.connection.findMany({
    where: { userId, personaFitScore: { gte: minFit } },
    orderBy: { personaFitScore: "desc" },
    take: (options.limit ?? 20) * 3,
    select: {
      firstName: true,
      lastName: true,
      company: true,
      position: true,
      profileUrl: true,
      personaFitScore: true,
      personaFitReason: true,
    },
  });

  const created: ProspectTarget[] = [];

  for (const c of candidates) {
    if (created.length >= (options.limit ?? 20)) break;

    const name = [c.firstName, c.lastName].filter(Boolean).join(" ");
    if (!name) continue;

    const key = (c.profileUrl ?? name).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    created.push(
      await prisma.prospectTarget.create({
        data: {
          userId,
          name,
          headline: c.position,
          company: c.company,
          profileUrl: c.profileUrl,
          roadmapElementId: roadmap?.elements[0]?.id ?? null,
          personaFit: c.personaFitScore,
          rationale: c.personaFitReason,
        },
      }),
    );
  }

  return created;
}

export interface AssistedSend {
  prospect: ProspectTarget;
  /** Opens the profile so the user can paste and send. */
  deepLink: string;
  message: string;
}

/**
 * Draft the message and return it with a deep link.
 *
 * The response is everything the user needs to send it themselves in two taps —
 * which is the entire design. Nothing here contacts LinkedIn.
 */
export async function draftOutreach(
  llm: GuruLlm,
  prospectId: string,
): Promise<AssistedSend> {
  const prospect = await prisma.prospectTarget.findUniqueOrThrow({ where: { id: prospectId } });

  const brief = await prisma.strategicBrief.findFirst({
    where: { userId: prospect.userId, supersededById: null },
    orderBy: { version: "desc" },
  });
  if (!brief) throw new Error("No brief — outreach without a strategy behind it is spam.");

  const { value, generationId } = await llm.structured(
    {
      userId: prospect.userId,
      purpose: "outreach.draft",
      promptName: "outreach.draft",
      promptVersion: "1.0.0",
      system: OUTREACH_SYSTEM,
      prompt: `WHO YOU ARE
${briefContext(brief)}

HOW YOU WRITE
${await voiceContext(prospect.userId)}

WHO YOU ARE MESSAGING
${prospect.name}${prospect.headline ? ` — ${prospect.headline}` : ""}${prospect.company ? ` at ${prospect.company}` : ""}
Why they matter: ${prospect.rationale ?? "strong persona match"}

They are already a first-degree connection, so this is a re-open, not a cold
introduction. Write the message.`,
      effort: "medium",
      auditInputs: { prospectId, personaFit: prospect.personaFit, briefVersion: brief.version },
    },
    OutreachDraftSchema,
  );

  assertConstraints(value.message, {
    neverSay: brief.neverSay,
    complianceFlags: brief.complianceFlags,
  });

  const updated = await prisma.prospectTarget.update({
    where: { id: prospectId },
    data: { draftMessage: value.message, status: "DRAFTED", generationId },
  });

  return {
    prospect: updated,
    deepLink: prospect.profileUrl ?? `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(prospect.name)}`,
    message: value.message,
  };
}

const OUTREACH_SYSTEM = `You draft a short LinkedIn message from one person to another.

The recipient is a real person who will read this in a crowded inbox next to a
dozen templated pitches. What separates yours is that it could only have been
written to them.

- Two to four sentences. Longer reads as a pitch.
- Reference something specific and true about them or their situation.
- Make one clear, small ask — a reply, not a call, not a calendar link.
- No flattery openers, no "I noticed you're in [industry]", no "quick question".
- Their voice, including its unpolished parts.

Return the message and one sentence on why this person is worth reaching.`;

/** The user reports having sent it — the only way we can know. */
export async function markSent(prospectId: string): Promise<ProspectTarget> {
  return prisma.prospectTarget.update({
    where: { id: prospectId },
    data: { status: "SENT_BY_USER", sentAt: new Date() },
  });
}

export async function dismissProspect(prospectId: string): Promise<ProspectTarget> {
  return prisma.prospectTarget.update({
    where: { id: prospectId },
    data: { status: "DISMISSED", dismissedAt: new Date() },
  });
}

export async function prospectQueue(userId: string, limit = 25) {
  return prisma.prospectTarget.findMany({
    where: { userId, status: { in: ["IDENTIFIED", "DRAFTED"] } },
    orderBy: { personaFit: "desc" },
    take: limit,
  });
}
