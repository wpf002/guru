import { connectionKey } from "./normalize.js";

/**
 * Snapshot diffing — roadmap §1.1 and §9.
 *
 * Each re-archive is diffed against the last. This is where three of the §9
 * metrics come from: inbound connection requests from the target persona,
 * audience-fit ratio of *new* connections, and network churn.
 *
 * The distinction that matters: a network growing by 200 people who don't match
 * the persona is not growth, and an average fit ratio across the whole network
 * hides that. New connections are measured on their own.
 */

export interface DiffableConnection {
  profileUrl?: string | null;
  normalizedName?: string | null;
  normalizedCompany?: string | null;
  connectedOn?: Date | null;
  personaFitScore?: number | null;
}

export interface SnapshotDiff<T extends DiffableConnection> {
  added: T[];
  removed: T[];
  retained: number;
  /** Fit ratio among *new* connections — the honest growth-quality signal. */
  newConnectionFitRatio: number | null;
  netGrowth: number;
}

export function diffConnections<T extends DiffableConnection>(
  previous: readonly T[],
  current: readonly T[],
  fitThreshold = 0.6,
): SnapshotDiff<T> {
  const previousKeys = new Set(previous.map(connectionKey));
  const currentKeys = new Set(current.map(connectionKey));

  const added = current.filter((c) => !previousKeys.has(connectionKey(c)));
  const removed = previous.filter((c) => !currentKeys.has(connectionKey(c)));

  const scoredNew = added.filter((c) => typeof c.personaFitScore === "number");
  const newConnectionFitRatio =
    scoredNew.length === 0
      ? null
      : scoredNew.filter((c) => (c.personaFitScore ?? 0) >= fitThreshold).length /
        scoredNew.length;

  return {
    added,
    removed,
    retained: current.length - added.length,
    newConnectionFitRatio,
    netGrowth: current.length - previous.length,
  };
}
