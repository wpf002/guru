import { describe, expect, it } from "vitest";
import { diffConnections } from "../diff.js";

const c = (url: string, fit?: number) => ({
  profileUrl: url,
  personaFitScore: fit ?? null,
});

describe("diffConnections", () => {
  it("separates added from removed", () => {
    const diff = diffConnections([c("/in/a"), c("/in/b")], [c("/in/b"), c("/in/c")]);
    expect(diff.added.map((x) => x.profileUrl)).toEqual(["/in/c"]);
    expect(diff.removed.map((x) => x.profileUrl)).toEqual(["/in/a"]);
    expect(diff.retained).toBe(1);
    expect(diff.netGrowth).toBe(0);
  });

  it("scores fit on new connections only, not the whole network", () => {
    // An existing network of good-fit people would otherwise mask a quarter of
    // bad new growth.
    const previous = Array.from({ length: 10 }, (_, i) => c(`/in/old${i}`, 0.9));
    const current = [
      ...previous,
      c("/in/new1", 0.9),
      c("/in/new2", 0.1),
      c("/in/new3", 0.1),
      c("/in/new4", 0.1),
    ];
    const diff = diffConnections(previous, current);
    expect(diff.added).toHaveLength(4);
    expect(diff.newConnectionFitRatio).toBeCloseTo(0.25, 4);
  });

  it("returns null fit when no new connection has been scored", () => {
    expect(diffConnections([], [c("/in/a")]).newConnectionFitRatio).toBeNull();
  });

  it("matches on trailing slash and case differences in the profile URL", () => {
    const diff = diffConnections(
      [{ profileUrl: "https://LinkedIn.com/in/Jane/" }],
      [{ profileUrl: "https://linkedin.com/in/jane" }],
    );
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
  });

  it("falls back to name and company when there is no profile URL", () => {
    const diff = diffConnections(
      [{ normalizedName: "jane doe", normalizedCompany: "acme" }],
      [
        { normalizedName: "jane doe", normalizedCompany: "acme" },
        { normalizedName: "john smith", normalizedCompany: "acme" },
      ],
    );
    expect(diff.added).toHaveLength(1);
  });

  it("handles a first snapshot with no predecessor", () => {
    const diff = diffConnections([], [c("/in/a"), c("/in/b")]);
    expect(diff.added).toHaveLength(2);
    expect(diff.netGrowth).toBe(2);
  });
});
