import { prisma, type EngagementDraft } from "@guru/db";
import { assertConstraints } from "@guru/core";
import { createProvider, rankTargets, type IntelConfig } from "@guru/intel";
import { CURRENT, render } from "@guru/prompts";
import { EngagementCommentSchema, type GuruLlm } from "@guru/llm";
import type { ReactionType } from "@guru/linkedin";
import { briefContext } from "./brief.js";
import { voiceContext } from "./voice.js";
import { linkedInClientFor } from "./linkedin-session.js";
import type { Env } from "../env.js";

/**
 * The engagement engine — roadmap §1.6.
 *
 * `w_member_social` covers comment and react, not just post. That is the whole
 * reason this is a Phase 1 subsystem rather than a Phase 2 aspiration: the
 * compliant answer to network growth is showing up intelligently in the comments
 * of the people your buyers already follow, and it needs no partner approval.
 *
 * What is deliberately absent: connection requests and DMs. No sanctioned path
 * exists (§0.4), and the alternatives put at risk the account this product
 * exists to grow.
 */

/**
 * Build the target feed. Posts from peers and persona-adjacent voices, ranked by
 * author fit, audience overlap, and freshness — freshness multiplying rather
 * than adding, because a perfect comment on a four-day-old post is invisible.
 */
export async function discoverTargets(
  llm: GuruLlm,
  userId: string,
  config: IntelConfig | null,
): Promise<{ discovered: number; degraded: boolean }> {
  if (!config) return { discovered: 0, degraded: true };
  void llm;

  const brief = await prisma.strategicBrief.findFirst({
    where: { userId, supersededById: null },
    orderBy: { version: "desc" },
  });
  if (!brief) throw new Error("Discover targets after the brief exists — it defines the persona.");

  const peers = await prisma.peer.findMany({
    where: { userId, active: true },
    select: { name: true },
  });

  const provider = createProvider(config);
  const results = await provider.search({
    terms: [brief.subNiche, brief.niche].filter(Boolean) as string[],
    authors: peers.map((p) => p.name),
    // Freshness dominates the score, so there is no point paying to retrieve
    // posts old enough that a comment would never be seen.
    since: new Date(Date.now() - 5 * 86_400_000),
    limit: 50,
  });

  const peerNames = new Set(peers.map((p) => p.name.toLowerCase()));

  const scored = rankTargets(
    results
      .filter((r) => r.url && r.publishedAt)
      .map((r) => ({
        item: r,
        input: {
          // A named peer is a known-good author; anyone else surfaced by a
          // sub-niche query is plausible but unverified.
          authorFit: r.author && peerNames.has(r.author.toLowerCase()) ? 0.9 : 0.5,
          audienceOverlap: r.author && peerNames.has(r.author.toLowerCase()) ? 0.8 : 0.4,
          postedAt: r.publishedAt!,
        },
      })),
    { limit: 25 },
  );

  let discovered = 0;
  for (const { item, priority } of scored) {
    // Unique on (userId, postUrl) — the same post surfacing in two queries must
    // not become two review items.
    await prisma.engagementTarget.upsert({
      where: { userId_postUrl: { userId, postUrl: item.url! } },
      update: {
        priorityScore: priority.score,
        authorFit: priority.authorFit,
        audienceOverlap: priority.audienceOverlap,
        freshness: priority.freshness,
        scoreRationale: priority.rationale,
      },
      create: {
        userId,
        postUrl: item.url!,
        authorName: item.author,
        postContent: item.content,
        postedAt: item.publishedAt,
        tier: item.tier,
        priorityScore: priority.score,
        authorFit: priority.authorFit,
        audienceOverlap: priority.audienceOverlap,
        freshness: priority.freshness,
        scoreRationale: priority.rationale,
      },
    });
    discovered++;
  }

  return { discovered, degraded: false };
}

/**
 * Draft a comment on someone else's post.
 *
 * The prompt asks for a comment that adds a point rather than agreeing — a
 * comment that agrees costs the same attention and returns nothing, and posting
 * those at scale is how a presence strategy becomes noise.
 */
export async function draftComment(
  llm: GuruLlm,
  targetId: string,
  roadmapElementId?: string,
): Promise<EngagementDraft> {
  const target = await prisma.engagementTarget.findUniqueOrThrow({ where: { id: targetId } });

  const brief = await prisma.strategicBrief.findFirst({
    where: { userId: target.userId, supersededById: null },
    orderBy: { version: "desc" },
  });
  if (!brief) throw new Error("No brief — a comment with no strategy behind it is just noise.");

  if (!target.postContent) {
    throw new Error(
      "No post content retrieved for this target. A comment written without reading the post is exactly the kind we refuse to send.",
    );
  }

  const { value, generationId } = await llm.structured(
    {
      userId: target.userId,
      purpose: "engagement.comment",
      promptName: CURRENT.engagementComment.name,
      promptVersion: CURRENT.engagementComment.version,
      system: `You write LinkedIn comments as a specific person.\n\n${briefContext(brief)}`,
      prompt: render(CURRENT.engagementComment, {
        postContent: target.postContent,
        postAuthor: target.authorName ?? "an industry voice",
        brief: briefContext(brief),
        voiceProfile: await voiceContext(target.userId),
      }),
      effort: "medium",
      auditInputs: { targetId, priorityScore: target.priorityScore, briefVersion: brief.version },
    },
    EngagementCommentSchema,
  );

  // The brief's hard filters apply to comments exactly as they do to posts —
  // arguably more, since a comment appears under someone else's name.
  assertConstraints(value.content, {
    neverSay: brief.neverSay,
    complianceFlags: brief.complianceFlags,
  });

  const voiceProfile = await prisma.voiceProfile.findFirst({
    where: { userId: target.userId, active: true },
    select: { id: true },
  });

  return prisma.engagementDraft.create({
    data: {
      userId: target.userId,
      targetId,
      roadmapElementId: roadmapElementId ?? null,
      kind: "COMMENT",
      content: value.content,
      whyThis: value.whyThis,
      voiceProfileId: voiceProfile?.id ?? null,
      generationId,
    },
  });
}

/** Reactions — lower-stakes presence (§1.6). No generation, so no audit row. */
export async function draftReaction(
  targetId: string,
  reactionType: ReactionType = "LIKE",
): Promise<EngagementDraft> {
  const target = await prisma.engagementTarget.findUniqueOrThrow({ where: { id: targetId } });
  return prisma.engagementDraft.create({
    data: {
      userId: target.userId,
      targetId,
      kind: "REACTION",
      reactionType,
      whyThis: `Low-cost presence on a post scoring ${target.priorityScore?.toFixed(2) ?? "n/a"}.`,
    },
  });
}

/** Approve → post, via `w_member_social`. Human-approved in Phase 1. */
export async function publishEngagement(
  env: Env,
  engagementDraftId: string,
): Promise<EngagementDraft> {
  const draft = await prisma.engagementDraft.findUniqueOrThrow({
    where: { id: engagementDraftId },
    include: { target: true },
  });

  if (draft.status === "PUBLISHED") return draft;
  if (draft.status === "REJECTED") {
    throw new Error("This engagement was rejected — posting it would ignore that decision.");
  }

  const client = await linkedInClientFor(env, draft.userId);

  try {
    let urn: string | null = null;

    if (draft.kind === "COMMENT") {
      if (!draft.content) throw new Error("Comment draft has no content.");
      ({ urn } = await client.comment({
        postUrn: draft.target.postUrl,
        text: draft.content,
      }));
    } else {
      await client.react({
        postUrn: draft.target.postUrl,
        type: (draft.reactionType as ReactionType | null) ?? "LIKE",
      });
    }

    const updated = await prisma.engagementDraft.update({
      where: { id: engagementDraftId },
      data: {
        status: "PUBLISHED",
        publishedAt: new Date(),
        linkedinUrn: urn,
        publishError: null,
      },
    });

    // Marked acted-on so the same post never reappears in the review queue.
    await prisma.engagementTarget.update({
      where: { id: draft.targetId },
      data: { actedAt: new Date() },
    });

    return updated;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.engagementDraft.update({
      where: { id: engagementDraftId },
      data: { status: "FAILED", publishError: message },
    });
    throw err;
  }
}

/** The review queue: highest-priority unacted targets first. */
export async function targetQueue(userId: string, limit = 20) {
  return prisma.engagementTarget.findMany({
    where: { userId, actedAt: null },
    orderBy: { priorityScore: "desc" },
    take: limit,
    include: { drafts: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
}
