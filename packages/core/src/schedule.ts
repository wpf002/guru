/**
 * Job scheduling — the missing half of §1.1, §1.5, §2.1/2.2 and §9.
 *
 * Several roadmap features are described as things Guru *does*, not things a
 * user triggers: it watches for the archive email, it publishes the scheduled
 * queue, it prompts for weekly numbers, it re-archives on a cadence. Each of
 * those existed as a route nobody called, which makes them buttons rather than
 * behaviour.
 *
 * The decision — which jobs are due — is pure and lives here. The runner does
 * the I/O. That split keeps the interesting logic (backoff after failure,
 * catch-up after downtime, per-user vs global scope) testable without waiting
 * on real clocks.
 */

export type JobScope = "GLOBAL" | "PER_USER";

export interface JobDefinition {
  name: string;
  scope: JobScope;
  intervalMs: number;
  /** Shown in the ops view so a job's purpose isn't buried in code. */
  description: string;
  /**
   * Skip the first run at startup. Useful for jobs whose whole point is a
   * cadence (a weekly prompt shouldn't fire the moment the server boots).
   */
  skipInitialRun?: boolean;
}

export interface JobState {
  lastRunAt: Date | null;
  lastOk: boolean;
  consecutiveFailures: number;
}

export interface DueDecision {
  due: boolean;
  reason: string;
}

/** Exponential backoff, capped. A wedged job shouldn't hammer a failing API. */
export function backoffMs(consecutiveFailures: number, intervalMs: number): number {
  if (consecutiveFailures <= 0) return intervalMs;
  const factor = Math.min(2 ** consecutiveFailures, 32);
  return Math.min(intervalMs * factor, 6 * 60 * 60 * 1000);
}

export function isDue(
  definition: JobDefinition,
  state: JobState | undefined,
  now: Date = new Date(),
): DueDecision {
  if (!state || state.lastRunAt === null) {
    return definition.skipInitialRun
      ? { due: false, reason: "First tick — waiting a full interval before the first run." }
      : { due: true, reason: "Never run." };
  }

  // After a failure the effective interval grows, so the wait is measured
  // against backoff rather than the nominal interval.
  const wait = state.lastOk
    ? definition.intervalMs
    : backoffMs(state.consecutiveFailures, definition.intervalMs);

  const elapsed = now.getTime() - state.lastRunAt.getTime();
  if (elapsed >= wait) {
    return {
      due: true,
      reason: state.lastOk
        ? `${Math.round(elapsed / 1000)}s since last run.`
        : `Retrying after ${state.consecutiveFailures} failure(s).`,
    };
  }

  return {
    due: false,
    reason: `${Math.round((wait - elapsed) / 1000)}s remaining.`,
  };
}

export function dueJobs(
  definitions: readonly JobDefinition[],
  states: ReadonlyMap<string, JobState>,
  now: Date = new Date(),
): JobDefinition[] {
  return definitions.filter((d) => isDue(d, states.get(d.name), now).due);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * The jobs the roadmap implies. Intervals are deliberately unaggressive —
 * every one of these costs an API call or a model call per user, and none of
 * them is latency-sensitive.
 */
export const JOBS: readonly JobDefinition[] = [
  {
    name: "archive.poll",
    scope: "PER_USER",
    intervalMs: 15 * MINUTE,
    description:
      "§1.1 — watch Gmail for the LinkedIn archive email and ingest it. The first installment lands within minutes of the request, so this is the one job worth running often.",
  },
  {
    name: "content.publishDue",
    scope: "GLOBAL",
    intervalMs: 5 * MINUTE,
    description:
      "§1.5 — publish approved posts whose scheduled time has passed. A scheduling queue with no runner is just a timestamp column.",
  },
  {
    name: "autonomy.run",
    scope: "PER_USER",
    intervalMs: 30 * MINUTE,
    description:
      "§2.1/§2.2 — act on approved drafts within the guardrails. No-ops entirely unless the user has switched autonomy on.",
  },
  {
    name: "voice.refresh",
    scope: "PER_USER",
    intervalMs: 7 * DAY,
    description:
      "§1.8 — rebuild the voice profile from accumulated edit diffs. Weekly because a profile that churns daily can't be inspected or trusted.",
    skipInitialRun: true,
  },
  {
    name: "metrics.weeklyPrompt",
    scope: "PER_USER",
    intervalMs: 7 * DAY,
    description:
      "§9 — open a weekly report for the three user-reported numbers, and record what the archive already knows.",
    skipInitialRun: true,
  },
  {
    name: "archive.recheck",
    scope: "PER_USER",
    intervalMs: 30 * DAY,
    description:
      "§1.1.5 — prompt for a fresh archive so growth and churn can be diffed against the last snapshot.",
    skipInitialRun: true,
  },
] as const;

export function jobByName(name: string): JobDefinition {
  const job = JOBS.find((j) => j.name === name);
  if (!job) throw new Error(`Unknown job: ${name}`);
  return job;
}
