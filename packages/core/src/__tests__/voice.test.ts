import { describe, expect, it } from "vitest";
import { analyzeVoice, editsPerDraft, formatStats } from "../voice.js";

describe("analyzeVoice", () => {
  it("returns zeroed stats for an empty corpus rather than NaN", () => {
    const stats = analyzeVoice([]);
    expect(stats.sampleCount).toBe(0);
    expect(stats.meanSentenceWords).toBe(0);
    expect(Number.isNaN(stats.hedgeRate)).toBe(false);
  });

  it("ignores blank samples", () => {
    expect(analyzeVoice(["", "   ", "Real text here."]).sampleCount).toBe(1);
  });

  it("reports mean and median separately", () => {
    // One long sentence drags the mean somewhere no sentence actually is; the
    // median is what the voice sounds like.
    const stats = analyzeVoice([
      "Short. Short. Short.",
      `This one runs on ${"and on ".repeat(30)}forever.`,
    ]);
    expect(stats.meanSentenceWords).toBeGreaterThan(stats.medianSentenceWords);
    expect(stats.medianSentenceWords).toBeLessThan(5);
  });

  it("detects question openers", () => {
    const stats = analyzeVoice(["Why does this keep happening? Here is my take.", "A statement."]);
    expect(stats.questionOpenerRate).toBeCloseTo(0.5, 4);
  });

  it("detects emoji, exclamations, and hedging", () => {
    const stats = analyzeVoice(["Huge news 🚀!", "I think this is probably right."]);
    expect(stats.emojiRate).toBeCloseTo(0.5, 4);
    expect(stats.exclamationRate).toBeCloseTo(0.5, 4);
    expect(stats.hedgeRate).toBeGreaterThan(0);
  });

  it("surfaces repeated openers and drops one-offs", () => {
    const stats = analyzeVoice([
      "Most people think X.",
      "Most people think Y.",
      "Something else entirely.",
    ]);
    expect(stats.commonOpeners[0]).toEqual({ opener: "most people", count: 2 });
    expect(stats.commonOpeners.some((o) => o.opener === "something else")).toBe(false);
  });

  it("counts paragraphs per sample", () => {
    const stats = analyzeVoice(["One.\n\nTwo.\n\nThree.", "Single."]);
    expect(stats.meanParagraphsPerSample).toBeCloseTo(2, 4);
    expect(stats.singleParagraphRate).toBeCloseTo(0.5, 4);
  });
});

describe("formatStats", () => {
  it("says so plainly when there is nothing to model", () => {
    expect(formatStats(analyzeVoice([]))).toBe("No writing samples available.");
  });

  it("renders measured facts for the prompt", () => {
    const out = formatStats(analyzeVoice(["I think maybe this works.", "Definitely does."]));
    expect(out).toMatch(/Sentence length:/);
    expect(out).toMatch(/Hedged sentences:/);
  });
});

describe("editsPerDraft", () => {
  it("counts user revisions only", () => {
    // Model revisions are the refinement loop working, not failing.
    const result = editsPerDraft([
      { revisions: [{ author: "model" }, { author: "user" }, { author: "model" }] },
      { revisions: [{ author: "user" }, { author: "user" }] },
    ]);
    expect(result).toBeCloseTo(1.5, 4);
  });

  it("returns null with no drafts rather than a misleading zero", () => {
    expect(editsPerDraft([])).toBeNull();
  });

  it("returns zero when drafts ship untouched", () => {
    expect(editsPerDraft([{ revisions: [] }, { revisions: [{ author: "model" }] }])).toBe(0);
  });
});
