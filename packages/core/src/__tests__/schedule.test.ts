import { describe, expect, it } from "vitest";
import {
  JOBS,
  backoffMs,
  dueJobs,
  isDue,
  jobByName,
  type JobDefinition,
  type JobState,
} from "../schedule.js";

const NOW = new Date("2026-07-30T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

const job: JobDefinition = {
  name: "test.job",
  scope: "PER_USER",
  intervalMs: 60_000,
  description: "",
};

const ok = (lastRunAt: Date | null): JobState => ({
  lastRunAt,
  lastOk: true,
  consecutiveFailures: 0,
});

describe("isDue", () => {
  it("runs a job that has never run", () => {
    expect(isDue(job, undefined, NOW).due).toBe(true);
    expect(isDue(job, ok(null), NOW).due).toBe(true);
  });

  it("holds a skipInitialRun job back on the first tick", () => {
    // A weekly prompt firing the instant the server boots is noise, not a
    // cadence.
    const weekly = { ...job, skipInitialRun: true };
    expect(isDue(weekly, undefined, NOW).due).toBe(false);
  });

  it("waits out the interval", () => {
    expect(isDue(job, ok(ago(59_000)), NOW).due).toBe(false);
    expect(isDue(job, ok(ago(60_000)), NOW).due).toBe(true);
  });

  it("reports how long is left, so an ops view can say something useful", () => {
    expect(isDue(job, ok(ago(30_000)), NOW).reason).toMatch(/30s remaining/);
  });

  it("backs off after failures instead of hammering", () => {
    const failing: JobState = {
      lastRunAt: ago(90_000),
      lastOk: false,
      consecutiveFailures: 3,
    };
    // Nominal interval has passed, but backoff has not.
    expect(isDue(job, failing, NOW).due).toBe(false);
  });

  it("retries once the backoff window has passed", () => {
    const failing: JobState = {
      lastRunAt: ago(10 * 60_000),
      lastOk: false,
      consecutiveFailures: 3,
    };
    const decision = isDue(job, failing, NOW);
    expect(decision.due).toBe(true);
    expect(decision.reason).toMatch(/Retrying after 3 failure/);
  });

  it("catches up after downtime rather than skipping the run", () => {
    // Server was off for a week; the job is overdue, not cancelled.
    expect(isDue(job, ok(ago(7 * 86_400_000)), NOW).due).toBe(true);
  });
});

describe("backoffMs", () => {
  it("returns the plain interval when nothing has failed", () => {
    expect(backoffMs(0, 60_000)).toBe(60_000);
  });

  it("grows exponentially", () => {
    expect(backoffMs(1, 60_000)).toBe(120_000);
    expect(backoffMs(3, 60_000)).toBe(480_000);
  });

  it("caps so a wedged job cannot back off forever", () => {
    expect(backoffMs(50, 60 * 60_000)).toBe(6 * 60 * 60 * 1000);
  });
});

describe("dueJobs", () => {
  it("selects only what is due", () => {
    const states = new Map<string, JobState>([
      ["archive.poll", ok(ago(60 * 60_000))],
      ["content.publishDue", ok(ago(1000))],
    ]);
    const due = dueJobs(JOBS, states, NOW).map((j) => j.name);

    expect(due).toContain("archive.poll");
    expect(due).not.toContain("content.publishDue");
  });

  it("does not fire the cadence jobs on a cold start", () => {
    // Boot with no history: the frequent jobs run, the weekly/monthly ones wait.
    const due = dueJobs(JOBS, new Map(), NOW).map((j) => j.name);

    expect(due).toContain("archive.poll");
    expect(due).toContain("content.publishDue");
    expect(due).not.toContain("metrics.weeklyPrompt");
    expect(due).not.toContain("archive.recheck");
  });
});

describe("JOBS", () => {
  it("covers every roadmap feature that implies a timer", () => {
    const names = JOBS.map((j) => j.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "archive.poll",
        "content.publishDue",
        "autonomy.run",
        "voice.refresh",
        "metrics.weeklyPrompt",
        "archive.recheck",
      ]),
    );
  });

  it("has a unique name and a stated purpose for each", () => {
    expect(new Set(JOBS.map((j) => j.name)).size).toBe(JOBS.length);
    expect(JOBS.every((j) => j.description.length > 20)).toBe(true);
  });

  it("throws on an unknown name rather than silently doing nothing", () => {
    expect(() => jobByName("nope")).toThrow(/Unknown job/);
    expect(jobByName("archive.poll").scope).toBe("PER_USER");
  });
});
