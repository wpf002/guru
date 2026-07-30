import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@guru/db";
import { AUTONOMY_THRESHOLDS, JOBS, evaluateAutonomy } from "@guru/core";
import { BASE_SCOPES, capabilities, parseGrantedScopes } from "@guru/linkedin";
import { ALL_TEMPLATES, CURRENT } from "@guru/prompts";
import { json, makeUser, resetDatabase, scriptedLlm, seedBrief } from "./helpers.js";

/**
 * Roadmap conformance.
 *
 * Every test here asserts a *claim the roadmap makes*, not an implementation
 * detail. The distinction matters: four features in this codebase were fully
 * implemented, type-checked and unit-tested while doing nothing at all, because
 * every test asserted that a function behaved rather than that the promise held.
 *
 * When a claim turns out not to be implementable, the test says so and points at
 * the section — an honest failure recorded once beats rediscovering it.
 */

beforeEach(resetDatabase);

const repoRoot = resolve(process.cwd(), "../..");
const read = (p: string) => readFileSync(resolve(repoRoot, p), "utf8");

describe("§0.4 / §2.5 — no cold outreach, at any confidence", () => {
  it("has no function anywhere that sends a connection request or DM", () => {
    // The roadmap is explicit that no compliant path exists and that the
    // alternatives risk the member's account. This is the test that stops one
    // being added later by someone who didn't read §0.4.
    const linkedInClient = read("packages/linkedin/src/client.ts");

    expect(linkedInClient).not.toMatch(/sendInvitation|sendMessage|createInvitation|sendDm/i);
    expect(linkedInClient).not.toMatch(/\/invitation|\/messaging|\/conversations/i);
  });

  it("refuses autonomous outreach even with a perfect score", () => {
    const decision = evaluateAutonomy(
      {
        killSwitch: false,
        engagementAutonomyEnabled: true,
        contentAutonomyEnabled: true,
        dailyEngagementCap: 100,
        dailyContentCap: 100,
        targetAllowlist: [],
        requireAllowlist: false,
        topicExclusions: [],
      },
      { kind: "OUTREACH", actionsToday: 0, confidenceScore: 1 },
    );

    expect(decision.allowed).toBe(false);
  });

  it("holds outreach to a permanently higher bar than content or engagement", () => {
    expect(AUTONOMY_THRESHOLDS.OUTREACH).toBeGreaterThan(AUTONOMY_THRESHOLDS.CONTENT);
    expect(AUTONOMY_THRESHOLDS.CONTENT).toBeGreaterThan(AUTONOMY_THRESHOLDS.ENGAGEMENT);
  });

  it("drafts outreach without sending it", () => {
    const prospecting = read("apps/api/src/services/prospecting.ts");
    expect(prospecting).toMatch(/deepLink/);
    expect(prospecting).not.toMatch(/linkedInClientFor|client\.comment|client\.publishPost/);
  });
});

describe("§0.1 corrected — publishing and engaging are different scopes", () => {
  it("does not request the vetted scope by default", () => {
    // LinkedIn rejects an authorization request naming an unapproved scope
    // outright, so an optimistic default breaks sign-in entirely.
    expect([...BASE_SCOPES]).not.toContain("w_member_social_feed");
  });

  it("reports publishing as available and engagement as not, on a self-serve grant", () => {
    const granted = parseGrantedScopes("openid profile email w_member_social");
    expect(capabilities(granted)).toEqual({ PUBLISH: true, COMMENT: false, REACT: false });
  });
});

describe("§0.7 — multi-tenant schema", () => {
  it("puts userId on every table holding user data", () => {
    const schema = read("packages/db/prisma/schema.prisma");
    const models = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)];

    // Tables that legitimately have no userId: the user itself, rows owned via
    // a parent, and infrastructure.
    const exempt = new Set([
      "User",
      "IntakeSlot",
      "IntakeTurn",
      "RoadmapElement",
      "PeerPost",
      "JobRun",
    ]);

    const missing = models
      .filter(([, name]) => !exempt.has(name!))
      .filter(([, , body]) => !/\buserId\s+String/.test(body!))
      .map(([, name]) => name);

    expect(missing).toEqual([]);
  });
});

describe("§0.8 — auditable over impressive", () => {
  it("records prompt name, version and model on every generation", async () => {
    const user = await makeUser();
    const { llm } = scriptedLlm([json({ ok: true })]);

    await llm.text({
      userId: user.id,
      purpose: "conformance.check",
      promptName: "conformance.check",
      promptVersion: "1.0.0",
      system: "s",
      prompt: "p",
    });

    const generation = await prisma.generation.findFirstOrThrow({ where: { userId: user.id } });
    expect(generation.promptName).toBe("conformance.check");
    expect(generation.promptVersion).toBe("1.0.0");
    expect(generation.model).toBe("claude-opus-5");
    // The resolved inputs, not references to them — the brief and voice profile
    // behind a generation are both mutable, so a pointer explains nothing later.
    expect(generation.inputs).toMatchObject({ system: "s", prompt: "p" });
  });

  it("never mutates a published prompt version", () => {
    // Two templates may share a name only if their versions differ, and CURRENT
    // must point at something registered.
    const keys = ALL_TEMPLATES.map((t) => `${t.name}@${t.version}`);
    expect(new Set(keys).size).toBe(keys.length);

    for (const template of Object.values(CURRENT)) {
      expect(keys).toContain(`${template.name}@${template.version}`);
    }
  });
});

describe("§1.3 — never-say is a hard filter, not a prompt suggestion", () => {
  it("enforces it in code after generation", () => {
    const content = read("apps/api/src/services/content.ts");
    const engagement = read("apps/api/src/services/engagement.ts");
    const prospecting = read("apps/api/src/services/prospecting.ts");

    // Every surface that produces member-visible text runs the filter.
    expect(content).toMatch(/assertConstraints/);
    expect(engagement).toMatch(/assertConstraints/);
    expect(prospecting).toMatch(/assertConstraints/);
  });
});

describe("§1.4 — strategy before content, enforced by the schema", () => {
  it("makes a draft without a roadmap element impossible", async () => {
    const user = await makeUser();

    await expect(
      // @ts-expect-error — deliberately omitting the required relation.
      prisma.contentDraft.create({ data: { userId: user.id, content: "orphan" } }),
    ).rejects.toThrow();
  });

  it("exposes no route that drafts from a free-text topic", () => {
    const routes = read("apps/api/src/routes/strategy.ts");
    expect(routes).toMatch(/roadmapElementId/);
    expect(routes).not.toMatch(/body\.topic|Body: \{ topic/);
  });
});

describe("§3.5 — all three signal sources reach a prompt", () => {
  it("wires trends, approve/reject, and the user's own work", () => {
    const content = read("apps/api/src/services/content.ts");

    // 1. Trend/peer analysis.
    expect(content).toMatch(/peerPatterns/);
    // 3. The user's own day-to-day work. This one shipped disconnected.
    expect(content).toMatch(/documentSignal/);

    // 2. Approve/reject drives the confidence score.
    const confidence = read("apps/api/src/services/confidence.ts");
    expect(confidence).toMatch(/recomputeCategory/);
  });

  it("only surfaces documents the user confirmed", async () => {
    const user = await makeUser();
    await prisma.sourceDocument.create({
      data: { userId: user.id, source: "UPLOAD", title: "Unconfirmed", summary: "SECRET" },
    });

    const { documentSignal } = await import("../services/documents.js");
    expect(await documentSignal(user.id)).toBe("");
  });
});

describe("§3.6 — Phase 1 non-goals", () => {
  it("keeps autonomy off by default", async () => {
    const user = await makeUser();
    const { settingsFor } = await import("../services/autonomy.js");
    const settings = await settingsFor(user.id);

    expect(settings.engagementAutonomyEnabled).toBe(false);
    expect(settings.contentAutonomyEnabled).toBe(false);
    expect(settings.requireAllowlist).toBe(true);
  });

  it("supports no platform other than LinkedIn", () => {
    const schema = read("packages/db/prisma/schema.prisma");
    expect(schema).not.toMatch(/\b(twitter|mastodon|threads|bluesky)\b/i);
  });
});

describe("§1.10 — the threshold prompt gates nothing in Phase 1", () => {
  it("says so in its own response", async () => {
    const user = await makeUser();
    const { autonomyPromptState } = await import("../services/confidence.js");
    const state = await autonomyPromptState(user.id);

    expect(state.gatesNothing).toBe(true);
    expect(state.ready).toBe(false);
  });
});

describe("§1.1 / §1.5 / §9 — the things Guru does on its own actually run", () => {
  it("schedules every roadmap feature that implies a timer", () => {
    const names = JOBS.map((j) => j.name);
    expect(names).toContain("archive.poll"); // §1.1 watch
    expect(names).toContain("archive.recheck"); // §1.1.5 cadence
    expect(names).toContain("content.publishDue"); // §1.5 queue
    expect(names).toContain("autonomy.run"); // §2.1/2.2
    expect(names).toContain("voice.refresh"); // §1.8 edit diffs
    expect(names).toContain("metrics.weeklyPrompt"); // §9
  });

  it("has a handler for every scheduled job", () => {
    const scheduler = read("apps/api/src/services/scheduler.ts");
    for (const job of JOBS) {
      expect(scheduler).toContain(`"${job.name}"`);
    }
  });
});

describe("§0.5 — Tier 3 scraping is off unless explicitly enabled", () => {
  it("defaults the flag to false and never reaches for it as a fallback", () => {
    const search = read("packages/intel/src/search.ts");
    const engagement = read("apps/api/src/services/engagement.ts");

    expect(search).toMatch(/tier3ScrapingEnabled/);
    // Discovery must not silently escalate tiers when results are thin.
    expect(engagement).not.toMatch(/PUBLIC_SCRAPE/);
  });
});

describe("§0.7 — DM content is opt-in per record", () => {
  it("defaults usableForAnalysis to false and never sets it during ingest", async () => {
    const user = await makeUser();
    const snapshot = await prisma.archiveSnapshot.create({
      data: { userId: user.id, source: "MANUAL_UPLOAD", status: "COMPLETE" },
    });
    const record = await prisma.messageRecord.create({
      data: { userId: user.id, snapshotId: snapshot.id, content: "a dm" },
    });

    expect(record.usableForAnalysis).toBe(false);
    expect(read("apps/api/src/services/archive-ingest.ts")).toMatch(
      /usableForAnalysis: false/,
    );
  });
});

describe("§1.4 / §9 — a metric that cannot be measured is not reported as zero", () => {
  it("returns null with a reason for persona comments received", async () => {
    const user = await makeUser();
    await seedBrief(user.id);
    const { networkPicture } = await import("../services/analysis.js");
    const picture = await networkPicture(user.id);

    // The archive holds comments you left, not comments you received, and
    // r_member_social is closed (§0.3).
    expect(picture.postsThatDrewPersonaComments).toBeNull();
    expect(picture.postsThatDrewPersonaCommentsNote).toMatch(/r_member_social/);
  });
});
