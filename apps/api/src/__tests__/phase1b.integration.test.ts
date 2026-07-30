import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@guru/db";
import { ConstraintViolationError, SimilarityError } from "@guru/core";
import { scorePersonaFit, networkPicture, setPeers } from "../services/analysis.js";
import { generateRoadmap, activeRoadmap } from "../services/roadmap.js";
import {
  applyUserEdit,
  generateDraft,
  refineDraft,
  reviewDraft,
  scheduleDraft,
} from "../services/content.js";
import {
  json,
  makeUser,
  resetDatabase,
  scriptedLlm,
  seedArchive,
  seedBrief,
  seedRoadmap,
} from "./helpers.js";

/** Phase 1b — analysis, roadmap, content engine. Real database. */

beforeEach(resetDatabase);

const PEER_POST =
  "Most founders think distribution is a marketing problem. It is not. " +
  "Distribution is a product decision you make on day one, and every day after that.";

describe("§1.4 persona-fit scoring", () => {
  it("scores connections and records which brief they were scored against", async () => {
    const user = await makeUser();
    await seedArchive(user.id, { connections: 3 });
    const brief = await seedBrief(user.id);

    const { llm } = scriptedLlm([
      json({
        scores: [
          { index: 0, fit: 0.9, reason: "VP Ops at a grocer" },
          { index: 1, fit: 0.1, reason: "Analyst, not a buyer" },
          { index: 2, fit: 0.8, reason: "VP Ops" },
        ],
      }),
    ]);

    const result = await scorePersonaFit(llm, user.id);
    expect(result.scored).toBe(3);
    expect(result.remaining).toBe(0);

    const scored = await prisma.connection.findMany({ where: { userId: user.id } });
    expect(scored.every((c) => c.scoredAgainstBriefId === brief.id)).toBe(true);
  });

  it("re-scores everything when a newer brief supersedes the old one", async () => {
    // A revised persona makes every prior score stale — that is the whole
    // reason scoredAgainstBriefId exists.
    const user = await makeUser();
    await seedArchive(user.id, { connections: 2 });
    const v1 = await seedBrief(user.id);

    const first = scriptedLlm([
      json({ scores: [{ index: 0, fit: 0.9, reason: "x" }, { index: 1, fit: 0.2, reason: "y" }] }),
    ]);
    await scorePersonaFit(first.llm, user.id);

    const v2 = await prisma.strategicBrief.create({
      data: { ...briefFields(user.id), version: 2 },
    });
    await prisma.strategicBrief.update({
      where: { id: v1.id },
      data: { supersededById: v2.id },
    });

    const second = scriptedLlm([
      json({ scores: [{ index: 0, fit: 0.4, reason: "a" }, { index: 1, fit: 0.4, reason: "b" }] }),
    ]);
    const result = await scorePersonaFit(second.llm, user.id);

    expect(result.scored).toBe(2);
    const rows = await prisma.connection.findMany({ where: { userId: user.id } });
    expect(rows.every((c) => c.scoredAgainstBriefId === v2.id)).toBe(true);
  });

  it("ignores out-of-range indices in the model's response", async () => {
    const user = await makeUser();
    await seedArchive(user.id, { connections: 2 });
    await seedBrief(user.id);

    const { llm } = scriptedLlm([
      json({
        scores: [
          { index: 0, fit: 0.9, reason: "ok" },
          { index: 99, fit: 1, reason: "does not exist" },
        ],
      }),
    ]);

    await expect(scorePersonaFit(llm, user.id)).resolves.toBeDefined();
    const scoredCount = await prisma.connection.count({
      where: { userId: user.id, personaFitScore: { not: null } },
    });
    expect(scoredCount).toBe(1);
  });

  it("refuses to score before a brief exists", async () => {
    const user = await makeUser();
    await seedArchive(user.id, { connections: 2 });
    const { llm } = scriptedLlm([]);
    await expect(scorePersonaFit(llm, user.id)).rejects.toThrow(/brief/i);
  });
});

describe("§1.4 network picture", () => {
  it("treats a large, badly-fitting network as sparse", async () => {
    const user = await makeUser();
    // 600 connections, 5% fit — the spec's raw-size heuristic would call this
    // moderate; effective reach is 30.
    const fitScores = Array.from({ length: 600 }, (_, i) => (i < 30 ? 0.9 : 0.1));
    await seedArchive(user.id, { connections: 600, fitScores });

    const picture = await networkPicture(user.id);
    expect(picture.connectionCount).toBe(600);
    expect(picture.effectiveReach).toBe(30);
    expect(picture.density).toBe("SPARSE");
    expect(picture.needsNetworkBuilding).toBe(true);
  });
});

describe("§1.4 roadmap", () => {
  it("generates a versioned roadmap with elements and degrades without intel", async () => {
    const user = await makeUser();
    await seedArchive(user.id, { connections: 10 });
    await seedBrief(user.id);

    const { llm } = scriptedLlm([
      json({
        summary: "Build authority before scaling reach.",
        elements: [
          {
            phase: 1,
            title: "Name the cost of spoilage",
            rationale: "Buyers do not know what it costs them.",
            businessGoal: "inbound",
            audienceSegment: "VP Ops",
            targetFormats: ["short post"],
            targetTopics: ["spoilage"],
          },
        ],
      }),
    ]);

    // No intel config — the roadmap must still generate, marked degraded.
    const roadmap = await generateRoadmap(llm, user.id, null);

    expect(roadmap.version).toBe(1);
    expect((roadmap.trendAnalysis as { degraded: boolean }).degraded).toBe(true);

    const loaded = await activeRoadmap(user.id);
    expect(loaded!.elements).toHaveLength(1);
    expect(loaded!.elements[0]!.rationale).toMatch(/costs them/);
  });

  it("rejects a roadmap whose element has no rationale", async () => {
    const user = await makeUser();
    await seedBrief(user.id);
    const { llm } = scriptedLlm([
      json({
        summary: "x",
        elements: [
          {
            phase: 1,
            title: "A title",
            rationale: "",
            businessGoal: "",
            audienceSegment: "",
            targetFormats: [],
            targetTopics: [],
          },
        ],
      }),
    ]);

    await expect(generateRoadmap(llm, user.id, null)).rejects.toThrow(/schema/i);
  });

  it("stores peers as inactive when replaced", async () => {
    const user = await makeUser();
    await setPeers(user.id, [{ name: "Alice" }, { name: "Bob" }]);
    await setPeers(user.id, [{ name: "Carol" }]);

    const active = await prisma.peer.findMany({ where: { userId: user.id, active: true } });
    expect(active.map((p) => p.name)).toEqual(["Carol"]);
    expect(await prisma.peer.count({ where: { userId: user.id } })).toBe(3);
  });
});

describe("§1.5 content engine", () => {
  async function setup() {
    const user = await makeUser();
    const brief = await seedBrief(user.id);
    const roadmap = await seedRoadmap(user.id, brief.id);
    return { user, brief, element: roadmap.elements[0]! };
  }

  it("creates a draft tied to its roadmap element with an opening revision", async () => {
    const { user, element } = await setup();
    const { llm } = scriptedLlm([
      json({
        content: "Spoilage is not a cost of doing business. It is a design failure.",
        format: "short post",
        whyThis: "Serves phase 1: name the cost.",
      }),
    ]);

    const draft = await generateDraft(llm, user.id, element.id);

    expect(draft.roadmapElementId).toBe(element.id);
    expect(draft.whyThis).toMatch(/phase 1/i);

    const revisions = await prisma.draftRevision.findMany({ where: { draftId: draft.id } });
    expect(revisions).toHaveLength(1);
    expect(revisions[0]!.author).toBe("model");
  });

  it("blocks a draft that violates the brief's never-say list", async () => {
    const { user, element } = await setup();
    const { llm } = scriptedLlm([
      json({
        content: "Results are guaranteed if you follow this playbook.",
        format: "short post",
        whyThis: "x",
      }),
    ]);

    await expect(generateDraft(llm, user.id, element.id)).rejects.toBeInstanceOf(
      ConstraintViolationError,
    );
    expect(await prisma.contentDraft.count({ where: { userId: user.id } })).toBe(0);
  });

  it("blocks a draft lifted from peer material", async () => {
    const { user, element } = await setup();
    await prisma.peer.create({
      data: {
        userId: user.id,
        name: "A Peer",
        posts: {
          create: { userId: user.id, tier: "SEARCH_INDEX", url: "u", content: PEER_POST },
        },
      },
    });

    const { llm } = scriptedLlm([
      json({ content: PEER_POST, format: "short post", whyThis: "x" }),
    ]);

    await expect(generateDraft(llm, user.id, element.id)).rejects.toBeInstanceOf(
      SimilarityError,
    );
    expect(await prisma.contentDraft.count({ where: { userId: user.id } })).toBe(0);
  });

  it("records a similarity score on drafts that pass the gate", async () => {
    const { user, element } = await setup();
    await prisma.peer.create({
      data: {
        userId: user.id,
        name: "A Peer",
        posts: {
          create: { userId: user.id, tier: "SEARCH_INDEX", url: "u", content: PEER_POST },
        },
      },
    });

    const { llm } = scriptedLlm([
      json({
        content:
          "I keep meeting grocery teams who treat spoilage as weather. It is a schedule you chose.",
        format: "short post",
        whyThis: "x",
      }),
    ]);

    const draft = await generateDraft(llm, user.id, element.id);
    expect(draft.similarityScore).not.toBeNull();
    expect(draft.similarityScore!).toBeLessThan(0.25);
  });

  it("refines in place and captures the diff as training data", async () => {
    const { user, element } = await setup();
    const script = scriptedLlm([
      json({ content: "First version of the post.", format: "short post", whyThis: "x" }),
      json({ content: "Shorter version.", whatChanged: "Cut the second paragraph." }),
    ]);

    const draft = await generateDraft(script.llm, user.id, element.id);
    const refined = await refineDraft(script.llm, draft.id, "shorter");

    expect(refined.content).toBe("Shorter version.");
    expect(refined.status).toBe("IN_REFINEMENT");

    const revisions = await prisma.draftRevision.findMany({
      where: { draftId: draft.id },
      orderBy: { index: "asc" },
    });
    expect(revisions).toHaveLength(2);
    expect(revisions[1]!.instruction).toBe("shorter");
    expect(revisions[1]!.diff).toMatchObject({ before: "First version of the post." });
  });

  it("records a user edit as its own revision", async () => {
    const { user, element } = await setup();
    const script = scriptedLlm([
      json({ content: "Model version.", format: "short post", whyThis: "x" }),
    ]);
    const draft = await generateDraft(script.llm, user.id, element.id);

    await applyUserEdit(draft.id, "My version, in my words.");

    const revisions = await prisma.draftRevision.findMany({
      where: { draftId: draft.id },
      orderBy: { index: "asc" },
    });
    expect(revisions[1]!.author).toBe("user");
    expect(revisions[1]!.diff).toMatchObject({ before: "Model version." });
  });

  it("does not create a revision when the edit changes nothing", async () => {
    const { user, element } = await setup();
    const script = scriptedLlm([
      json({ content: "Unchanged.", format: "short post", whyThis: "x" }),
    ]);
    const draft = await generateDraft(script.llm, user.id, element.id);

    await applyUserEdit(draft.id, "Unchanged.");
    expect(await prisma.draftRevision.count({ where: { draftId: draft.id } })).toBe(1);
  });

  it("re-checks a hand-edited draft before it goes out", async () => {
    const { user, element } = await setup();
    const script = scriptedLlm([
      json({ content: "Clean copy.", format: "short post", whyThis: "x" }),
    ]);
    const draft = await generateDraft(script.llm, user.id, element.id);

    await applyUserEdit(draft.id, "Results are guaranteed.");
    const review = await reviewDraft(draft.id);

    expect(review.violations).toHaveLength(1);
    expect(review.violations[0]).toMatch(/guaranteed/);
  });

  it("rejects a scheduled time in the past", async () => {
    const { user, element } = await setup();
    const script = scriptedLlm([
      json({ content: "A post.", format: "short post", whyThis: "x" }),
    ]);
    const draft = await generateDraft(script.llm, user.id, element.id);

    await expect(scheduleDraft(draft.id, new Date(Date.now() - 1000))).rejects.toThrow(
      /past/i,
    );
    const scheduled = await scheduleDraft(draft.id, new Date(Date.now() + 60_000));
    expect(scheduled.status).toBe("SCHEDULED");
  });
});

function briefFields(userId: string) {
  return {
    userId,
    role: "Operations consultant",
    industry: "Logistics",
    niche: "Third-party logistics",
    subNiche: "Cold-chain 3PL",
    offer: "Fractional ops leadership",
    neverSay: ["guaranteed"],
    complianceFlags: [],
  };
}
