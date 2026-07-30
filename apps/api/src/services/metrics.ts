import { prisma, type MetricReport } from "@guru/db";
import { snapshotDelta } from "./archive-ingest.js";
import { editsPerDraftTrend } from "./voice.js";

/**
 * Success metrics — roadmap §9, "resonates well" defined.
 *
 * The tiering matters more than the numbers. Comments from target-persona
 * accounts outweigh raw reaction counts: eight reactions from real buyers beats
 * two hundred from peers, and a trend engine trained on the latter optimizes for
 * engagement theater.
 *
 * `r_member_social` is closed (§0.3), so the primary tier is user-reported on a
 * weekly prompt. That is a deliberate design constraint, not an interim hack —
 * the metrics were chosen to work without engagement read-back.
 */

export interface WeeklyReport {
  qualifiedConversations?: number;
  profileViews?: number;
  personaCommentsReceived?: number;
  postEngagement?: Record<string, number>;
}

/** The 20-second weekly prompt. Three numbers, all optional. */
export async function recordWeeklyReport(
  userId: string,
  report: WeeklyReport,
  periodEnd = new Date(),
): Promise<MetricReport> {
  const periodStart = new Date(periodEnd.getTime() - 7 * 86_400_000);

  const [delta, edits] = await Promise.all([
    snapshotDelta(userId),
    editsPerDraftTrend(userId, 7),
  ]);

  return prisma.metricReport.create({
    data: {
      userId,
      periodStart,
      periodEnd,
      qualifiedConversations: report.qualifiedConversations ?? null,
      profileViews: report.profileViews ?? null,
      personaCommentsReceived: report.personaCommentsReceived ?? null,
      postEngagement: report.postEngagement ?? undefined,
      // Derived, not asked for — the archive already knows.
      inboundFromPersona: delta?.added.length ?? null,
      audienceFitRatioDelta: delta?.newConnectionFitRatio ?? null,
      editsPerDraft: edits.current,
    },
  });
}

export interface MetricsView {
  primary: {
    qualifiedConversations: number | null;
    profileViews: number | null;
    inboundFromPersona: number | null;
  };
  secondary: {
    personaCommentsReceived: number | null;
    postEngagement: unknown;
  };
  internal: {
    approvalRateByCategory: { category: string; score: number | null; sampleSize: number }[];
    editsPerDraft: { current: number | null; previous: number | null; improving: boolean | null };
    newConnectionFitRatio: number | null;
    postsPublished: number;
    engagementsPublished: number;
  };
  /** Stated plainly so a thin dashboard doesn't read as a broken one. */
  notes: string[];
}

export async function metricsView(userId: string): Promise<MetricsView> {
  const [latest, scores, edits, delta, postsPublished, engagementsPublished] =
    await Promise.all([
      prisma.metricReport.findFirst({
        where: { userId },
        orderBy: { periodEnd: "desc" },
      }),
      prisma.confidenceScore.findMany({
        where: { userId },
        select: { category: true, score: true, sampleSize: true },
      }),
      editsPerDraftTrend(userId),
      snapshotDelta(userId),
      prisma.contentDraft.count({ where: { userId, status: "PUBLISHED" } }),
      prisma.engagementDraft.count({ where: { userId, status: "PUBLISHED" } }),
    ]);

  const notes: string[] = [];
  if (!latest) {
    notes.push("No weekly report logged yet — the primary metrics are user-reported.");
  }
  if (!delta) {
    notes.push("Only one archive snapshot so far — growth metrics need a second one to diff.");
  }
  notes.push(
    "Post engagement is not read back from LinkedIn: r_member_social is a closed permission. " +
      "These numbers are self-reported or derived from archive diffs.",
  );

  return {
    primary: {
      qualifiedConversations: latest?.qualifiedConversations ?? null,
      profileViews: latest?.profileViews ?? null,
      inboundFromPersona: latest?.inboundFromPersona ?? null,
    },
    secondary: {
      personaCommentsReceived: latest?.personaCommentsReceived ?? null,
      postEngagement: latest?.postEngagement ?? null,
    },
    internal: {
      approvalRateByCategory: scores.map((s) => ({
        category: s.category,
        score: s.score,
        sampleSize: s.sampleSize,
      })),
      editsPerDraft: edits,
      newConnectionFitRatio: delta?.newConnectionFitRatio ?? null,
      postsPublished,
      engagementsPublished,
    },
    notes,
  };
}
