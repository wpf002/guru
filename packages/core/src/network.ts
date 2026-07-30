/**
 * Network analysis — roadmap §1.4.
 *
 * The spec branches strategy on raw connection count. That heuristic was
 * proxying for something sharper: a 10,000-connection network of the wrong
 * people is strategically sparse. So we compute both, and branch on
 * *effective* reach — the count of connections that actually match the persona.
 */

export type NetworkDensity = "SPARSE" | "MODERATE" | "DENSE";

export interface ConnectionLike {
  connectedOn?: Date | null;
  personaFitScore?: number | null;
}

export interface NetworkAnalysis {
  connectionCount: number;
  /** Connections scoring above `fitThreshold`, over those actually scored. */
  audienceFitRatio: number | null;
  scoredCount: number;
  /** connectionCount × audienceFitRatio — what the network is worth in practice. */
  effectiveReach: number | null;
  density: NetworkDensity;
  /** Whether network-building must precede content strategy. */
  needsNetworkBuilding: boolean;
  rationale: string;
}

export interface NetworkOptions {
  fitThreshold?: number;
  sparseBelow?: number;
  denseAtOrAbove?: number;
}

const DEFAULTS = {
  fitThreshold: 0.6,
  sparseBelow: 500,
  denseAtOrAbove: 5000,
};

export function analyzeNetwork(
  connections: readonly ConnectionLike[],
  options: NetworkOptions = {},
): NetworkAnalysis {
  const fitThreshold = options.fitThreshold ?? DEFAULTS.fitThreshold;
  const sparseBelow = options.sparseBelow ?? DEFAULTS.sparseBelow;
  const denseAtOrAbove = options.denseAtOrAbove ?? DEFAULTS.denseAtOrAbove;

  const connectionCount = connections.length;
  const scored = connections.filter(
    (c) => typeof c.personaFitScore === "number",
  );
  const scoredCount = scored.length;

  const audienceFitRatio =
    scoredCount === 0
      ? null
      : scored.filter((c) => (c.personaFitScore ?? 0) >= fitThreshold).length /
        scoredCount;

  const effectiveReach =
    audienceFitRatio === null ? null : Math.round(connectionCount * audienceFitRatio);

  // Before persona scoring exists, fall back to the spec's raw-size branch.
  const basis = effectiveReach ?? connectionCount;

  let density: NetworkDensity;
  if (basis < sparseBelow) density = "SPARSE";
  else if (basis < denseAtOrAbove) density = "MODERATE";
  else density = "DENSE";

  const needsNetworkBuilding = density === "SPARSE";

  const rationale =
    effectiveReach === null
      ? `${connectionCount} connections, none scored for persona fit yet — branching on raw size until the brief exists.`
      : `${connectionCount} connections, ${Math.round((audienceFitRatio ?? 0) * 100)}% matching the target persona ` +
        `(${effectiveReach} effective). ${
          needsNetworkBuilding
            ? "Network-building comes before content strategy here."
            : "Enough reach to segment the audience and target content immediately."
        }`;

  return {
    connectionCount,
    audienceFitRatio,
    scoredCount,
    effectiveReach,
    density,
    needsNetworkBuilding,
    rationale,
  };
}

/** Invitation acceptance rate — the outreach baseline from the archive (§1.4). */
export function invitationAcceptRate(
  invitations: readonly { direction?: string | null; status?: string | null }[],
): number | null {
  const sent = invitations.filter((i) => i.direction?.toUpperCase() === "OUTGOING");
  if (sent.length === 0) return null;
  const accepted = sent.filter((i) => i.status?.toUpperCase() === "ACCEPTED");
  return accepted.length / sent.length;
}

/**
 * Posting cadence and — more usefully — the gaps. A user who posts in bursts and
 * then vanishes for six weeks has a different problem from one who posts weekly.
 */
export function postingCadence(
  posts: readonly { publishedAt?: Date | null }[],
): {
  totalPosts: number;
  postsPerWeek: number | null;
  longestGapDays: number | null;
  lastPostedAt: Date | null;
} {
  const dated = posts
    .map((p) => p.publishedAt)
    .filter((d): d is Date => d instanceof Date)
    .sort((a, b) => a.getTime() - b.getTime());

  if (dated.length === 0) {
    return { totalPosts: 0, postsPerWeek: null, longestGapDays: null, lastPostedAt: null };
  }

  const first = dated[0]!;
  const last = dated[dated.length - 1]!;
  const msPerDay = 86_400_000;
  const spanDays = (last.getTime() - first.getTime()) / msPerDay;

  let longestGapDays = 0;
  for (let i = 1; i < dated.length; i++) {
    const gap = (dated[i]!.getTime() - dated[i - 1]!.getTime()) / msPerDay;
    if (gap > longestGapDays) longestGapDays = gap;
  }

  return {
    totalPosts: dated.length,
    // A single post spans zero days; rate is undefined rather than infinite.
    postsPerWeek: spanDays > 0 ? dated.length / (spanDays / 7) : null,
    longestGapDays,
    lastPostedAt: last,
  };
}
