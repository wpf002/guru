import { describe, expect, it } from "vitest";
import { needsRefresh } from "../oauth.js";

/**
 * §1.0's stated exit criterion: "connects, survives a simulated 60-day refresh
 * boundary, disconnects clean."
 *
 * The refresh boundary half had no test. LinkedIn issues ~60-day
 * authorization-code tokens, so the failure this guards against is a token that
 * expires between the scheduler picking up a scheduled post and the publish
 * call — a post that silently fails, discovered later.
 */

const DAY = 86_400_000;
const now = new Date("2026-07-30T12:00:00Z");
const inDays = (n: number) => new Date(now.getTime() + n * DAY);

describe("§1.0 — the 60-day refresh boundary", () => {
  it("does not refresh a freshly issued token", () => {
    expect(needsRefresh(inDays(60), 7, now)).toBe(false);
  });

  it("does not refresh in the middle of a token's life", () => {
    expect(needsRefresh(inDays(30), 7, now)).toBe(false);
  });

  it("refreshes before expiry, not at it", () => {
    // The margin is the whole point: refreshing *at* expiry means every
    // in-flight request during the gap fails.
    expect(needsRefresh(inDays(8), 7, now)).toBe(false);
    expect(needsRefresh(inDays(6), 7, now)).toBe(true);
  });

  it("refreshes a token that has already expired", () => {
    expect(needsRefresh(inDays(-1), 7, now)).toBe(true);
  });

  it("treats the exact boundary as not-yet-due", () => {
    // The comparison is strictly less-than: with exactly the margin remaining,
    // there is still a full margin of headroom.
    expect(needsRefresh(inDays(7), 7, now)).toBe(false);
    expect(needsRefresh(new Date(inDays(7).getTime() - 1), 7, now)).toBe(true);
  });

  it("honours a custom margin", () => {
    // A scheduler that publishes weekly needs more headroom than one that
    // publishes hourly.
    expect(needsRefresh(inDays(20), 30, now)).toBe(true);
    expect(needsRefresh(inDays(20), 1, now)).toBe(false);
  });

  it("survives a simulated 60-day lifecycle", () => {
    // Walk a token from issue to expiry and assert the flip happens once, at
    // the right place.
    const expiresAt = inDays(60);
    const flips = Array.from({ length: 61 }, (_, day) =>
      needsRefresh(expiresAt, 7, new Date(now.getTime() + day * DAY)),
    );

    const firstTrue = flips.indexOf(true);
    expect(firstTrue).toBe(54);
    // Never flips back — once inside the margin it stays due.
    expect(flips.slice(firstTrue).every(Boolean)).toBe(true);
  });
});
