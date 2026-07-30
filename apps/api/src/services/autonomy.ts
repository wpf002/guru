import { prisma, type AutonomySettings, type Prisma } from "@guru/db";
import { evaluateAutonomy, type AutonomyKind } from "@guru/core";
import { publishDraft } from "./content.js";
import { publishEngagement } from "./engagement.js";
import type { Env } from "../env.js";

/**
 * Earned autonomy — roadmap §2.1 and §2.2.
 *
 * This layer does three things and nothing else: read the guardrails, ask
 * `evaluateAutonomy` for a verdict, and log the verdict either way. The decision
 * logic is pure and lives in packages/core; keeping the I/O out of it is what
 * makes "the guardrail held" a claim you can test rather than one you assert.
 *
 * Blocked actions are logged as loudly as published ones. A user turning this on
 * is extending trust, and the audit trail is what they get in return.
 */

export async function settingsFor(userId: string): Promise<AutonomySettings> {
  // Defaults are all restrictive: autonomy off, allowlist required, low caps.
  return prisma.autonomySettings.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });
}

export async function updateSettings(
  userId: string,
  patch: Partial<{
    engagementAutonomyEnabled: boolean;
    contentAutonomyEnabled: boolean;
    dailyEngagementCap: number;
    dailyContentCap: number;
    targetAllowlist: string[];
    requireAllowlist: boolean;
    topicExclusions: string[];
  }>,
): Promise<AutonomySettings> {
  const current = await settingsFor(userId);
  const turningOn =
    (patch.engagementAutonomyEnabled && !current.engagementAutonomyEnabled) ||
    (patch.contentAutonomyEnabled && !current.contentAutonomyEnabled);

  return prisma.autonomySettings.update({
    where: { userId },
    data: {
      ...patch,
      enabledAt: turningOn ? new Date() : current.enabledAt,
      // Changing settings must not silently clear a kill switch someone pulled.
      killSwitch: current.killSwitch,
    },
  });
}

/** Halts all autonomous action immediately, independent of scores and caps. */
export async function engageKillSwitch(
  userId: string,
  reason: string,
): Promise<AutonomySettings> {
  await settingsFor(userId);
  return prisma.autonomySettings.update({
    where: { userId },
    data: { killSwitch: true, killSwitchReason: reason, killSwitchEngagedAt: new Date() },
  });
}

export async function releaseKillSwitch(userId: string): Promise<AutonomySettings> {
  await settingsFor(userId);
  return prisma.autonomySettings.update({
    where: { userId },
    data: { killSwitch: false, killSwitchReason: null, killSwitchEngagedAt: null },
  });
}

const CONFIDENCE_CATEGORY: Record<AutonomyKind, string> = {
  ENGAGEMENT: "ENGAGEMENT_TARGET",
  CONTENT: "TONE",
  OUTREACH: "OUTREACH",
};

async function actionsToday(userId: string, kind: AutonomyKind): Promise<number> {
  const since = new Date(Date.now() - 86_400_000);
  return prisma.autonomousAction.count({
    where: { userId, kind, outcome: "PUBLISHED", createdAt: { gte: since } },
  });
}

async function log(
  settingsId: string,
  userId: string,
  kind: AutonomyKind,
  outcome: "PUBLISHED" | "BLOCKED_KILL_SWITCH" | "BLOCKED_CAP" | "BLOCKED_CONFIDENCE" | "BLOCKED_ALLOWLIST" | "BLOCKED_CONSTRAINT" | "FAILED",
  reason: string | null,
  refs: { contentDraftId?: string; engagementDraftId?: string },
  confidenceSnapshot: unknown,
) {
  await prisma.autonomousAction.create({
    data: {
      settingsId,
      userId,
      kind,
      outcome,
      reason,
      contentDraftId: refs.contentDraftId ?? null,
      engagementDraftId: refs.engagementDraftId ?? null,
      confidenceSnapshot: confidenceSnapshot as Prisma.InputJsonValue,
    },
  });
}

export interface AutonomousRunResult {
  attempted: number;
  published: number;
  blocked: { id: string; outcome: string; reason: string }[];
}

/**
 * Publish approved-but-unsent engagement drafts autonomously, within guardrails.
 *
 * Only drafts already in DRAFT status are considered — this never bypasses an
 * explicit rejection, and it never generates new content. Autonomy here means
 * "act without waiting for approval", not "act without limits".
 */
export async function runEngagementAutonomy(
  env: Env,
  userId: string,
): Promise<AutonomousRunResult> {
  const settings = await settingsFor(userId);
  const scores = await prisma.confidenceScore.findMany({ where: { userId } });
  const score =
    scores.find((s) => s.category === CONFIDENCE_CATEGORY.ENGAGEMENT)?.score ?? null;

  const candidates = await prisma.engagementDraft.findMany({
    where: { userId, status: "DRAFT" },
    include: { target: true },
    orderBy: { createdAt: "asc" },
    take: 25,
  });

  const result: AutonomousRunResult = { attempted: 0, published: 0, blocked: [] };
  const snapshot = scores.map((s) => ({ category: s.category, score: s.score }));

  for (const draft of candidates) {
    result.attempted++;

    const decision = evaluateAutonomy(settings, {
      kind: "ENGAGEMENT",
      actionsToday: await actionsToday(userId, "ENGAGEMENT"),
      confidenceScore: score,
      targetIdentifier: draft.target.authorName,
      text: draft.content,
    });

    if (!decision.allowed) {
      await log(
        settings.id,
        userId,
        "ENGAGEMENT",
        decision.outcome,
        decision.reason,
        { engagementDraftId: draft.id },
        snapshot,
      );
      result.blocked.push({ id: draft.id, outcome: decision.outcome, reason: decision.reason });
      // A cap or a kill switch applies to the whole run, not just this item.
      if (decision.outcome === "BLOCKED_CAP" || decision.outcome === "BLOCKED_KILL_SWITCH") break;
      continue;
    }

    try {
      await publishEngagement(env, draft.id);
      await log(settings.id, userId, "ENGAGEMENT", "PUBLISHED", null, { engagementDraftId: draft.id }, snapshot);
      result.published++;
    } catch (err) {
      await log(
        settings.id,
        userId,
        "ENGAGEMENT",
        "FAILED",
        (err as Error).message,
        { engagementDraftId: draft.id },
        snapshot,
      );
    }
  }

  return result;
}

/** The same, for scheduled posts (§2.2). Separate threshold, separate switch. */
export async function runContentAutonomy(
  env: Env,
  userId: string,
): Promise<AutonomousRunResult> {
  const settings = await settingsFor(userId);
  const scores = await prisma.confidenceScore.findMany({ where: { userId } });
  const score = scores.find((s) => s.category === CONFIDENCE_CATEGORY.CONTENT)?.score ?? null;
  const snapshot = scores.map((s) => ({ category: s.category, score: s.score }));

  const candidates = await prisma.contentDraft.findMany({
    where: { userId, status: "SCHEDULED", scheduledFor: { lte: new Date() } },
    orderBy: { scheduledFor: "asc" },
    take: 10,
  });

  const result: AutonomousRunResult = { attempted: 0, published: 0, blocked: [] };

  for (const draft of candidates) {
    result.attempted++;

    const decision = evaluateAutonomy(settings, {
      kind: "CONTENT",
      actionsToday: await actionsToday(userId, "CONTENT"),
      confidenceScore: score,
      text: draft.content,
    });

    if (!decision.allowed) {
      await log(settings.id, userId, "CONTENT", decision.outcome, decision.reason, { contentDraftId: draft.id }, snapshot);
      result.blocked.push({ id: draft.id, outcome: decision.outcome, reason: decision.reason });
      if (decision.outcome === "BLOCKED_CAP" || decision.outcome === "BLOCKED_KILL_SWITCH") break;
      continue;
    }

    try {
      await publishDraft(env, draft.id);
      await log(settings.id, userId, "CONTENT", "PUBLISHED", null, { contentDraftId: draft.id }, snapshot);
      result.published++;
    } catch (err) {
      await log(settings.id, userId, "CONTENT", "FAILED", (err as Error).message, { contentDraftId: draft.id }, snapshot);
    }
  }

  return result;
}

/** The audit trail. The blocked entries are the point. */
export async function autonomyLog(userId: string, limit = 50) {
  return prisma.autonomousAction.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
