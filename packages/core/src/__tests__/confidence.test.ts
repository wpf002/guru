import { describe, expect, it } from "vitest";
import {
  CONFIDENCE_CATEGORIES,
  type ConfidenceCategory,
  type DecisionInput,
  type ScoreResult,
  readyForAutonomyPrompt,
  scoreCategory,
} from "../confidence.js";

const NOW = new Date("2026-07-30T00:00:00Z");

function decisions(
  spec: readonly { type: DecisionInput["type"]; daysAgo: number; count?: number }[],
): DecisionInput[] {
  return spec.flatMap(({ type, daysAgo, count = 1 }) =>
    Array.from({ length: count }, () => ({
      type,
      createdAt: new Date(NOW.getTime() - daysAgo * 86_400_000),
    })),
  );
}

describe("scoreCategory", () => {
  it("returns null below the minimum sample size", () => {
    const result = scoreCategory(decisions([{ type: "APPROVE", daysAgo: 1, count: 5 }]), {
      now: NOW,
    });
    // Not zero — "not enough data" and "you keep rejecting these" are different
    // statements and the dashboard must not conflate them.
    expect(result.score).toBeNull();
    expect(result.sampleSize).toBe(5);
    expect(result.meetsThreshold).toBe(false);
  });

  it("scores a unanimous approver at 1", () => {
    const result = scoreCategory(decisions([{ type: "APPROVE", daysAgo: 1, count: 25 }]), {
      now: NOW,
    });
    expect(result.score).toBeCloseTo(1, 10);
    expect(result.meetsThreshold).toBe(true);
  });

  it("counts an edit as half an approval", () => {
    const result = scoreCategory(decisions([{ type: "EDIT", daysAgo: 1, count: 25 }]), {
      now: NOW,
    });
    expect(result.score).toBeCloseTo(0.5, 10);
  });

  it("weights recent decisions above old ones", () => {
    // Rejected everything early, approves everything now: a system that learned.
    const learned = scoreCategory(
      decisions([
        { type: "REJECT", daysAgo: 180, count: 15 },
        { type: "APPROVE", daysAgo: 2, count: 15 },
      ]),
      { now: NOW },
    );
    // The same counts, reversed in time: a system getting worse.
    const regressed = scoreCategory(
      decisions([
        { type: "APPROVE", daysAgo: 180, count: 15 },
        { type: "REJECT", daysAgo: 2, count: 15 },
      ]),
      { now: NOW },
    );

    expect(learned.score).toBeGreaterThan(0.9);
    expect(regressed.score).toBeLessThan(0.1);
  });

  it("returns null rather than NaN when every decision has underflowed to zero weight", () => {
    const ancient = scoreCategory(
      decisions([{ type: "APPROVE", daysAgo: 100_000, count: 25 }]),
      { now: NOW, halfLifeDays: 1 },
    );
    expect(ancient.score).toBeNull();
    expect(Number.isNaN(ancient.score as unknown as number)).toBe(false);
  });

  it("honours a custom threshold", () => {
    const ds = decisions([
      { type: "APPROVE", daysAgo: 1, count: 23 },
      { type: "REJECT", daysAgo: 1, count: 2 },
    ]);
    expect(scoreCategory(ds, { now: NOW, threshold: 0.9 }).meetsThreshold).toBe(true);
    expect(scoreCategory(ds, { now: NOW, threshold: 0.95 }).meetsThreshold).toBe(false);
  });
});

describe("readyForAutonomyPrompt", () => {
  const scored = (score: number): ScoreResult => ({
    score,
    sampleSize: 30,
    meetsThreshold: score >= 0.9,
  });

  function map(entries: Partial<Record<ConfidenceCategory, ScoreResult>>) {
    return new Map(Object.entries(entries) as [ConfidenceCategory, ScoreResult][]);
  }

  it("stays false while any category is unscored", () => {
    expect(readyForAutonomyPrompt(map({ TOPIC: scored(0.99) }))).toBe(false);
  });

  it("stays false when one category lags", () => {
    const entries = Object.fromEntries(
      CONFIDENCE_CATEGORIES.map((c) => [c, scored(0.97)]),
    ) as Record<ConfidenceCategory, ScoreResult>;
    entries.TONE = scored(0.62);
    expect(readyForAutonomyPrompt(map(entries))).toBe(false);
  });

  it("fires when every category sustains the threshold", () => {
    const entries = Object.fromEntries(
      CONFIDENCE_CATEGORIES.map((c) => [c, scored(0.93)]),
    ) as Record<ConfidenceCategory, ScoreResult>;
    expect(readyForAutonomyPrompt(map(entries))).toBe(true);
  });
});
