import { describe, expect, it } from "vitest";
import {
  AUTONOMY_THRESHOLDS,
  evaluateAutonomy,
  type AutonomyGuardrails,
  type AutonomyRequest,
} from "../autonomy.js";

const permissive: AutonomyGuardrails = {
  killSwitch: false,
  engagementAutonomyEnabled: true,
  contentAutonomyEnabled: true,
  dailyEngagementCap: 5,
  dailyContentCap: 1,
  targetAllowlist: ["Jane Doe"],
  requireAllowlist: true,
  topicExclusions: [],
};

const engagement: AutonomyRequest = {
  kind: "ENGAGEMENT",
  actionsToday: 0,
  confidenceScore: 0.95,
  targetIdentifier: "Jane Doe",
  text: "A substantive point about logistics margins.",
};

describe("evaluateAutonomy", () => {
  it("allows an action that clears every gate", () => {
    expect(evaluateAutonomy(permissive, engagement)).toEqual({ allowed: true });
  });

  it("checks the kill switch before anything else", () => {
    // A user who hits the kill switch should not have to out-argue a score.
    const decision = evaluateAutonomy(
      { ...permissive, killSwitch: true, killSwitchReason: "Client escalation" },
      { ...engagement, confidenceScore: 1, actionsToday: 0 },
    );
    expect(decision).toMatchObject({
      allowed: false,
      outcome: "BLOCKED_KILL_SWITCH",
      reason: "Client escalation",
    });
  });

  it("blocks when the kind of autonomy is switched off", () => {
    expect(
      evaluateAutonomy({ ...permissive, engagementAutonomyEnabled: false }, engagement),
    ).toMatchObject({ outcome: "BLOCKED_CONFIDENCE" });
  });

  it("never allows autonomous outreach, at any score", () => {
    // No compliant send path exists (§0.4) — this is a permanent design
    // decision, not a threshold that can be reached.
    expect(
      evaluateAutonomy(permissive, {
        kind: "OUTREACH",
        actionsToday: 0,
        confidenceScore: 1,
      }),
    ).toMatchObject({
      allowed: false,
      reason: expect.stringContaining("no compliant send path"),
    });
  });

  it("treats an unscored category as failing, not passing", () => {
    expect(
      evaluateAutonomy(permissive, { ...engagement, confidenceScore: null }),
    ).toMatchObject({
      outcome: "BLOCKED_CONFIDENCE",
      reason: "Not enough decisions yet to score this category.",
    });
  });

  it("holds content to a higher bar than engagement", () => {
    const score = 0.92;
    expect(AUTONOMY_THRESHOLDS.CONTENT).toBeGreaterThan(AUTONOMY_THRESHOLDS.ENGAGEMENT);

    expect(
      evaluateAutonomy(permissive, { ...engagement, confidenceScore: score }),
    ).toEqual({ allowed: true });

    expect(
      evaluateAutonomy(permissive, {
        kind: "CONTENT",
        actionsToday: 0,
        confidenceScore: score,
        text: "A post.",
      }),
    ).toMatchObject({ outcome: "BLOCKED_CONFIDENCE" });
  });

  it("enforces the daily cap", () => {
    expect(
      evaluateAutonomy(permissive, { ...engagement, actionsToday: 5 }),
    ).toMatchObject({ outcome: "BLOCKED_CAP" });

    expect(evaluateAutonomy(permissive, { ...engagement, actionsToday: 4 })).toEqual({
      allowed: true,
    });
  });

  it("blocks everything when the allowlist is required but empty", () => {
    // "No allowlist configured" must never quietly mean "everyone is allowed".
    expect(
      evaluateAutonomy({ ...permissive, targetAllowlist: [] }, engagement),
    ).toMatchObject({ outcome: "BLOCKED_ALLOWLIST" });
  });

  it("blocks a target that is not on the allowlist", () => {
    expect(
      evaluateAutonomy(permissive, { ...engagement, targetIdentifier: "Someone Else" }),
    ).toMatchObject({ outcome: "BLOCKED_ALLOWLIST" });
  });

  it("matches allowlist entries ignoring case and surrounding space", () => {
    expect(
      evaluateAutonomy(
        { ...permissive, targetAllowlist: ["  jane doe "] },
        { ...engagement, targetIdentifier: "Jane Doe" },
      ),
    ).toEqual({ allowed: true });
  });

  it("skips the allowlist when it is not required", () => {
    expect(
      evaluateAutonomy(
        { ...permissive, requireAllowlist: false },
        { ...engagement, targetIdentifier: "Anyone" },
      ),
    ).toEqual({ allowed: true });
  });

  it("blocks output that mentions an excluded topic", () => {
    expect(
      evaluateAutonomy(
        { ...permissive, topicExclusions: ["layoffs"] },
        { ...engagement, text: "Following the Layoffs last quarter..." },
      ),
    ).toMatchObject({
      outcome: "BLOCKED_CONSTRAINT",
      reason: expect.stringContaining("layoffs"),
    });
  });

  it("treats exclusion entries as literals, not patterns", () => {
    expect(
      evaluateAutonomy(
        { ...permissive, topicExclusions: [".*"] },
        { ...engagement, text: "Nothing to see here." },
      ),
    ).toEqual({ allowed: true });
  });

  it("ignores blank exclusion entries", () => {
    expect(
      evaluateAutonomy({ ...permissive, topicExclusions: ["", "   "] }, engagement),
    ).toEqual({ allowed: true });
  });
});
