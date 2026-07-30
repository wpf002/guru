/**
 * Confidence scoring — roadmap §1.7.
 *
 * Per-category from day one (§0.7), so one weak category cannot drag the whole
 * system's trust down with it.
 *
 * Two properties matter more than the exact curve:
 *
 *   1. Recency weighting. A user who rejected everything in week one and approves
 *      everything now is a system that learned, and the score should say so.
 *   2. A minimum sample size. Below it the score is `null`, not zero — "not
 *      enough data yet" and "you keep rejecting these" are different statements
 *      and the dashboard must not conflate them.
 */

export const CONFIDENCE_CATEGORIES = [
  "TOPIC",
  "ANGLE",
  "TONE",
  "FORMAT",
  "CADENCE",
  "ENGAGEMENT_TARGET",
] as const;

export type ConfidenceCategory = (typeof CONFIDENCE_CATEGORIES)[number];

export interface DecisionInput {
  type: "APPROVE" | "REJECT" | "EDIT";
  createdAt: Date;
}

export interface ScoreResult {
  /** Null until `sampleSize >= minSampleSize`. */
  score: number | null;
  sampleSize: number;
  meetsThreshold: boolean;
}

export interface ScoreOptions {
  minSampleSize?: number;
  /** Days after which a decision carries half its original weight. */
  halfLifeDays?: number;
  /** §1.10 surfaces the autonomy prompt at sustained ~90–95%. */
  threshold?: number;
  /** Injected so scoring is deterministic under test. */
  now?: Date;
}

const DEFAULTS = {
  minSampleSize: 20,
  halfLifeDays: 45,
  threshold: 0.9,
};

/**
 * An edit is neither an approval nor a rejection: the user kept the idea and
 * changed the execution. Counting it as approval overstates confidence; counting
 * it as rejection means a system that is nearly right never earns trust. Half.
 */
function outcomeValue(type: DecisionInput["type"]): number {
  switch (type) {
    case "APPROVE":
      return 1;
    case "EDIT":
      return 0.5;
    case "REJECT":
      return 0;
  }
}

export function scoreCategory(
  decisions: readonly DecisionInput[],
  options: ScoreOptions = {},
): ScoreResult {
  const minSampleSize = options.minSampleSize ?? DEFAULTS.minSampleSize;
  const halfLifeDays = options.halfLifeDays ?? DEFAULTS.halfLifeDays;
  const threshold = options.threshold ?? DEFAULTS.threshold;
  const now = options.now ?? new Date();

  const sampleSize = decisions.length;
  if (sampleSize < minSampleSize) {
    return { score: null, sampleSize, meetsThreshold: false };
  }

  const msPerDay = 86_400_000;
  let weighted = 0;
  let totalWeight = 0;

  for (const d of decisions) {
    const ageDays = Math.max(0, (now.getTime() - d.createdAt.getTime()) / msPerDay);
    const weight = Math.pow(0.5, ageDays / halfLifeDays);
    weighted += outcomeValue(d.type) * weight;
    totalWeight += weight;
  }

  // Every decision older than ~50 half-lives underflows to zero weight. Rare,
  // but a divide-by-zero here would surface as a NaN score on the dashboard.
  if (totalWeight === 0) {
    return { score: null, sampleSize, meetsThreshold: false };
  }

  const score = weighted / totalWeight;
  return { score, sampleSize, meetsThreshold: score >= threshold };
}

/**
 * §1.10 — the autonomy prompt fires only when *every* scored category sustains
 * the threshold. In Phase 1 this records intent and gates nothing; it exists now
 * so the threshold mechanic is validated against real data before autonomy ever
 * attaches to it.
 */
export function readyForAutonomyPrompt(
  scores: ReadonlyMap<ConfidenceCategory, ScoreResult>,
): boolean {
  const scored = [...scores.values()].filter((s) => s.score !== null);
  if (scored.length < CONFIDENCE_CATEGORIES.length) return false;
  return scored.every((s) => s.meetsThreshold);
}
