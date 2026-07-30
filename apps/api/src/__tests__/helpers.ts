import type Anthropic from "@anthropic-ai/sdk";
import { GuruLlm, prismaGenerationSink } from "@guru/llm";
import { prisma } from "@guru/db";

/**
 * Integration-test harness.
 *
 * The database is real; the model is scripted. That split is deliberate — these
 * tests exist to prove the persistence, ordering, and gating logic works against
 * actual Postgres, which is exactly the part unit tests with a mocked Prisma
 * would not catch (enum values that don't exist, unique constraints that don't
 * hold, cascade deletes that don't cascade).
 *
 * Generation rows are written for real, so the audit trail is verified too.
 */

export interface ScriptedResponse {
  /** Returned verbatim as the model's text output. */
  text: string;
  stopReason?: string;
  stopDetails?: { category?: string } | null;
}

export interface ScriptedLlm {
  llm: GuruLlm;
  /** Requests the fake received, for asserting on prompt/caching shape. */
  calls: Record<string, unknown>[];
  push: (...responses: ScriptedResponse[]) => void;
}

/**
 * A GuruLlm whose transport is scripted but whose audit sink is the real one.
 * Responses are consumed in order; running out is an explicit failure rather
 * than a hang, because a service quietly making an extra model call is a bug
 * worth failing on.
 */
export function scriptedLlm(initial: ScriptedResponse[] = []): ScriptedLlm {
  const queue = [...initial];
  const calls: Record<string, unknown>[] = [];

  const create = async (params: Record<string, unknown>) => {
    calls.push(params);
    const next = queue.shift();
    if (!next) {
      throw new Error(
        `Scripted LLM exhausted after ${calls.length} calls. A service made more model calls than the test expected.`,
      );
    }
    return {
      stop_reason: next.stopReason ?? "end_turn",
      stop_details: next.stopDetails ?? null,
      content: [{ type: "text", text: next.text }],
      usage: { input_tokens: 10, output_tokens: 20 },
    };
  };

  const client = { beta: { messages: { create } } } as unknown as Anthropic;

  return {
    llm: new GuruLlm(prismaGenerationSink, client),
    calls,
    push: (...responses) => queue.push(...responses),
  };
}

export const json = (value: unknown): ScriptedResponse => ({ text: JSON.stringify(value) });

/**
 * Truncates every table between tests.
 *
 * TRUNCATE ... CASCADE rather than per-model deleteMany: it is one round trip,
 * and it exercises the real foreign keys instead of relying on delete ordering
 * that happens to work.
 */
export async function resetDatabase(): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename != '_prisma_migrations'
  `;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} CASCADE`);
}

export async function makeUser(email = "drew@example.com") {
  return prisma.user.create({ data: { email, name: "Drew" } });
}

/** A complete, ingested archive snapshot — the precondition for most phases. */
export async function seedArchive(
  userId: string,
  options: {
    connections?: number;
    fitScores?: number[];
    comments?: string[];
    shares?: { content: string; publishedAt: Date }[];
  } = {},
) {
  const snapshot = await prisma.archiveSnapshot.create({
    data: { userId, source: "MANUAL_UPLOAD", status: "COMPLETE", completedAt: new Date() },
  });

  const count = options.connections ?? 0;
  if (count > 0) {
    await prisma.connection.createMany({
      data: Array.from({ length: count }, (_, i) => ({
        userId,
        snapshotId: snapshot.id,
        firstName: `First${i}`,
        lastName: `Last${i}`,
        company: i % 2 === 0 ? "Acme Logistics" : "Beta Freight",
        position: i % 2 === 0 ? "VP Operations" : "Analyst",
        profileUrl: `https://linkedin.com/in/person${i}`,
        connectedOn: new Date(2024, 0, 1 + (i % 300)),
        personaFitScore: options.fitScores?.[i] ?? null,
        rawRow: {},
      })),
    });
  }

  if (options.comments?.length) {
    await prisma.commentRecord.createMany({
      data: options.comments.map((message, i) => ({
        userId,
        snapshotId: snapshot.id,
        message,
        postUrl: `https://linkedin.com/feed/${i}`,
        rawRow: {},
      })),
    });
  }

  if (options.shares?.length) {
    await prisma.shareRecord.createMany({
      data: options.shares.map((s) => ({
        userId,
        snapshotId: snapshot.id,
        content: s.content,
        publishedAt: s.publishedAt,
        rawRow: {},
      })),
    });
  }

  return snapshot;
}

export async function seedBrief(userId: string, overrides: Record<string, unknown> = {}) {
  return prisma.strategicBrief.create({
    data: {
      userId,
      version: 1,
      role: "Operations consultant",
      industry: "Logistics",
      niche: "Third-party logistics",
      subNiche: "Cold-chain 3PL for regional grocers",
      offer: "Fractional ops leadership",
      currentState: { activity: "sporadic", network: "mixed", leadFlow: "referral only" },
      targetState: { goals: "inbound pipeline", outcomes: ["leads"], timeline: "6 months" },
      persona: { description: "VP Ops at regional grocers", signals: ["VP Operations"] },
      neverSay: ["guaranteed"],
      complianceFlags: [],
      ...overrides,
    },
  });
}

export async function seedRoadmap(userId: string, briefId: string) {
  return prisma.roadmap.create({
    data: {
      userId,
      briefId,
      version: 1,
      summary: "Build authority in cold-chain ops before scaling reach.",
      elements: {
        create: [
          {
            phase: 1,
            title: "Name the cost of a broken cold chain",
            rationale: "Buyers do not know what spoilage is costing them.",
            businessGoal: "inbound pipeline",
            audienceSegment: "VP Ops at regional grocers",
            targetFormats: ["short post"],
            targetTopics: ["spoilage", "cold chain"],
            order: 0,
          },
        ],
      },
    },
    include: { elements: true },
  });
}
