import { describe, expect, it } from "vitest";
import {
  ConstraintViolationError,
  assertConstraints,
  checkConstraints,
  partitionConstraints,
} from "../constraints.js";

const brief = { neverSay: ["guaranteed", "passive income"], complianceFlags: ["ROI"] };

describe("checkConstraints", () => {
  it("passes clean copy", () => {
    expect(checkConstraints("A note on how we work with operators.", brief).ok).toBe(true);
  });

  it("catches a never-say term regardless of case", () => {
    const result = checkConstraints("Results are Guaranteed.", brief);
    expect(result.ok).toBe(false);
    expect(result.violations[0]?.term).toBe("guaranteed");
  });

  it("catches multi-word terms", () => {
    expect(checkConstraints("Build passive income fast.", brief).ok).toBe(false);
  });

  it("does not fire on substrings inside larger words", () => {
    // "ROI" inside "Royal" would train users to ignore the filter.
    expect(checkConstraints("The Royal Bank of Canada.", brief).ok).toBe(true);
  });

  it("reports every occurrence with an excerpt", () => {
    const result = checkConstraints("guaranteed today, guaranteed tomorrow", brief);
    expect(result.violations).toHaveLength(2);
    expect(result.violations[0]?.excerpt).toContain("guaranteed");
  });

  it("handles terms whose edges are not word characters", () => {
    const result = checkConstraints("Tagging #growth here", {
      neverSay: ["#growth"],
      complianceFlags: [],
    });
    expect(result.ok).toBe(false);
  });

  it("ignores empty and whitespace-only terms", () => {
    expect(checkConstraints("anything", { neverSay: ["", "  "], complianceFlags: [] }).ok).toBe(
      true,
    );
  });

  it("treats regex metacharacters as literals", () => {
    expect(
      checkConstraints("we are 100% sure", { neverSay: ["100%"], complianceFlags: [] }).ok,
    ).toBe(false);
    expect(
      checkConstraints("anything at all", { neverSay: [".*"], complianceFlags: [] }).ok,
    ).toBe(true);
  });
});

describe("assertConstraints", () => {
  it("throws with the offending terms named", () => {
    expect(() => assertConstraints("guaranteed ROI", brief)).toThrow(
      ConstraintViolationError,
    );
  });

  it("is silent on clean copy", () => {
    expect(() => assertConstraints("clean copy", brief)).not.toThrow();
  });
});

describe("partitionConstraints", () => {
  it("keeps names and short phrases as blockable terms", () => {
    const { terms } = partitionConstraints(["Las Vegas Sands", "Sands", "PCI-DSS"]);
    expect(terms).toEqual(["Las Vegas Sands", "Sands", "PCI-DSS"]);
  });

  it("moves descriptive rules out of the filter", () => {
    // This is the bug it exists for: fed to a regex, the sentence matches
    // nothing, so the hard filter passes a post that names the employer.
    const { terms, guidance } = partitionConstraints([
      "Las Vegas Sands",
      "Naming the employer (Las Vegas Sands) in a security context at all",
      "No real incident detail, even anonymised",
    ]);

    expect(terms).toEqual(["Las Vegas Sands"]);
    expect(guidance).toHaveLength(2);
  });

  it("catches instruction-shaped entries even when they are short", () => {
    const { terms, guidance } = partitionConstraints(["Never name clients", "Acme Corp"]);
    expect(terms).toEqual(["Acme Corp"]);
    expect(guidance).toEqual(["Never name clients"]);
  });

  it("drops blanks", () => {
    expect(partitionConstraints(["", "   "]).terms).toEqual([]);
  });

  it("still blocks the employer once partitioned", () => {
    const { terms } = partitionConstraints([
      "Las Vegas Sands",
      "Naming the employer in a security context at all",
    ]);
    const post = "At Las Vegas Sands we drop a lot of firewall logs.";
    expect(checkConstraints(post, { neverSay: terms, complianceFlags: [] }).ok).toBe(false);
  });
});
