/**
 * Voice modeling — roadmap §1.8.
 *
 * Cold-started from comments.csv and Shares.csv: real writing, hundreds or
 * thousands of samples, available on day one instead of after months of edits.
 *
 * This module computes the *measurable* half — sentence length, opener habits,
 * punctuation, emoji, hedging. Those numbers feed the voice.summarize prompt
 * rather than the model being asked to eyeball a corpus, because "your sentences
 * average 11 words" is a fact and "you write punchily" is a guess.
 */

export interface VoiceStats {
  sampleCount: number;
  totalWords: number;
  meanSentenceWords: number;
  medianSentenceWords: number;
  /** Share of samples opening with a question. */
  questionOpenerRate: number;
  /** Share of samples that are a single paragraph. */
  singleParagraphRate: number;
  emojiRate: number;
  exclamationRate: number;
  /** Share of sentences containing a hedge ("I think", "maybe", "sort of"). */
  hedgeRate: number;
  firstPersonRate: number;
  meanParagraphsPerSample: number;
  /** Openers seen more than once — the tics that make a voice recognisable. */
  commonOpeners: { opener: string; count: number }[];
}

const HEDGES =
  /\b(i think|i guess|maybe|perhaps|sort of|kind of|somewhat|arguably|probably|it seems)\b/i;
const FIRST_PERSON = /\b(i|i'm|i've|i'd|i'll|my|me|we|our)\b/i;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1]! + sorted[mid]!) / 2) : sorted[mid]!;
}

/**
 * Mean and median are both reported because they disagree in a useful way: a
 * writer with mostly short sentences and one 60-word paragraph has a mean that
 * describes nobody. The median is what the voice actually sounds like.
 */
export function analyzeVoice(samples: readonly string[]): VoiceStats {
  const texts = samples.map((s) => s?.trim()).filter((s): s is string => Boolean(s));

  if (texts.length === 0) {
    return {
      sampleCount: 0,
      totalWords: 0,
      meanSentenceWords: 0,
      medianSentenceWords: 0,
      questionOpenerRate: 0,
      singleParagraphRate: 0,
      emojiRate: 0,
      exclamationRate: 0,
      hedgeRate: 0,
      firstPersonRate: 0,
      meanParagraphsPerSample: 0,
      commonOpeners: [],
    };
  }

  const allSentences = texts.flatMap(sentences);
  const sentenceLengths = allSentences.map(wordCount).filter((n) => n > 0);

  const openerCounts = new Map<string, number>();
  let questionOpeners = 0;
  let singleParagraph = 0;
  let paragraphTotal = 0;

  for (const text of texts) {
    const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim());
    paragraphTotal += Math.max(1, paragraphs.length);
    if (paragraphs.length <= 1) singleParagraph++;

    const firstSentence = sentences(text)[0] ?? "";
    if (firstSentence.endsWith("?")) questionOpeners++;

    // First two words: enough to catch "Here's the", "Most people", "I've been"
    // without collapsing every opener into a unique string.
    const opener = firstSentence.split(/\s+/).slice(0, 2).join(" ").toLowerCase();
    if (opener) openerCounts.set(opener, (openerCounts.get(opener) ?? 0) + 1);
  }

  const rate = (predicate: (t: string) => boolean) =>
    texts.filter(predicate).length / texts.length;

  return {
    sampleCount: texts.length,
    totalWords: texts.reduce((sum, t) => sum + wordCount(t), 0),
    meanSentenceWords:
      sentenceLengths.length === 0
        ? 0
        : sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length,
    medianSentenceWords: median(sentenceLengths),
    questionOpenerRate: questionOpeners / texts.length,
    singleParagraphRate: singleParagraph / texts.length,
    emojiRate: rate((t) => EMOJI.test(t)),
    exclamationRate: rate((t) => t.includes("!")),
    hedgeRate:
      allSentences.length === 0
        ? 0
        : allSentences.filter((s) => HEDGES.test(s)).length / allSentences.length,
    firstPersonRate: rate((t) => FIRST_PERSON.test(t)),
    meanParagraphsPerSample: paragraphTotal / texts.length,
    commonOpeners: [...openerCounts.entries()]
      .filter(([, count]) => count > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([opener, count]) => ({ opener, count })),
  };
}

/** Rendered into the voice.summarize prompt as measured fact. */
export function formatStats(stats: VoiceStats): string {
  if (stats.sampleCount === 0) return "No writing samples available.";
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return [
    `Samples: ${stats.sampleCount} (${stats.totalWords} words)`,
    `Sentence length: ${stats.meanSentenceWords.toFixed(1)} mean / ${stats.medianSentenceWords.toFixed(1)} median words`,
    `Paragraphs per piece: ${stats.meanParagraphsPerSample.toFixed(1)}; single-paragraph ${pct(stats.singleParagraphRate)}`,
    `Opens with a question: ${pct(stats.questionOpenerRate)}`,
    `Uses emoji: ${pct(stats.emojiRate)}; exclamation marks: ${pct(stats.exclamationRate)}`,
    `Hedged sentences: ${pct(stats.hedgeRate)}; first person: ${pct(stats.firstPersonRate)}`,
    stats.commonOpeners.length > 0
      ? `Repeated openers: ${stats.commonOpeners.map((o) => `"${o.opener}" (${o.count})`).join(", ")}`
      : "No repeated openers.",
  ].join("\n");
}

/**
 * Edits per draft — the honest proof the system is learning (§1.8, §9).
 *
 * Counts user revisions only. Model revisions are the system responding to an
 * instruction, which is the loop working, not the loop failing.
 */
export function editsPerDraft(
  drafts: readonly { revisions: readonly { author: string }[] }[],
): number | null {
  if (drafts.length === 0) return null;
  const userEdits = drafts.reduce(
    (sum, d) => sum + d.revisions.filter((r) => r.author === "user").length,
    0,
  );
  return userEdits / drafts.length;
}
