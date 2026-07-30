/**
 * Engagement target priority scoring — roadmap §1.6.
 *
 * Which posts are worth showing up in the comments of, given author fit,
 * audience overlap, and freshness.
 *
 * Freshness dominates more than it first appears it should. A perfect comment on
 * a four-day-old post is invisible: LinkedIn's feed has moved on, and the point
 * of commenting is to be seen by the author's audience while they are still
 * looking at it. So freshness is a multiplier over the fit terms rather than a
 * third weighted addend — a stale post scores near zero however good the author
 * is.
 */

export interface ScoringInput {
  /** How well the post's author matches the people the user needs to reach. 0–1. */
  authorFit: number;
  /** Overlap between the author's audience and the user's target persona. 0–1. */
  audienceOverlap: number;
  postedAt: Date;
}

export interface PriorityScore {
  score: number;
  authorFit: number;
  audienceOverlap: number;
  freshness: number;
  rationale: string;
}

export interface ScoringOptions {
  /** Hours after which freshness has halved. LinkedIn's feed is roughly daily. */
  freshnessHalfLifeHours?: number;
  authorFitWeight?: number;
  audienceOverlapWeight?: number;
  now?: Date;
}

const DEFAULTS = {
  freshnessHalfLifeHours: 18,
  authorFitWeight: 0.6,
  audienceOverlapWeight: 0.4,
};

export function scoreTarget(
  input: ScoringInput,
  options: ScoringOptions = {},
): PriorityScore {
  const halfLife = options.freshnessHalfLifeHours ?? DEFAULTS.freshnessHalfLifeHours;
  const wAuthor = options.authorFitWeight ?? DEFAULTS.authorFitWeight;
  const wAudience = options.audienceOverlapWeight ?? DEFAULTS.audienceOverlapWeight;
  const now = options.now ?? new Date();

  const authorFit = clamp01(input.authorFit);
  const audienceOverlap = clamp01(input.audienceOverlap);

  // A post dated in the future (timezone skew in a scraped date) is treated as
  // brand new rather than allowed to score above 1.
  const ageHours = Math.max(0, (now.getTime() - input.postedAt.getTime()) / 3_600_000);
  const freshness = Math.pow(0.5, ageHours / halfLife);

  const fit = (authorFit * wAuthor + audienceOverlap * wAudience) / (wAuthor + wAudience);
  const score = fit * freshness;

  return {
    score,
    authorFit,
    audienceOverlap,
    freshness,
    rationale: buildRationale(authorFit, audienceOverlap, freshness, ageHours),
  };
}

function buildRationale(
  authorFit: number,
  audienceOverlap: number,
  freshness: number,
  ageHours: number,
): string {
  const parts: string[] = [];
  parts.push(
    authorFit >= 0.7
      ? "Author is squarely in the target persona."
      : authorFit >= 0.4
        ? "Author is adjacent to the target persona."
        : "Author is a weak persona match.",
  );
  parts.push(
    audienceOverlap >= 0.5
      ? "Their audience overlaps meaningfully with the people we need to reach."
      : "Limited audience overlap.",
  );
  if (freshness < 0.15) {
    parts.push(
      `Posted ${Math.round(ageHours)}h ago — the feed has moved on, so a comment here will mostly go unseen.`,
    );
  } else if (freshness > 0.7) {
    parts.push("Still fresh — comments here will be seen.");
  }
  return parts.join(" ");
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** Rank and cut. Below `minScore` a post is not worth the user's approval time. */
export function rankTargets<T>(
  items: readonly { item: T; input: ScoringInput }[],
  options: ScoringOptions & { minScore?: number; limit?: number } = {},
): { item: T; priority: PriorityScore }[] {
  const minScore = options.minScore ?? 0.15;
  return items
    .map(({ item, input }) => ({ item, priority: scoreTarget(input, options) }))
    .filter((r) => r.priority.score >= minScore)
    .sort((a, b) => b.priority.score - a.priority.score)
    .slice(0, options.limit ?? 25);
}
