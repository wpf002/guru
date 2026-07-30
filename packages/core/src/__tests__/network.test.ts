import { describe, expect, it } from "vitest";
import {
  analyzeNetwork,
  invitationAcceptRate,
  postingCadence,
} from "../network.js";

function conns(count: number, fit: number | null) {
  return Array.from({ length: count }, () => ({ personaFitScore: fit }));
}

describe("analyzeNetwork", () => {
  it("branches on raw size before any persona scoring exists", () => {
    const result = analyzeNetwork(conns(120, null));
    expect(result.audienceFitRatio).toBeNull();
    expect(result.density).toBe("SPARSE");
    expect(result.needsNetworkBuilding).toBe(true);
  });

  it("treats a large network of the wrong people as sparse", () => {
    // 10,000 connections, 2% fit — 200 effective. The spec's raw-size heuristic
    // would call this dense; effective reach is the sharper signal.
    const result = analyzeNetwork([...conns(200, 0.9), ...conns(9800, 0.1)]);
    expect(result.connectionCount).toBe(10_000);
    expect(result.audienceFitRatio).toBeCloseTo(0.02, 4);
    expect(result.effectiveReach).toBe(200);
    expect(result.density).toBe("SPARSE");
    expect(result.needsNetworkBuilding).toBe(true);
  });

  it("treats a well-targeted network as ready for segmentation", () => {
    const result = analyzeNetwork([...conns(6000, 0.9), ...conns(1000, 0.2)]);
    expect(result.density).toBe("DENSE");
    expect(result.needsNetworkBuilding).toBe(false);
  });

  it("computes fit over scored connections only", () => {
    const result = analyzeNetwork([...conns(50, 0.9), ...conns(50, 0.1), ...conns(400, null)]);
    expect(result.scoredCount).toBe(100);
    expect(result.audienceFitRatio).toBeCloseTo(0.5, 4);
  });

  it("handles an empty network", () => {
    const result = analyzeNetwork([]);
    expect(result.connectionCount).toBe(0);
    expect(result.density).toBe("SPARSE");
    expect(result.audienceFitRatio).toBeNull();
  });
});

describe("invitationAcceptRate", () => {
  it("scores outgoing invitations only", () => {
    const rate = invitationAcceptRate([
      { direction: "OUTGOING", status: "ACCEPTED" },
      { direction: "OUTGOING", status: "PENDING" },
      { direction: "INCOMING", status: "ACCEPTED" },
    ]);
    expect(rate).toBeCloseTo(0.5, 4);
  });

  it("returns null when nothing was ever sent", () => {
    expect(invitationAcceptRate([{ direction: "INCOMING", status: "ACCEPTED" }])).toBeNull();
    expect(invitationAcceptRate([])).toBeNull();
  });
});

describe("postingCadence", () => {
  const d = (iso: string) => new Date(iso);

  it("finds the gap that matters", () => {
    const result = postingCadence([
      { publishedAt: d("2026-01-01") },
      { publishedAt: d("2026-01-08") },
      { publishedAt: d("2026-03-01") },
    ]);
    expect(result.totalPosts).toBe(3);
    expect(result.longestGapDays).toBeCloseTo(52, 0);
    expect(result.lastPostedAt).toEqual(d("2026-03-01"));
  });

  it("reports no rate for a single post rather than infinity", () => {
    const result = postingCadence([{ publishedAt: d("2026-01-01") }]);
    expect(result.postsPerWeek).toBeNull();
    expect(result.longestGapDays).toBe(0);
  });

  it("ignores undated rows and handles an empty history", () => {
    expect(postingCadence([{ publishedAt: null }]).totalPosts).toBe(0);
    expect(postingCadence([]).lastPostedAt).toBeNull();
  });
});
