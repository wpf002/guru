import { describe, expect, it } from "vitest";
import { SimilarityError, assertNotDerivative, checkSimilarity } from "../similarity.js";

const PEER =
  "Most founders think distribution is a marketing problem. It is not. " +
  "Distribution is a product decision you make on day one, and every day after that.";

describe("checkSimilarity", () => {
  it("scores a verbatim copy at 1", () => {
    const match = checkSimilarity(PEER, [PEER]);
    expect(match?.score).toBeCloseTo(1, 5);
  });

  it("scores an original take on the same topic low", () => {
    // A paraphrase in the user's own words is the goal, not the failure mode.
    const original =
      "I keep meeting teams who bolt on a growth hire once the product is built. " +
      "By then the shape of the thing already decided who could ever find it.";
    expect(checkSimilarity(original, [PEER])!.score).toBeLessThan(0.1);
  });

  it("catches a lightly-edited lift", () => {
    const lifted =
      "Most founders think distribution is a marketing problem. It really is not. " +
      "Distribution is a product decision you make on day one, and every day after.";
    expect(checkSimilarity(lifted, [PEER])!.score).toBeGreaterThan(0.5);
  });

  it("reports the longest shared phrase", () => {
    const lifted = "Distribution is a product decision you make on day one. Here is why.";
    expect(checkSimilarity(lifted, [PEER])!.longestSharedPhrase).toContain(
      "distribution is a product decision you make on day one",
    );
  });

  it("picks the closest of several sources", () => {
    const other = "Hiring is the only lever that compounds. Everything else is noise.";
    const match = checkSimilarity(PEER, [other, PEER]);
    expect(match?.sourceIndex).toBe(1);
  });

  it("measures how much of the draft was lifted, not overlap symmetry", () => {
    // Jaccard would score a short draft lifted wholesale from a long source as
    // low-similarity. Containment is the question we actually care about.
    const shortLift = "distribution is a product decision you make on day one";
    const longSource = `${PEER} ${"Padding sentence that adds length. ".repeat(30)}`;
    expect(checkSimilarity(shortLift, [longSource])!.score).toBeGreaterThan(0.9);
  });

  it("returns null when there is nothing to compare", () => {
    expect(checkSimilarity("too short", [PEER])).toBeNull();
    expect(checkSimilarity(PEER, [])).toBeNull();
    expect(checkSimilarity(PEER, ["tiny"])).toBeNull();
  });

  it("ignores punctuation and casing differences", () => {
    const requoted = PEER.toUpperCase().replace(/\./g, " —");
    expect(checkSimilarity(requoted, [PEER])!.score).toBeGreaterThan(0.9);
  });
});

describe("assertNotDerivative", () => {
  it("throws with the offending phrase named", () => {
    try {
      assertNotDerivative(PEER, [PEER]);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SimilarityError);
      expect((e as SimilarityError).message).toMatch(/shingle-identical to peer source/);
    }
  });

  it("passes original work through and returns its score for the record", () => {
    const original =
      "The teams I work with treat reach as something you buy later. " +
      "It shows up in the roadmap long before anyone writes a cheque.";
    const match = assertNotDerivative(original, [PEER]);
    expect(match!.score).toBeLessThan(0.25);
  });

  it("honours a custom threshold", () => {
    const partial = `Distribution is a product decision you make on day one. ${"My own words here about operators and buyers. ".repeat(4)}`;
    expect(() => assertNotDerivative(partial, [PEER], 0.9)).not.toThrow();
    expect(() => assertNotDerivative(partial, [PEER], 0.05)).toThrow(SimilarityError);
  });
});
