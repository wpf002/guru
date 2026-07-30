import { prisma, type ContentDraft } from "@guru/db";
import { assertConstraints, assertNotDerivative, checkSimilarity } from "@guru/core";
import { LinkedInClient } from "@guru/linkedin";
import { CURRENT, render } from "@guru/prompts";
import { ContentDraftSchema, RefinementSchema, type GuruLlm } from "@guru/llm";
import { briefContext } from "./brief.js";
import { voiceContext } from "./voice.js";
import { documentSignal } from "./documents.js";
import { linkedInClientFor } from "./linkedin-session.js";
import type { Env } from "../env.js";

/**
 * The content engine — roadmap §1.5.
 *
 * Ready-to-post drafts, not topic ideas, each carrying the roadmap element it
 * serves. Three gates sit between the model and the user:
 *
 *   1. Brief constraints, enforced in code (§1.3).
 *   2. Similarity against the peer material that informed the draft (§1.4).
 *   3. The user's own approval — which in Phase 1 is not optional at any
 *      confidence score (§3.6).
 */

export async function generateDraft(
  llm: GuruLlm,
  userId: string,
  roadmapElementId: string,
): Promise<ContentDraft> {
  const element = await prisma.roadmapElement.findUniqueOrThrow({
    where: { id: roadmapElementId },
    include: { roadmap: { include: { brief: true } } },
  });

  if (element.roadmap.userId !== userId) {
    throw new Error("Roadmap element belongs to a different user.");
  }

  const brief = element.roadmap.brief;
  const voice = await voiceContext(userId);
  const peerPosts = await prisma.peerPost.findMany({
    where: { userId, content: { not: null } },
    orderBy: { publishedAt: "desc" },
    take: 20,
    select: { content: true },
  });
  const sourceMaterial = peerPosts.map((p) => p.content!).filter(Boolean);

  const patterns = (element.roadmap.peerAnalysis as { patterns?: unknown[] } | null)?.patterns;

  // §3.5's third signal source. Confirmed documents only — documentSignal
  // enforces that — and empty until the user has confirmed one, which is the
  // common case and reads fine in the prompt.
  const documents = await documentSignal(userId);

  const { value, generationId } = await llm.structured(
    {
      userId,
      purpose: "content.draft",
      promptName: CURRENT.contentDraft.name,
      promptVersion: CURRENT.contentDraft.version,
      system: `You write LinkedIn posts as a specific person.\n\n${briefContext(brief)}`,
      prompt: render(CURRENT.contentDraft, {
        roadmapElement: `${element.title}\nWhy: ${element.rationale}\nBusiness goal: ${element.businessGoal}\nAudience: ${element.audienceSegment}\nFormats: ${element.targetFormats.join(", ")}\nTopics: ${element.targetTopics.join(", ")}`,
        brief: briefContext(brief),
        voiceProfile: voice,
        peerPatterns: patterns ? JSON.stringify(patterns, null, 2) : "(no peer analysis available)",
        documentSignal: documents || "(no meeting notes or documents confirmed yet)",
      }),
      effort: "high",
      auditInputs: {
        roadmapElementId,
        roadmapVersion: element.roadmap.version,
        briefVersion: brief.version,
        documentSignalUsed: documents.length > 0,
      },
    },
    ContentDraftSchema,
  );

  // Gate 1 — hard filters from the brief. Enforced here, not in the prompt: a
  // model that honours an instruction 99% of the time is a compliance incident
  // the other 1%.
  assertConstraints(value.content, {
    neverSay: brief.neverSay,
    complianceFlags: brief.complianceFlags,
  });

  // Gate 2 — peer analysis is pattern-learning, not copying, and this is where
  // that claim is enforced. The score is recorded either way for audit.
  const similarity = assertNotDerivative(value.content, sourceMaterial);

  const voiceProfile = await prisma.voiceProfile.findFirst({
    where: { userId, active: true },
    select: { id: true },
  });

  const draft = await prisma.contentDraft.create({
    data: {
      userId,
      roadmapElementId,
      content: value.content,
      format: value.format,
      whyThis: value.whyThis,
      similarityScore: similarity?.score ?? null,
      similarityMatchUrl: null,
      voiceProfileId: voiceProfile?.id ?? null,
      generationId,
    },
  });

  await prisma.draftRevision.create({
    data: {
      draftId: draft.id,
      userId,
      index: 0,
      content: value.content,
      author: "model",
      generationId,
    },
  });

  return draft;
}

/**
 * Conversational refinement — §1.5. A back-and-forth loop, not a regeneration:
 * the instruction is applied to the current text, and every diff is captured as
 * voice-model training data.
 */
export async function refineDraft(
  llm: GuruLlm,
  draftId: string,
  instruction: string,
): Promise<ContentDraft> {
  const draft = await prisma.contentDraft.findUniqueOrThrow({
    where: { id: draftId },
    include: {
      revisions: { orderBy: { index: "desc" }, take: 1 },
      roadmapElement: { include: { roadmap: { include: { brief: true } } } },
    },
  });

  if (draft.status === "PUBLISHED") {
    throw new Error("This draft is already published — refine a new one instead.");
  }

  const brief = draft.roadmapElement.roadmap.brief;
  const current = draft.revisions[0]?.content ?? draft.content;

  const { value, generationId } = await llm.structured(
    {
      userId: draft.userId,
      purpose: "content.refine",
      promptName: CURRENT.refineDraft.name,
      promptVersion: CURRENT.refineDraft.version,
      system: `You revise a LinkedIn post for a specific person.\n\n${briefContext(brief)}`,
      prompt: render(CURRENT.refineDraft, {
        currentDraft: current,
        instruction,
        voiceProfile: await voiceContext(draft.userId),
      }),
      effort: "medium",
      auditInputs: { draftId, instruction, revisionIndex: draft.revisions[0]?.index ?? 0 },
    },
    RefinementSchema,
  );

  assertConstraints(value.content, {
    neverSay: brief.neverSay,
    complianceFlags: brief.complianceFlags,
  });

  const nextIndex = (draft.revisions[0]?.index ?? 0) + 1;

  await prisma.draftRevision.create({
    data: {
      draftId,
      userId: draft.userId,
      index: nextIndex,
      content: value.content,
      author: "model",
      instruction,
      diff: { before: current, after: value.content, whatChanged: value.whatChanged },
      generationId,
    },
  });

  return prisma.contentDraft.update({
    where: { id: draftId },
    data: { content: value.content, status: "IN_REFINEMENT" },
  });
}

/**
 * A direct user edit. Recorded as its own revision because the diff between our
 * last version and theirs is the strongest voice signal we get — see §1.8.
 */
export async function applyUserEdit(
  draftId: string,
  content: string,
): Promise<ContentDraft> {
  const draft = await prisma.contentDraft.findUniqueOrThrow({
    where: { id: draftId },
    include: { revisions: { orderBy: { index: "desc" }, take: 1 } },
  });

  const previous = draft.revisions[0]?.content ?? draft.content;
  if (previous === content) return draft;

  await prisma.draftRevision.create({
    data: {
      draftId,
      userId: draft.userId,
      index: (draft.revisions[0]?.index ?? 0) + 1,
      content,
      author: "user",
      diff: { before: previous, after: content },
    },
  });

  return prisma.contentDraft.update({ where: { id: draftId }, data: { content } });
}

export async function scheduleDraft(draftId: string, when: Date): Promise<ContentDraft> {
  if (when.getTime() < Date.now()) {
    throw new Error("Scheduled time is in the past.");
  }
  return prisma.contentDraft.update({
    where: { id: draftId },
    data: { scheduledFor: when, status: "SCHEDULED" },
  });
}

/**
 * Publish via `w_member_social`.
 *
 * The returned URN is stored on the draft because `r_member_social` is closed
 * (§0.3) — tracking a post forward from creation is the only way Guru knows what
 * it published.
 */
export async function publishDraft(env: Env, draftId: string): Promise<ContentDraft> {
  const draft = await prisma.contentDraft.findUniqueOrThrow({ where: { id: draftId } });

  if (draft.status === "PUBLISHED") return draft;
  if (draft.status === "REJECTED") {
    throw new Error("This draft was rejected — publishing it would ignore that decision.");
  }

  const client = await linkedInClientFor(env, draft.userId);

  try {
    const { urn } = await client.publishPost({ text: draft.content });
    return await prisma.contentDraft.update({
      where: { id: draftId },
      data: {
        status: "PUBLISHED",
        publishedAt: new Date(),
        linkedinUrn: urn,
        publishError: null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.contentDraft.update({
      where: { id: draftId },
      data: { status: "FAILED", publishError: message },
    });
    throw err;
  }
}

/**
 * Publishes everything due. Called by a scheduler; safe to call repeatedly.
 * One failure must not stop the rest of the queue.
 */
export async function publishDueDrafts(env: Env, now = new Date()) {
  const due = await prisma.contentDraft.findMany({
    where: { status: "SCHEDULED", scheduledFor: { lte: now } },
    select: { id: true },
  });

  const results: { draftId: string; ok: boolean; error?: string }[] = [];
  for (const { id } of due) {
    try {
      await publishDraft(env, id);
      results.push({ draftId: id, ok: true });
    } catch (err) {
      results.push({ draftId: id, ok: false, error: (err as Error).message });
    }
  }
  return results;
}

/** Re-check a draft the user edited by hand, before it goes out. */
export async function reviewDraft(draftId: string) {
  const draft = await prisma.contentDraft.findUniqueOrThrow({
    where: { id: draftId },
    include: { roadmapElement: { include: { roadmap: { include: { brief: true } } } } },
  });

  const brief = draft.roadmapElement.roadmap.brief;
  const sources = (
    await prisma.peerPost.findMany({
      where: { userId: draft.userId, content: { not: null } },
      select: { content: true },
      take: 20,
    })
  ).map((p) => p.content!);

  const violations = [] as string[];
  try {
    assertConstraints(draft.content, {
      neverSay: brief.neverSay,
      complianceFlags: brief.complianceFlags,
    });
  } catch (err) {
    violations.push((err as Error).message);
  }

  return { violations, similarity: checkSimilarity(draft.content, sources) };
}

export { LinkedInClient };
