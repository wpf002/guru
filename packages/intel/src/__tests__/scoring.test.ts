import { describe, expect, it } from "vitest";
import { rankTargets, scoreTarget } from "../scoring.js";

const NOW = new Date("2026-07-30T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

describe("scoreTarget", () => {
  it("scores a fresh, well-matched post near the top", () => {
    const result = scoreTarget(
      { authorFit: 0.95, audienceOverlap: 0.9, postedAt: hoursAgo(1) },
      { now: NOW },
    );
    expect(result.score).toBeGreaterThan(0.8);
    expect(result.rationale).toMatch(/squarely in the target persona/);
  });

  it("sinks a stale post however good the author is", () => {
    // A perfect comment on a four-day-old post is invisible.
    const result = scoreTarget(
      { authorFit: 1, audienceOverlap: 1, postedAt: hoursAgo(96) },
      { now: NOW },
    );
    expect(result.score).toBeLessThan(0.05);
    expect(result.rationale).toMatch(/the feed has moved on/);
  });

  it("ranks a fresh mediocre match above a stale perfect one", () => {
    const fresh = scoreTarget(
      { authorFit: 0.5, audienceOverlap: 0.5, postedAt: hoursAgo(2) },
      { now: NOW },
    );
    const stale = scoreTarget(
      { authorFit: 1, audienceOverlap: 1, postedAt: hoursAgo(72) },
      { now: NOW },
    );
    expect(fresh.score).toBeGreaterThan(stale.score);
  });

  it("weights author fit above audience overlap", () => {
    const authorHeavy = scoreTarget(
      { authorFit: 1, audienceOverlap: 0, postedAt: NOW },
      { now: NOW },
    );
    const audienceHeavy = scoreTarget(
      { authorFit: 0, audienceOverlap: 1, postedAt: NOW },
      { now: NOW },
    );
    expect(authorHeavy.score).toBeGreaterThan(audienceHeavy.score);
  });

  it("clamps out-of-range and NaN inputs", () => {
    const result = scoreTarget(
      { authorFit: 5, audienceOverlap: Number.NaN, postedAt: NOW },
      { now: NOW },
    );
    expect(result.authorFit).toBe(1);
    expect(result.audienceOverlap).toBe(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it("does not let a future-dated post score above 1", () => {
    // Timezone skew in a scraped date should not produce a super-fresh post.
    const result = scoreTarget(
      { authorFit: 1, audienceOverlap: 1, postedAt: hoursAgo(-48) },
      { now: NOW },
    );
    expect(result.freshness).toBe(1);
    expect(result.score).toBeLessThanOrEqual(1);
  });
});

describe("rankTargets", () => {
  it("orders by score and drops posts below the floor", () => {
    const ranked = rankTargets(
      [
        { item: "stale", input: { authorFit: 1, audienceOverlap: 1, postedAt: hoursAgo(120) } },
        { item: "best", input: { authorFit: 0.9, audienceOverlap: 0.8, postedAt: hoursAgo(1) } },
        { item: "ok", input: { authorFit: 0.6, audienceOverlap: 0.5, postedAt: hoursAgo(6) } },
      ],
      { now: NOW },
    );
    expect(ranked.map((r) => r.item)).toEqual(["best", "ok"]);
  });

  it("respects the limit", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      item: i,
      input: { authorFit: 0.9, audienceOverlap: 0.9, postedAt: hoursAgo(1) },
    }));
    expect(rankTargets(many, { now: NOW, limit: 10 })).toHaveLength(10);
  });
});
