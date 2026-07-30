import { prisma, type Prisma } from "@guru/db";
import { JOBS, isDue, type JobDefinition, type JobState } from "@guru/core";
import type { GuruLlm } from "@guru/llm";
import type { Env } from "../env.js";
import { pollAndIngest } from "./archive-ingest.js";
import { publishDueDrafts } from "./content.js";
import { runContentAutonomy, runEngagementAutonomy } from "./autonomy.js";
import { buildVoiceProfile } from "./voice.js";
import { recordWeeklyReport } from "./metrics.js";

/**
 * The scheduler — what turns the roadmap's verbs into behaviour.
 *
 * Several §1 features are written as things Guru does on its own: it watches
 * for the archive email, it publishes the queue, it prompts weekly, it
 * re-archives on a cadence. All of them existed as routes nobody called, which
 * made them buttons.
 *
 * Deliberately a single in-process interval rather than a queue system. At one
 * tenant the operational cost of Redis and a worker fleet buys nothing, and the
 * seam is narrow enough that swapping in a real queue later is a change to this
 * file only. What it must not do is lose the fact that a job ran — hence JobRun
 * rows rather than in-memory timers.
 */

const TICK_MS = 60_000;

export interface JobResult {
  ok: boolean;
  detail?: unknown;
  error?: string;
}

type JobHandler = (ctx: {
  env: Env;
  llm: GuruLlm;
  userId: string | null;
}) => Promise<JobResult>;

const HANDLERS: Record<string, JobHandler> = {
  "archive.poll": async ({ env, userId }) => {
    if (!env.google) return { ok: true, detail: "Google not configured — nothing to watch." };
    if (!userId) return { ok: true, detail: "skipped" };

    const account = await prisma.googleAccount.findUnique({
      where: { userId },
      select: { gmailWatchEnabled: true, disconnectedAt: true },
    });
    // Not an error: most users won't have connected Gmail, and a job that
    // reports failure for a choice the user made is noise.
    if (!account || account.disconnectedAt || !account.gmailWatchEnabled) {
      return { ok: true, detail: "Gmail not connected for this user." };
    }

    const results = await pollAndIngest(env.google, userId);
    return { ok: true, detail: { ingested: results.length, results } };
  },

  "content.publishDue": async ({ env }) => {
    const results = await publishDueDrafts(env);
    const failed = results.filter((r) => !r.ok);
    // Partial failure is still a completed run — one unpublishable draft must
    // not put the whole job into backoff.
    return { ok: true, detail: { published: results.length - failed.length, failed } };
  },

  "autonomy.run": async ({ env, userId }) => {
    if (!userId) return { ok: true, detail: "skipped" };

    const settings = await prisma.autonomySettings.findUnique({ where: { userId } });
    if (!settings || settings.killSwitch) {
      return { ok: true, detail: settings ? "Kill switch engaged." : "Autonomy not configured." };
    }
    if (!settings.engagementAutonomyEnabled && !settings.contentAutonomyEnabled) {
      return { ok: true, detail: "Autonomy is off." };
    }

    const engagement = settings.engagementAutonomyEnabled
      ? await runEngagementAutonomy(env, userId)
      : null;
    const content = settings.contentAutonomyEnabled
      ? await runContentAutonomy(env, userId)
      : null;

    return { ok: true, detail: { engagement, content } };
  },

  "voice.refresh": async ({ llm, userId }) => {
    if (!userId) return { ok: true, detail: "skipped" };

    const active = await prisma.voiceProfile.findFirst({
      where: { userId, active: true },
      select: { createdAt: true, sourceEditCount: true },
    });

    const editsSince = await prisma.draftRevision.count({
      where: {
        userId,
        author: "user",
        ...(active ? { createdAt: { gt: active.createdAt } } : {}),
      },
    });

    // Rebuilding on no new evidence burns a model call and churns a profile the
    // user may have hand-edited.
    if (active && editsSince < 5) {
      return { ok: true, detail: `Only ${editsSince} new edits since the last profile.` };
    }

    const profile = await buildVoiceProfile(llm, userId);
    return { ok: true, detail: { version: profile.version, editsSince } };
  },

  "metrics.weeklyPrompt": async ({ userId }) => {
    if (!userId) return { ok: true, detail: "skipped" };

    // Opens the week's report with the archive-derived numbers filled in. The
    // three user-reported fields stay null until the user answers — that is the
    // prompt (§9), and a null is honest where a zero would not be.
    const report = await recordWeeklyReport(userId, {});
    return { ok: true, detail: { reportId: report.id } };
  },

  "archive.recheck": async ({ userId }) => {
    if (!userId) return { ok: true, detail: "skipped" };

    const latest = await prisma.archiveSnapshot.findFirst({
      where: { userId, status: { in: ["FIRST_INSTALLMENT_INGESTED", "COMPLETE"] } },
      orderBy: { requestedAt: "desc" },
      select: { requestedAt: true },
    });
    if (!latest) return { ok: true, detail: "No archive yet — nothing to re-check." };

    // Guru cannot request the archive; only the member can. So this records
    // that a refresh is due and the UI surfaces it. Pretending otherwise would
    // be a job that always "succeeds" and never does anything.
    const days = Math.floor((Date.now() - latest.requestedAt.getTime()) / 86_400_000);
    return { ok: true, detail: { refreshDue: true, daysSinceLastArchive: days } };
  },
};

async function loadState(jobName: string, userId: string | null): Promise<JobState | undefined> {
  const last = await prisma.jobRun.findFirst({
    where: { jobName, userId, finishedAt: { not: null } },
    orderBy: { startedAt: "desc" },
  });
  if (!last) return undefined;

  return {
    lastRunAt: last.startedAt,
    lastOk: last.ok ?? false,
    consecutiveFailures: last.consecutiveFailures,
  };
}

/** Most recent finished run of a job across every user. Display only. */
async function loadAnyState(jobName: string): Promise<JobState | undefined> {
  const last = await prisma.jobRun.findFirst({
    where: { jobName, finishedAt: { not: null } },
    orderBy: { startedAt: "desc" },
  });
  if (!last) return undefined;
  return {
    lastRunAt: last.startedAt,
    lastOk: last.ok ?? false,
    consecutiveFailures: last.consecutiveFailures,
  };
}

async function runJob(
  definition: JobDefinition,
  ctx: { env: Env; llm: GuruLlm; userId: string | null },
  previous: JobState | undefined,
): Promise<void> {
  const handler = HANDLERS[definition.name];
  if (!handler) return;

  const run = await prisma.jobRun.create({
    data: { jobName: definition.name, userId: ctx.userId },
  });

  try {
    const result = await handler(ctx);
    await prisma.jobRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        ok: result.ok,
        detail: (result.detail ?? undefined) as Prisma.InputJsonValue | undefined,
        error: result.error ?? null,
        consecutiveFailures: result.ok ? 0 : (previous?.consecutiveFailures ?? 0) + 1,
      },
    });
  } catch (err) {
    await prisma.jobRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        consecutiveFailures: (previous?.consecutiveFailures ?? 0) + 1,
      },
    });
  }
}

/** One pass over every job. Exported so it can be triggered on demand and tested. */
export async function tick(env: Env, llm: GuruLlm, now = new Date()): Promise<void> {
  const users = await prisma.user.findMany({ select: { id: true } });

  for (const definition of JOBS) {
    const targets: (string | null)[] =
      definition.scope === "GLOBAL" ? [null] : users.map((u) => u.id);

    for (const userId of targets) {
      const state = await loadState(definition.name, userId);
      if (!isDue(definition, state, now).due) continue;
      // Sequential on purpose: these hit the same third-party APIs, and a burst
      // of parallel calls per user is how rate limits get hit.
      await runJob(definition, { env, llm, userId }, state);
    }
  }
}

export function startScheduler(env: Env, llm: GuruLlm): { stop: () => void } {
  let running = false;

  const timer = setInterval(() => {
    // A slow tick must not overlap the next one — jobs are not reentrant.
    if (running) return;
    running = true;
    tick(env, llm)
      .catch((err) => console.error("[scheduler] tick failed", err))
      .finally(() => {
        running = false;
      });
  }, TICK_MS);

  // Don't hold the process open in tests or short-lived scripts.
  timer.unref?.();

  return { stop: () => clearInterval(timer) };
}

/** What ran, when, and whether it worked. */
export async function schedulerStatus(userId?: string) {
  const runs = await prisma.jobRun.findMany({
    where: userId ? { OR: [{ userId }, { userId: null }] } : {},
    orderBy: { startedAt: "desc" },
    take: 50,
  });

  const byJob = await Promise.all(
    JOBS.map(async (definition) => {
      // A per-user job asked about without a user has no single state. Report
      // the most recent run across all users rather than looking up
      // `userId: null`, which never matches and reads as "never ran".
      const state =
        definition.scope === "GLOBAL" || userId
          ? await loadState(definition.name, definition.scope === "GLOBAL" ? null : userId!)
          : await loadAnyState(definition.name);

      return {
        name: definition.name,
        scope: definition.scope,
        description: definition.description,
        intervalMs: definition.intervalMs,
        lastRunAt: state?.lastRunAt ?? null,
        lastOk: state?.lastOk ?? null,
        consecutiveFailures: state?.consecutiveFailures ?? 0,
        // Only meaningful for a specific target; across all users it is a
        // summary, not a schedule.
        nextDue: definition.scope === "GLOBAL" || userId ? isDue(definition, state).reason : null,
      };
    }),
  );

  return { jobs: byJob, recentRuns: runs };
}
