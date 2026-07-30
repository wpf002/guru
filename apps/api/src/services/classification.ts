import { prisma, type AudienceAxis } from "@guru/db";
import { AudienceAxisSchema, type GuruLlm } from "@guru/llm";
import { briefContext } from "./brief.js";

/**
 * Customer / operator classification — the Phase 1 hedge for Phase 3 (§5).
 *
 * Phase 3 is direction, not spec: once a user has real authority, the engine
 * should be able to tell the people who want to *buy* from the people who want
 * to *do what they do*, and surface that as a strategic opportunity.
 *
 * That distinction needs labeled data, and labeled data needs time. Classifying
 * inbound now costs almost nothing and is the difference between Phase 3
 * starting with a year of history and starting cold. Nothing reads these labels
 * yet — that is the point.
 */

const BATCH = 40;

export async function classifyAudience(
  llm: GuruLlm,
  userId: string,
  options: { limit?: number } = {},
): Promise<{ classified: number; distribution: Record<AudienceAxis, number> }> {
  const brief = await prisma.strategicBrief.findFirst({
    where: { userId, supersededById: null },
    orderBy: { version: "desc" },
  });
  if (!brief) throw new Error("Classification needs the brief — it defines who a customer is.");

  const alreadyClassified = await prisma.audienceSignal.findMany({
    where: { userId },
    select: { subjectUrl: true, subjectName: true },
  });
  const seen = new Set(
    alreadyClassified.map((s) => (s.subjectUrl ?? s.subjectName).toLowerCase()),
  );

  // Highest-fit connections first: they are the ones the distinction actually
  // matters for, and classifying a 10,000-person network wholesale would cost
  // more than the answer is worth this early.
  const candidates = (
    await prisma.connection.findMany({
      where: { userId, personaFitScore: { not: null } },
      orderBy: { personaFitScore: "desc" },
      take: options.limit ?? 200,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        company: true,
        position: true,
        profileUrl: true,
      },
    })
  ).filter((c) => {
    const name = [c.firstName, c.lastName].filter(Boolean).join(" ");
    return name && !seen.has((c.profileUrl ?? name).toLowerCase());
  });

  const distribution: Record<AudienceAxis, number> = {
    CUSTOMER: 0,
    OPERATOR: 0,
    PEER: 0,
    UNKNOWN: 0,
  };
  let classified = 0;

  for (let i = 0; i < candidates.length; i += BATCH) {
    const batch = candidates.slice(i, i + BATCH);

    for (const person of batch) {
      const name = [person.firstName, person.lastName].filter(Boolean).join(" ");
      const evidence = `${name} — ${person.position ?? "no title"} at ${person.company ?? "no company"}`;

      const { value, generationId } = await llm.structured(
        {
          userId,
          purpose: "audience.classify",
          promptName: "audience.classify",
          promptVersion: "1.0.0",
          system: CLASSIFY_SYSTEM(briefContext(brief)),
          prompt: `Classify this person:\n${evidence}`,
          effort: "low",
          maxTokens: 2000,
          auditInputs: { connectionId: person.id, briefVersion: brief.version },
        },
        AudienceAxisSchema,
      );

      await prisma.audienceSignal.create({
        data: {
          userId,
          subjectName: name,
          subjectUrl: person.profileUrl,
          connectionId: person.id,
          axis: value.axis,
          confidence: value.confidence,
          reason: value.reason,
          evidence,
          generationId,
        },
      });

      distribution[value.axis]++;
      classified++;
    }
  }

  return { classified, distribution };
}

const CLASSIFY_SYSTEM = (brief: string) => `You classify people in a user's LinkedIn network along one axis: are they a potential customer, a potential operator, a peer, or unknown?

${brief}

CUSTOMER — plausibly buys what this user sells.
OPERATOR — plausibly wants to *do what this user does*, and could be recruited,
  funded, or trained to replicate the model rather than buy the output.
PEER — a competitor or fellow practitioner, neither buyer nor recruitable.
UNKNOWN — the title and company genuinely do not say.

Use UNKNOWN freely. A confident wrong label is worse than an honest blank: these
labels are being accumulated to inform a business-model decision later, and a
dataset padded with guesses will not support one.`;

/** What the accumulated labels look like so far. */
export async function audienceBreakdown(userId: string) {
  const signals = await prisma.audienceSignal.groupBy({
    by: ["axis"],
    where: { userId },
    _count: { _all: true },
    _avg: { confidence: true },
  });

  const total = signals.reduce((sum, s) => sum + s._count._all, 0);

  return {
    total,
    byAxis: signals.map((s) => ({
      axis: s.axis,
      count: s._count._all,
      share: total > 0 ? s._count._all / total : 0,
      averageConfidence: s._avg.confidence,
    })),
    // Phase 3 is not built. This endpoint exists so that when it is, the data
    // is already there.
    note: "Phase 3 is direction, not spec. These labels are accumulating for a decision that has not been made yet.",
  };
}
