import { prisma, type ConfidenceCategory, type DecisionType } from "@guru/db";
import {
  CONFIDENCE_CATEGORIES,
  readyForAutonomyPrompt,
  scoreCategory,
  type ConfidenceCategory as PromptCategory,
  type ScoreResult,
} from "@guru/core";

/**
 * Approve/reject and the confidence score — roadmap §1.7.
 *
 * Two things make this trustworthy rather than decorative: the score is
 * per-category, so one weak dimension cannot drag the rest down, and every
 * movement is logged against the decision that caused it. The dashboard reads
 * from that log — trust is earned transparently or not at all.
 */

export interface DecisionInput {
  userId: string;
  type: DecisionType;
  category: ConfidenceCategory;
  contentDraftId?: string;
  engagementDraftId?: string;
  reason?: string;
  reasonCodes?: string[];
  /** Phase 3 hedge (§5) — classify inbound from day one. */
  audienceAxis?: string;
}

export async function recordDecision(input: DecisionInput) {
  if (!input.contentDraftId && !input.engagementDraftId) {
    throw new Error("A decision must reference a content draft or an engagement draft.");
  }

  const decision = await prisma.decision.create({
    data: {
      userId: input.userId,
      type: input.type,
      category: input.category,
      contentDraftId: input.contentDraftId ?? null,
      engagementDraftId: input.engagementDraftId ?? null,
      reason: input.reason ?? null,
      reasonCodes: input.reasonCodes ?? [],
      audienceAxis: input.audienceAxis ?? null,
    },
  });

  // The decision drives the artifact's status only on the primary category, so
  // rejecting the tone of a post doesn't silently kill it five times over as
  // each category is scored.
  if (input.type !== "EDIT") {
    const status = input.type === "APPROVE" ? "APPROVED" : "REJECTED";
    if (input.contentDraftId) {
      await prisma.contentDraft.updateMany({
        where: { id: input.contentDraftId, status: { in: ["DRAFT", "IN_REFINEMENT"] } },
        data: { status },
      });
    }
    if (input.engagementDraftId) {
      await prisma.engagementDraft.updateMany({
        where: { id: input.engagementDraftId, status: { in: ["DRAFT", "IN_REFINEMENT"] } },
        data: { status },
      });
    }
  }

  await recomputeCategory(input.userId, input.category, decision.id);
  return decision;
}

async function recomputeCategory(
  userId: string,
  category: ConfidenceCategory,
  decisionId: string,
) {
  const decisions = await prisma.decision.findMany({
    where: { userId, category },
    select: { type: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const existing = await prisma.confidenceScore.findUnique({
    where: { userId_category: { userId, category } },
  });

  const result = scoreCategory(decisions, {
    minSampleSize: existing?.minSampleSize ?? 20,
  });

  const score = await prisma.confidenceScore.upsert({
    where: { userId_category: { userId, category } },
    update: { score: result.score, sampleSize: result.sampleSize },
    create: {
      userId,
      category,
      score: result.score,
      sampleSize: result.sampleSize,
    },
  });

  await prisma.confidenceEvent.create({
    data: {
      scoreId: score.id,
      userId,
      decisionId,
      fromScore: existing?.score ?? null,
      toScore: result.score,
      sampleSize: result.sampleSize,
    },
  });

  return result;
}

export interface Dashboard {
  categories: {
    category: ConfidenceCategory;
    score: number | null;
    sampleSize: number;
    minSampleSize: number;
    meetsThreshold: boolean;
    /** Why the score is null, in words the user can act on. */
    note: string | null;
  }[];
  /**
   * Tracked and shown, but deliberately excluded from the autonomy prompt.
   * Outreach is never autonomous (§0.4, §2.5), so requiring it to clear a
   * threshold would mean the prompt could never fire.
   */
  outreach: { score: number | null; sampleSize: number } | null;
  readyForAutonomyPrompt: boolean;
  recentMovements: {
    createdAt: Date;
    category: ConfidenceCategory;
    fromScore: number | null;
    toScore: number | null;
  }[];
}

/** The §1.7 dashboard. Visible to the user, by design. */
export async function confidenceDashboard(userId: string): Promise<Dashboard> {
  const stored = await prisma.confidenceScore.findMany({
    where: { userId },
    include: {
      history: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });

  const byCategory = new Map(stored.map((s) => [s.category, s]));
  // Keyed on the six categories the §1.10 prompt considers, not on every value
  // the database can hold.
  const scoreMap = new Map<PromptCategory, ScoreResult>();

  const categories = CONFIDENCE_CATEGORIES.map((category) => {
    const row = byCategory.get(category);
    const sampleSize = row?.sampleSize ?? 0;
    const minSampleSize = row?.minSampleSize ?? 20;
    const score = row?.score ?? null;
    const meetsThreshold = score !== null && score >= 0.9;

    scoreMap.set(category, { score, sampleSize, meetsThreshold });

    return {
      category,
      score,
      sampleSize,
      minSampleSize,
      meetsThreshold,
      note:
        score === null
          ? `Not enough data yet — ${minSampleSize - sampleSize} more decisions needed.`
          : null,
    };
  });

  const recentMovements = stored
    .flatMap((s) =>
      s.history.map((h) => ({
        createdAt: h.createdAt,
        category: s.category,
        fromScore: h.fromScore,
        toScore: h.toScore,
      })),
    )
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 20);

  const outreachRow = byCategory.get("OUTREACH");

  return {
    categories,
    outreach: outreachRow
      ? { score: outreachRow.score, sampleSize: outreachRow.sampleSize }
      : null,
    readyForAutonomyPrompt: readyForAutonomyPrompt(scoreMap),
    recentMovements,
  };
}

/**
 * The §1.10 threshold prompt.
 *
 * In Phase 1 this records intent and gates nothing — deliberately. The point is
 * to validate the threshold mechanic against real approval data *before*
 * autonomy attaches to it, so that when Phase 2 turns it on, the number it
 * depends on has already been observed to mean something.
 */
export async function autonomyPromptState(userId: string) {
  const dashboard = await confidenceDashboard(userId);
  return {
    ready: dashboard.readyForAutonomyPrompt,
    message: dashboard.readyForAutonomyPrompt
      ? "I'm ready to run more independently — want to enable that?"
      : null,
    // Stated plainly so nobody reads this as autonomy already being live.
    gatesNothing: true,
    categories: dashboard.categories,
  };
}
