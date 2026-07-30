import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@guru/db";
import { ConstraintViolationError } from "@guru/core";
import { discoverTargets, draftComment, targetQueue } from "../services/engagement.js";
import {
  autonomyPromptState,
  confidenceDashboard,
  recordDecision,
} from "../services/confidence.js";
import { buildVoiceProfile, editsPerDraftTrend, voiceContext } from "../services/voice.js";
import {
  deleteDocument,
  documentSignal,
  ingestUploadedDocument,
} from "../services/documents.js";
import { metricsView, recordWeeklyReport } from "../services/metrics.js";
import { json, makeUser, resetDatabase, scriptedLlm, seedArchive, seedBrief } from "./helpers.js";

/** Phases 1c–1e — engagement, confidence, voice, documents, metrics. Real database. */

beforeEach(resetDatabase);

async function seedTarget(userId: string, overrides: Record<string, unknown> = {}) {
  return prisma.engagementTarget.create({
    data: {
      userId,
      postUrl: "urn:li:activity:12345",
      authorName: "A Peer",
      postContent:
        "Cold chain failures are a staffing problem. Every operator I know is short-handed.",
      postedAt: new Date(),
      tier: "SEARCH_INDEX",
      priorityScore: 0.8,
      ...overrides,
    },
  });
}

describe("§1.6 engagement engine", () => {
  it("reports degraded rather than failing when no intel provider is configured", async () => {
    const user = await makeUser();
    await seedBrief(user.id);
    const { llm } = scriptedLlm([]);

    const result = await discoverTargets(llm, user.id, null);
    expect(result).toEqual({ discovered: 0, degraded: true });
  });

  it("drafts a comment carrying its own why", async () => {
    const user = await makeUser();
    await seedBrief(user.id);
    const target = await seedTarget(user.id);

    const { llm } = scriptedLlm([
      json({
        content: "Short-handed is downstream. The schedule assumes nobody calls in sick.",
        whyThis: "Author's audience is exactly our persona.",
      }),
    ]);

    const draft = await draftComment(llm, target.id);
    expect(draft.kind).toBe("COMMENT");
    expect(draft.status).toBe("DRAFT");
    expect(draft.whyThis).toMatch(/persona/i);
  });

  it("refuses to draft a comment on a post whose content was never retrieved", async () => {
    // A comment written without reading the post is exactly the kind we refuse
    // to send.
    const user = await makeUser();
    await seedBrief(user.id);
    const target = await seedTarget(user.id, { postContent: null });
    const { llm } = scriptedLlm([]);

    await expect(draftComment(llm, target.id)).rejects.toThrow(/without reading the post/i);
  });

  it("applies the brief's never-say list to comments", async () => {
    const user = await makeUser();
    await seedBrief(user.id);
    const target = await seedTarget(user.id);
    const { llm } = scriptedLlm([
      json({ content: "Fix this and results are guaranteed.", whyThis: "x" }),
    ]);

    await expect(draftComment(llm, target.id)).rejects.toBeInstanceOf(ConstraintViolationError);
    expect(await prisma.engagementDraft.count({ where: { userId: user.id } })).toBe(0);
  });

  it("orders the queue by priority and hides acted-on targets", async () => {
    const user = await makeUser();
    await seedTarget(user.id, { postUrl: "urn:a", priorityScore: 0.2 });
    await seedTarget(user.id, { postUrl: "urn:b", priorityScore: 0.9 });
    await seedTarget(user.id, { postUrl: "urn:c", priorityScore: 0.95, actedAt: new Date() });

    const queue = await targetQueue(user.id);
    expect(queue.map((t) => t.postUrl)).toEqual(["urn:b", "urn:a"]);
  });
});

describe("§1.7 confidence", () => {
  async function decide(userId: string, count: number, type: "APPROVE" | "REJECT") {
    for (let i = 0; i < count; i++) {
      await recordDecision({ userId, type, category: "TONE", contentDraftId: undefined, engagementDraftId: undefined } as never).catch(
        () => undefined,
      );
    }
  }
  void decide;

  async function draftFor(userId: string) {
    const brief = await seedBrief(userId, { version: Math.floor(Math.random() * 1e9) });
    const roadmap = await prisma.roadmap.create({
      data: {
        userId,
        briefId: brief.id,
        version: Math.floor(Math.random() * 1e9),
        elements: { create: [{ phase: 1, title: "t", rationale: "r", order: 0 }] },
      },
      include: { elements: true },
    });
    return prisma.contentDraft.create({
      data: { userId, roadmapElementId: roadmap.elements[0]!.id, content: "A post." },
    });
  }

  it("requires a draft reference", async () => {
    const user = await makeUser();
    await expect(
      recordDecision({ userId: user.id, type: "APPROVE", category: "TONE" }),
    ).rejects.toThrow(/must reference/i);
  });

  it("moves the draft's status and logs a confidence event", async () => {
    const user = await makeUser();
    const draft = await draftFor(user.id);

    await recordDecision({
      userId: user.id,
      type: "APPROVE",
      category: "TONE",
      contentDraftId: draft.id,
    });

    const updated = await prisma.contentDraft.findUniqueOrThrow({ where: { id: draft.id } });
    expect(updated.status).toBe("APPROVED");

    const events = await prisma.confidenceEvent.findMany({ where: { userId: user.id } });
    expect(events).toHaveLength(1);
    expect(events[0]!.sampleSize).toBe(1);
  });

  it("shows no score below the minimum sample size", async () => {
    const user = await makeUser();
    for (let i = 0; i < 5; i++) {
      const draft = await draftFor(user.id);
      await recordDecision({
        userId: user.id,
        type: "APPROVE",
        category: "TONE",
        contentDraftId: draft.id,
      });
    }

    const dashboard = await confidenceDashboard(user.id);
    const tone = dashboard.categories.find((c) => c.category === "TONE")!;
    // Not zero — "not enough data" and "you keep rejecting these" are different.
    expect(tone.score).toBeNull();
    expect(tone.sampleSize).toBe(5);
    expect(tone.note).toMatch(/15 more decisions/);
  });

  it("scores a category once it clears the minimum", async () => {
    const user = await makeUser();
    for (let i = 0; i < 20; i++) {
      const draft = await draftFor(user.id);
      await recordDecision({
        userId: user.id,
        type: "APPROVE",
        category: "TONE",
        contentDraftId: draft.id,
      });
    }

    const dashboard = await confidenceDashboard(user.id);
    const tone = dashboard.categories.find((c) => c.category === "TONE")!;
    expect(tone.score).toBeCloseTo(1, 3);
    expect(tone.meetsThreshold).toBe(true);
  });

  it("keeps the autonomy prompt closed while any category is unscored", async () => {
    const user = await makeUser();
    for (let i = 0; i < 20; i++) {
      const draft = await draftFor(user.id);
      await recordDecision({
        userId: user.id,
        type: "APPROVE",
        category: "TONE",
        contentDraftId: draft.id,
      });
    }

    const state = await autonomyPromptState(user.id);
    expect(state.ready).toBe(false);
    expect(state.gatesNothing).toBe(true);
  });

  it("does not let a rejection overwrite an already-approved draft", async () => {
    const user = await makeUser();
    const draft = await draftFor(user.id);

    await recordDecision({
      userId: user.id,
      type: "APPROVE",
      category: "TONE",
      contentDraftId: draft.id,
    });
    // A second, per-category decision must score without flipping the artifact.
    await recordDecision({
      userId: user.id,
      type: "REJECT",
      category: "FORMAT",
      contentDraftId: draft.id,
    });

    const updated = await prisma.contentDraft.findUniqueOrThrow({ where: { id: draft.id } });
    expect(updated.status).toBe("APPROVED");
  });
});

describe("§1.8 voice model", () => {
  it("cold-starts from the comment corpus", async () => {
    const user = await makeUser();
    await seedArchive(user.id, {
      comments: [
        "Most people think distribution is a marketing problem. It is not.",
        "Disagree. The constraint is scheduling, not headcount.",
      ],
      shares: [{ content: "A longer post about spoilage.", publishedAt: new Date() }],
    });

    const { llm } = scriptedLlm([
      json({
        summary: "Blunt, contrarian openers. Short sentences. No hedging.",
        traits: {
          rhythm: "short",
          openings: "contrarian",
          endings: "abrupt",
          punctuation: "plain",
          vocabulary: "operational",
          stance: "assertive",
          formatting: "single paragraph",
          humour: "dry",
        },
      }),
    ]);

    const profile = await buildVoiceProfile(llm, user.id);
    expect(profile.version).toBe(1);
    expect(profile.active).toBe(true);
    expect(profile.sourceCommentCount).toBe(2);
    expect(profile.sourceShareCount).toBe(1);

    const context = await voiceContext(user.id);
    expect(context).toMatch(/contrarian/i);
  });

  it("deactivates the previous profile when a new one is built", async () => {
    const user = await makeUser();
    await seedArchive(user.id, { comments: ["A comment with words in it."] });

    const payload = json({
      summary: "s",
      traits: {
        rhythm: "",
        openings: "",
        endings: "",
        punctuation: "",
        vocabulary: "",
        stance: "",
        formatting: "",
        humour: "",
      },
    });

    const script = scriptedLlm([payload, payload]);
    await buildVoiceProfile(script.llm, user.id);
    const second = await buildVoiceProfile(script.llm, user.id);

    expect(second.version).toBe(2);
    const active = await prisma.voiceProfile.findMany({
      where: { userId: user.id, active: true },
    });
    expect(active).toHaveLength(1);
    expect(active[0]!.id).toBe(second.id);
  });

  it("refuses to build a profile with no samples", async () => {
    const user = await makeUser();
    const { llm } = scriptedLlm([]);
    await expect(buildVoiceProfile(llm, user.id)).rejects.toThrow(/no writing samples/i);
  });

  it("reports edits per draft as null before any drafts exist", async () => {
    const user = await makeUser();
    const trend = await editsPerDraftTrend(user.id);
    expect(trend.current).toBeNull();
    expect(trend.improving).toBeNull();
  });
});

describe("§1.9 documents", () => {
  it("stores only summary, excerpts, and insights — never the raw text", async () => {
    const user = await makeUser();
    const raw =
      "MEETING TRANSCRIPT. Confidential. Acme said their margin is 3% and they hate their WMS vendor.";

    const { llm } = scriptedLlm([
      json({
        summary: "A grocer described thin margins and vendor frustration.",
        insights: ["WMS dissatisfaction is common"],
        recurringProblems: ["Vendor lock-in"],
        clientLanguage: ["we're flying blind between the dock and the shelf"],
      }),
    ]);

    const doc = await ingestUploadedDocument(llm, user.id, {
      title: "Notes",
      raw,
      taggedExcerpts: ["flying blind"],
    });

    expect(doc.confirmedAt).not.toBeNull();
    expect(JSON.stringify(doc)).not.toContain("Confidential");
    expect(JSON.stringify(doc)).not.toContain("3%");

    // The audit row must not carry the transcript either.
    const generation = await prisma.generation.findFirstOrThrow({ where: { userId: user.id } });
    expect(JSON.stringify(generation.inputs)).not.toContain("Confidential");
  });

  it("surfaces only confirmed documents to the strategy layer", async () => {
    const user = await makeUser();
    await prisma.sourceDocument.create({
      data: { userId: user.id, source: "UPLOAD", title: "Unconfirmed", summary: "SECRET" },
    });

    expect(await documentSignal(user.id)).toBe("");
  });

  it("really deletes", async () => {
    const user = await makeUser();
    const { llm } = scriptedLlm([
      json({ summary: "s", insights: [], recurringProblems: [], clientLanguage: [] }),
    ]);
    const doc = await ingestUploadedDocument(llm, user.id, { title: "t", raw: "body" });

    await deleteDocument(doc.id);
    expect(await prisma.sourceDocument.count({ where: { id: doc.id } })).toBe(0);
  });
});

describe("§9 metrics", () => {
  it("records a weekly report and derives what the archive already knows", async () => {
    const user = await makeUser();
    await seedArchive(user.id, { connections: 5 });

    const report = await recordWeeklyReport(user.id, {
      qualifiedConversations: 2,
      profileViews: 140,
    });

    expect(report.qualifiedConversations).toBe(2);
    expect(report.inboundFromPersona).toBe(5);
  });

  it("states plainly why engagement numbers are self-reported", async () => {
    const user = await makeUser();
    const view = await metricsView(user.id);
    expect(view.notes.join(" ")).toMatch(/r_member_social is a closed permission/);
  });
});
