/**
 * Similarity checking — roadmap §1.4 and §1.5.
 *
 * Peer analysis is pattern-learning, not copying. That is a claim the product
 * makes to its users, so it is enforced here rather than asserted in a prompt:
 * every generated draft is compared against the peer material that informed it,
 * and a draft that is too close never reaches the user.
 *
 * Word-level shingles rather than embeddings, deliberately. The failure we care
 * about is reproduced *phrasing* — a paraphrase that says the same thing in the
 * user's own words is exactly what we want, and an embedding check would flag it
 * while missing nothing that matters.
 */

export interface SimilarityMatch {
  score: number;
  sourceIndex: number;
  /** The longest verbatim run shared with that source. */
  longestSharedPhrase: string;
}

const SHINGLE_SIZE = 5;

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function shingles(tokens: string[], size = SHINGLE_SIZE): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + size <= tokens.length; i++) {
    out.add(tokens.slice(i, i + size).join(" "));
  }
  return out;
}

/**
 * Containment rather than Jaccard: we want "how much of the draft came from this
 * source", and Jaccard would score a short draft against a long source as
 * low-similarity no matter how completely it was lifted.
 */
function containment(draft: Set<string>, source: Set<string>): number {
  if (draft.size === 0) return 0;
  let shared = 0;
  for (const shingle of draft) {
    if (source.has(shingle)) shared++;
  }
  return shared / draft.size;
}

function longestSharedRun(draftTokens: string[], sourceTokens: string[]): string {
  const sourceSet = new Set<string>();
  for (let size = 1; size <= Math.min(40, sourceTokens.length); size++) {
    for (let i = 0; i + size <= sourceTokens.length; i++) {
      sourceSet.add(sourceTokens.slice(i, i + size).join(" "));
    }
  }

  let best = "";
  for (let i = 0; i < draftTokens.length; i++) {
    for (let size = best.split(" ").length + 1; i + size <= draftTokens.length; size++) {
      const candidate = draftTokens.slice(i, i + size).join(" ");
      if (!sourceSet.has(candidate)) break;
      best = candidate;
    }
  }
  return best;
}

/** Highest-scoring source, or null when there is nothing to compare against. */
export function checkSimilarity(
  draft: string,
  sources: readonly string[],
): SimilarityMatch | null {
  const draftTokens = words(draft);
  // Below one shingle there is nothing meaningful to compare — scoring a
  // three-word draft as 0% similar would be a false reassurance.
  if (draftTokens.length < SHINGLE_SIZE) return null;

  const draftShingles = shingles(draftTokens);
  let best: SimilarityMatch | null = null;

  sources.forEach((source, sourceIndex) => {
    const sourceTokens = words(source);
    if (sourceTokens.length < SHINGLE_SIZE) return;

    const score = containment(draftShingles, shingles(sourceTokens));
    if (!best || score > best.score) {
      best = {
        score,
        sourceIndex,
        longestSharedPhrase: score > 0 ? longestSharedRun(draftTokens, sourceTokens) : "",
      };
    }
  });

  return best;
}

export class SimilarityError extends Error {
  constructor(readonly match: SimilarityMatch) {
    super(
      `Draft is ${Math.round(match.score * 100)}% shingle-identical to peer source ` +
        `#${match.sourceIndex}. Longest shared phrase: "${match.longestSharedPhrase}".`,
    );
    this.name = "SimilarityError";
  }
}

/**
 * The gate. 0.25 is deliberately low — shared 5-word runs are common in any
 * niche ("in the last twelve months"), so a quarter of a draft matching one
 * source is already well past coincidence.
 */
export function assertNotDerivative(
  draft: string,
  sources: readonly string[],
  threshold = 0.25,
): SimilarityMatch | null {
  const match = checkSimilarity(draft, sources);
  if (match && match.score >= threshold) throw new SimilarityError(match);
  return match;
}
