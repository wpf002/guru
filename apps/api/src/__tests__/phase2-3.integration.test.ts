import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@guru/db";
import {
  autonomyLog,
  engageKillSwitch,
  releaseKillSwitch,
  runEngagementAutonomy,
  settingsFor,
  updateSettings,
} from "../services/autonomy.js";
import {
  dismissProspect,
  draftOutreach,
  identifyProspects,
  markSent,
  prospectQueue,
} from "../services/prospecting.js";
import { audienceBreakdown, classifyAudience } from "../services/classification.js";
import { json, makeUser, resetDatabase, scriptedLlm, seedArchive, seedBrief } from "./helpers.js";
import type { Env } from "../env.js";

/** Phases 2 and 3 — autonomy, prospecting, classification. Real database. */

beforeEach(resetDatabase);

const env = {
  nodeEnv: "test",
  port: 0,
  databaseUrl: "",
  linkedin: {
    clientId: "x",
    clientSecret: "x",
    redirectUri: "x",
    feedScopesApproved: false,
  },
  google: null,
  intel: null,
  webOrigin: "http://localhost:3000",
} satisfies Env;

async function seedEngagementDraft(userId: string, authorName = "A Peer") {
  const target = await prisma.engagementTarget.create({
    data: {
      userId,
      postUrl: `urn:li:activity:${Math.random()}`,
      authorName,
      postContent: "A post.",
      postedAt: new Date(),
      tier: "SEARCH_INDEX",
      priorityScore: 0.9,
    },
  });
  return prisma.engagementDraft.create({
    data: { userId, targetId: target.id, kind: "COMMENT", content: "A substantive comment." },
  });
}

async function setScore(userId: string, category: "ENGAGEMENT_TARGET", score: number) {
  await prisma.confidenceScore.upsert({
    where: { userId_category: { userId, category } },
    update: { score, sampleSize: 50 },
    create: { userId, category, score, sampleSize: 50 },
  });
}

describe("§2.1 autonomy guardrails", () => {
  it("defaults to everything off and the allowlist required", async () => {
    const user = await makeUser();
    const settings = await settingsFor(user.id);

    expect(settings.engagementAutonomyEnabled).toBe(false);
    expect(settings.contentAutonomyEnabled).toBe(false);
    expect(settings.requireAllowlist).toBe(true);
    expect(settings.targetAllowlist).toEqual([]);
    expect(settings.killSwitch).toBe(false);
  });

  it("blocks and logs when autonomy is switched off", async () => {
    const user = await makeUser();
    await seedEngagementDraft(user.id);

    const result = await runEngagementAutonomy(env, user.id);

    expect(result.published).toBe(0);
    expect(result.blocked[0]!.outcome).toBe("BLOCKED_CONFIDENCE");

    const log = await autonomyLog(user.id);
    expect(log).toHaveLength(1);
    expect(log[0]!.outcome).toBe("BLOCKED_CONFIDENCE");
  });

  it("blocks on an empty allowlist even when confidence is perfect", async () => {
    // "No allowlist configured" must never quietly mean "everyone is allowed".
    const user = await makeUser();
    await seedEngagementDraft(user.id);
    await updateSettings(user.id, { engagementAutonomyEnabled: true });
    await setScore(user.id, "ENGAGEMENT_TARGET", 1);

    const result = await runEngagementAutonomy(env, user.id);
    expect(result.blocked[0]!.outcome).toBe("BLOCKED_ALLOWLIST");
  });

  it("blocks on an excluded topic", async () => {
    const user = await makeUser();
    const draft = await seedEngagementDraft(user.id);
    await prisma.engagementDraft.update({
      where: { id: draft.id },
      data: { content: "Following the layoffs last quarter..." },
    });
    await updateSettings(user.id, {
      engagementAutonomyEnabled: true,
      targetAllowlist: ["A Peer"],
      topicExclusions: ["layoffs"],
    });
    await setScore(user.id, "ENGAGEMENT_TARGET", 1);

    const result = await runEngagementAutonomy(env, user.id);
    expect(result.blocked[0]!.outcome).toBe("BLOCKED_CONSTRAINT");
    expect(result.blocked[0]!.reason).toMatch(/layoffs/);
  });

  it("halts the whole run on the kill switch, ahead of every other gate", async () => {
    const user = await makeUser();
    await seedEngagementDraft(user.id);
    await seedEngagementDraft(user.id);
    await updateSettings(user.id, {
      engagementAutonomyEnabled: true,
      targetAllowlist: ["A Peer"],
    });
    await setScore(user.id, "ENGAGEMENT_TARGET", 1);
    await engageKillSwitch(user.id, "Client escalation");

    const result = await runEngagementAutonomy(env, user.id);

    expect(result.published).toBe(0);
    expect(result.blocked).toHaveLength(1); // stops the run, does not iterate
    expect(result.blocked[0]!.outcome).toBe("BLOCKED_KILL_SWITCH");
    expect(result.blocked[0]!.reason).toBe("Client escalation");
  });

  it("does not let a settings update silently clear the kill switch", async () => {
    const user = await makeUser();
    await engageKillSwitch(user.id, "Stopped");
    const updated = await updateSettings(user.id, { dailyEngagementCap: 20 });

    expect(updated.killSwitch).toBe(true);
    expect(updated.dailyEngagementCap).toBe(20);

    const released = await releaseKillSwitch(user.id);
    expect(released.killSwitch).toBe(false);
    expect(released.killSwitchReason).toBeNull();
  });

  it("records a confidence snapshot on each logged action", async () => {
    // A later score change must not rewrite why an action was allowed.
    const user = await makeUser();
    await seedEngagementDraft(user.id);
    await setScore(user.id, "ENGAGEMENT_TARGET", 0.42);

    await runEngagementAutonomy(env, user.id);

    const log = await autonomyLog(user.id);
    expect(log[0]!.confidenceSnapshot).toEqual([
      { category: "ENGAGEMENT_TARGET", score: 0.42 },
    ]);
  });
});

describe("§2.3–2.4 prospecting and assisted outreach", () => {
  it("builds a list from high-fit existing connections only", async () => {
    const user = await makeUser();
    const fitScores = [0.95, 0.9, 0.2, 0.1, 0.85];
    await seedArchive(user.id, { connections: 5, fitScores });

    const prospects = await identifyProspects(user.id, { minFit: 0.7 });

    expect(prospects).toHaveLength(3);
    expect(prospects.every((p) => (p.personaFit ?? 0) >= 0.7)).toBe(true);
  });

  it("does not re-add someone already on the list", async () => {
    const user = await makeUser();
    await seedArchive(user.id, { connections: 3, fitScores: [0.9, 0.9, 0.9] });

    await identifyProspects(user.id);
    const second = await identifyProspects(user.id);

    expect(second).toHaveLength(0);
    expect(await prisma.prospectTarget.count({ where: { userId: user.id } })).toBe(3);
  });

  it("drafts a message and returns a deep link — and sends nothing", async () => {
    const user = await makeUser();
    await seedBrief(user.id);
    await seedArchive(user.id, { connections: 1, fitScores: [0.95] });
    const [prospect] = await identifyProspects(user.id);

    const { llm } = scriptedLlm([
      json({
        message: "You mentioned the WMS migration last spring — how did the cutover land?",
        whyThisPerson: "VP Ops mid-migration is exactly when fractional help lands.",
      }),
    ]);

    const assisted = await draftOutreach(llm, prospect!.id);

    expect(assisted.message).toMatch(/WMS migration/);
    expect(assisted.deepLink).toContain("linkedin.com");
    expect(assisted.prospect.status).toBe("DRAFTED");
    // Nothing about this call contacts LinkedIn; the status only advances when
    // the user reports having sent it.
    expect(assisted.prospect.sentAt).toBeNull();
  });

  it("applies the brief's never-say list to outreach", async () => {
    const user = await makeUser();
    await seedBrief(user.id);
    await seedArchive(user.id, { connections: 1, fitScores: [0.95] });
    const [prospect] = await identifyProspects(user.id);

    const { llm } = scriptedLlm([
      json({ message: "Results are guaranteed.", whyThisPerson: "x" }),
    ]);

    await expect(draftOutreach(llm, prospect!.id)).rejects.toThrow(/constraints/i);
  });

  it("tracks user-reported sends and dismissals out of the queue", async () => {
    const user = await makeUser();
    await seedArchive(user.id, { connections: 2, fitScores: [0.9, 0.9] });
    const prospects = await identifyProspects(user.id);

    await markSent(prospects[0]!.id);
    await dismissProspect(prospects[1]!.id);

    expect(await prospectQueue(user.id)).toHaveLength(0);
    const sent = await prisma.prospectTarget.findUniqueOrThrow({
      where: { id: prospects[0]!.id },
    });
    expect(sent.sentAt).not.toBeNull();
  });
});

describe("§5 customer/operator classification", () => {
  it("labels connections and reports the distribution", async () => {
    const user = await makeUser();
    await seedBrief(user.id);
    await seedArchive(user.id, { connections: 3, fitScores: [0.9, 0.8, 0.7] });

    const { llm } = scriptedLlm([
      json({ axis: "CUSTOMER", confidence: 0.8, reason: "VP Ops at a grocer" }),
      json({ axis: "OPERATOR", confidence: 0.6, reason: "Independent consultant" }),
      json({ axis: "UNKNOWN", confidence: 0.2, reason: "Title says nothing" }),
    ]);

    const result = await classifyAudience(llm, user.id);

    expect(result.classified).toBe(3);
    expect(result.distribution).toMatchObject({ CUSTOMER: 1, OPERATOR: 1, UNKNOWN: 1 });

    const breakdown = await audienceBreakdown(user.id);
    expect(breakdown.total).toBe(3);
    expect(breakdown.note).toMatch(/direction, not spec/);
  });

  it("does not reclassify someone already labeled", async () => {
    const user = await makeUser();
    await seedBrief(user.id);
    await seedArchive(user.id, { connections: 2, fitScores: [0.9, 0.9] });

    const script = scriptedLlm([
      json({ axis: "CUSTOMER", confidence: 0.8, reason: "a" }),
      json({ axis: "PEER", confidence: 0.5, reason: "b" }),
    ]);
    await classifyAudience(script.llm, user.id);

    // An exhausted script would throw if this tried to classify anyone again.
    const second = await classifyAudience(script.llm, user.id);
    expect(second.classified).toBe(0);
  });

  it("refuses to classify before a brief defines what a customer is", async () => {
    const user = await makeUser();
    await seedArchive(user.id, { connections: 1, fitScores: [0.9] });
    const { llm } = scriptedLlm([]);

    await expect(classifyAudience(llm, user.id)).rejects.toThrow(/brief/i);
  });
});
