/**
 * Versioned prompt templates — roadmap §0.8.
 *
 * Every generation records the prompt name and version it used
 * (Generation.promptName / promptVersion). That only means something if versions
 * are immutable: editing a template in place silently rewrites the history of
 * every artifact that claims to have used it.
 *
 * So the rule here is: never edit a published template. Add a new version and
 * point `current` at it. Old versions stay in the file, which is the point —
 * "why did it suggest this" is answerable a year later because the exact prompt
 * is still readable.
 */

export interface PromptTemplate {
  name: string;
  version: string;
  /** `{{variable}}` placeholders. */
  template: string;
  /** Required variables, checked at render rather than producing "{{persona}}" in a post. */
  variables: readonly string[];
}

export class MissingVariableError extends Error {
  constructor(
    readonly promptName: string,
    readonly missing: string[],
  ) {
    super(`Prompt "${promptName}" is missing required variables: ${missing.join(", ")}`);
    this.name = "MissingVariableError";
  }
}

export function render(
  template: PromptTemplate,
  values: Record<string, string | undefined>,
): string {
  const missing = template.variables.filter((v) => {
    const value = values[v];
    return value === undefined || value === null || value.trim() === "";
  });
  if (missing.length > 0) throw new MissingVariableError(template.name, missing);

  return template.template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = values[key];
    // An unknown placeholder is a template bug, not a caller bug — leave it
    // visible rather than substituting an empty string and shipping a post with
    // a hole in it.
    return value === undefined ? match : value;
  });
}

const templates = new Map<string, PromptTemplate>();

function register(t: PromptTemplate): PromptTemplate {
  templates.set(`${t.name}@${t.version}`, t);
  return t;
}

/** Look up an exact historical version, for replaying a past generation. */
export function getTemplate(name: string, version: string): PromptTemplate {
  const found = templates.get(`${name}@${version}`);
  if (!found) throw new Error(`No prompt registered as ${name}@${version}`);
  return found;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export const INTAKE_FOLLOWUP_V1 = register({
  name: "intake.followup",
  version: "1.0.0",
  variables: ["areaTitle", "areaIntent", "openCriteria", "transcript"],
  template: `You are conducting a consulting intake for a go-to-market strategist.

You are working through one area of a fixed framework. Do not wander outside it,
and do not advance past it — a separate system decides when this area is done.

AREA: {{areaTitle}}
WHAT THIS AREA NEEDS TO ESTABLISH: {{areaIntent}}

STILL OPEN:
{{openCriteria}}

WHAT HAS ALREADY BEEN SEEDED FROM THEIR LINKEDIN ARCHIVE:
{{seededContext}}

CONVERSATION SO FAR:
{{transcript}}

Ask ONE follow-up question that closes the most important open criterion.

- If the archive already answers something, confirm it in a sentence rather than
  asking them to recite what you can see. "You've posted 14 times this year,
  mostly in March — is that the pattern you want to change?" not "How often do
  you post?"
- Push past generic answers. "Consultant" is not a niche. "Decision makers" is
  not a persona you can score a connection list against.
- One question. No preamble, no numbered lists, no summary of what they just said.`,
});

export const BRIEF_SYNTHESIZE_V1 = register({
  name: "brief.synthesize",
  version: "1.0.0",
  variables: ["transcript", "archiveSummary"],
  template: `Synthesize a structured strategic brief from this intake conversation.

INTAKE TRANSCRIPT:
{{transcript}}

WHAT THEIR LINKEDIN ARCHIVE SHOWS:
{{archiveSummary}}

Return JSON matching this shape:
{
  "role": string,
  "industry": string,
  "niche": string,
  "subNiche": string,
  "offer": string,
  "currentState": { "activity": string, "network": string, "leadFlow": string },
  "targetState": { "goals": string, "outcomes": string[], "timeline": string },
  "persona": { "description": string, "signals": string[] },
  "neverSay": string[],
  "complianceFlags": string[]
}

Rules:
- Use their words for the offer and the goals. This document gets shown back to
  them, and a brief that sounds like a consultant's summary rather than like
  them will get edited into one anyway.
- "persona.signals" must be observable on a LinkedIn profile — title, company
  size, industry, seniority. They are used to score a connection list, so
  anything unobservable is useless here.
- "neverSay" becomes a hard filter on all generated output. Include only what
  they actually said they won't say. Do not invent cautious-sounding additions.
- Where the archive contradicts what they said, prefer the archive for facts
  (how often they post, who they know) and prefer them for intent.`,
});

/**
 * v1.1.0 splits blockable terms from descriptive rules.
 *
 * v1.0.0 asked for a "never-say list" and got sentences like "never name the
 * employer in a security context". Those go into a regex, so they match
 * nothing — the §1.3 hard filter was passing posts that named the employer
 * outright. Terms and guidance are now separate fields with separate jobs.
 */
export const BRIEF_SYNTHESIZE_V1_1 = register({
  name: "brief.synthesize",
  version: "1.1.0",
  variables: ["transcript", "archiveSummary"],
  template: `Synthesize a structured strategic brief from this intake conversation.

INTAKE TRANSCRIPT:
{{transcript}}

WHAT THEIR LINKEDIN ARCHIVE SHOWS:
{{archiveSummary}}

Return JSON matching this shape:
{
  "role": string,
  "industry": string,
  "niche": string,
  "subNiche": string,
  "offer": string,
  "currentState": { "activity": string, "network": string, "leadFlow": string },
  "targetState": { "goals": string, "outcomes": string[], "timeline": string },
  "persona": { "description": string, "signals": string[] },
  "neverSay": string[],
  "complianceFlags": string[]
}

Rules:
- Use their words for the offer and the goals. This document gets shown back to
  them, and a brief that sounds like a consultant's summary rather than like
  them will get edited into one anyway.
- "persona.signals" must be observable on a LinkedIn profile — title, company
  size, industry, seniority. They are used to score a connection list, so
  anything unobservable is useless here.

- "neverSay" is a list of LITERAL STRINGS that must never appear in generated
  output. It is matched against the text with a regex, so write the words
  themselves, not a description of them:
      correct:   "Las Vegas Sands", "Sands", "PCI-DSS"
      useless:   "never name the employer in a security context"
  Include every name, brand, product and phrase they said they will not say,
  and the obvious variants of each. If they ruled out a topic rather than a
  word, put the words that topic would have to use.

- "complianceFlags" is for rules that shape writing but cannot be matched as
  text — "no real incident detail, even anonymised", "criticise a pattern, not
  a product", tone constraints. These guide generation; they are not filters.

- Do not invent cautious-sounding additions to either list.
- Where the archive contradicts what they said, prefer the archive for facts
  (how often they post, who they know) and prefer them for intent.`,
});

export const CONTENT_DRAFT_V1 = register({
  name: "content.draft",
  version: "1.0.0",
  variables: ["roadmapElement", "brief", "voiceProfile"],
  template: `Write a ready-to-post LinkedIn post.

THE STRATEGIC REASON THIS POST EXISTS:
{{roadmapElement}}

THE BRIEF:
{{brief}}

HOW THIS PERSON WRITES (modeled from their real posts and comments):
{{voiceProfile}}

WHAT PEERS IN THIS NICHE ARE DOING (patterns, not material to copy):
{{peerPatterns}}

Requirements:
- A finished post, not an outline and not a topic idea. It should be publishable
  as written.
- It must serve the roadmap element above. If you cannot connect it to that
  element in one sentence, write a different post.
- Match their voice profile, including the parts that are not "good writing" —
  if they open abruptly, open abruptly. A post that reads better than they write
  reads like it wasn't them.
- No engagement bait, no "agree?", no rows of single-sentence paragraphs unless
  that is genuinely their pattern.
- Do not reproduce phrasing or structure from the peer material. Those are there
  to show what formats land, not to be rewritten.

Return JSON: { "content": string, "format": string, "whyThis": string }
"whyThis" is one sentence, shown to the user with the draft: which roadmap
element this serves and which audience segment it is for.`,
});

/**
 * v1.1.0 adds the meeting-notes signal.
 *
 * §3.5 names three signal sources that continuously update strategy: trends,
 * approve/reject, and the user's own day-to-day work. The third was being
 * extracted and stored and then reaching no prompt, which made it a feature on
 * paper only. v1.0.0 is left intact above — every draft generated under it
 * still resolves.
 */
export const CONTENT_DRAFT_V1_1 = register({
  name: "content.draft",
  version: "1.1.0",
  variables: ["roadmapElement", "brief", "voiceProfile"],
  template: `Write a ready-to-post LinkedIn post.

THE STRATEGIC REASON THIS POST EXISTS:
{{roadmapElement}}

THE BRIEF:
{{brief}}

HOW THIS PERSON WRITES (modeled from their real posts and comments):
{{voiceProfile}}

WHAT PEERS IN THIS NICHE ARE DOING (patterns, not material to copy):
{{peerPatterns}}

FROM THEIR OWN RECENT WORK (meeting notes and documents they confirmed):
{{documentSignal}}

Requirements:
- A finished post, not an outline and not a topic idea. It should be publishable
  as written.
- It must serve the roadmap element above. If you cannot connect it to that
  element in one sentence, write a different post.
- Match their voice profile, including the parts that are not "good writing" —
  if they open abruptly, open abruptly. A post that reads better than they write
  reads like it wasn't them.
- Where their own work gives you a specific detail — a number, a phrase a client
  used, a problem that keeps recurring — prefer it over anything generic. That
  specificity is the whole reason those notes are here, and it is what a
  competitor writing about the same topic cannot copy.
- Never reproduce identifying details from those notes: no client names, no
  figures that could identify a deal, nothing that survives being read by the
  person it came from.
- No engagement bait, no "agree?", no rows of single-sentence paragraphs unless
  that is genuinely their pattern.
- Do not reproduce phrasing or structure from the peer material. Those are there
  to show what formats land, not to be rewritten.

Return JSON: { "content": string, "format": string, "whyThis": string }
"whyThis" is one sentence, shown to the user with the draft: which roadmap
element this serves and which audience segment it is for.`,
});

export const ENGAGEMENT_COMMENT_V1 = register({
  name: "engagement.comment",
  version: "1.0.0",
  variables: ["postContent", "postAuthor", "brief", "voiceProfile"],
  template: `Draft a comment on someone else's LinkedIn post.

THE POST, BY {{postAuthor}}:
{{postContent}}

OUR USER'S BRIEF:
{{brief}}

HOW THEY WRITE:
{{voiceProfile}}

This comment is being left so that the author's audience — who are the people
our user needs to reach — see our user say something worth reading.

Requirements:
- Add a point. A comment that agrees is worse than no comment: it costs the same
  attention and returns nothing.
- Specific enough that it could only have been written about THIS post.
- Short. Two or three sentences. Long comments get collapsed behind "see more"
  and are not read.
- No pitching, no "great post", no tagging people, no link drops.
- Disagreement is fine and often the best available move, as long as it is
  substantive and not contrarian for its own sake.
- Their voice, not a polished version of it.

Return JSON: { "content": string, "whyThis": string }`,
});

export const VOICE_SUMMARY_V1 = register({
  name: "voice.summarize",
  version: "1.0.0",
  variables: ["samples", "stats"],
  template: `Describe how this person writes, from their real LinkedIn posts and comments.

MEASURED PATTERNS:
{{stats}}

SAMPLES:
{{samples}}

Write a description another writer could actually imitate. Cover: sentence
rhythm, how they open, how they end, punctuation habits, vocabulary level,
whether they hedge or assert, formatting tics, humour.

Describe what is there, including the habits that are not virtues — the tics are
what make a voice recognisable. Do not give writing advice and do not describe
what they should do differently.

Return JSON: { "summary": string, "traits": { "rhythm": string, "openings": string,
"endings": string, "punctuation": string, "vocabulary": string, "stance": string,
"formatting": string, "humour": string } }`,
});

export const REFINE_DRAFT_V1 = register({
  name: "content.refine",
  version: "1.0.0",
  variables: ["currentDraft", "instruction", "voiceProfile"],
  template: `Revise this draft according to the instruction.

CURRENT DRAFT:
{{currentDraft}}

THE INSTRUCTION:
{{instruction}}

HOW THEY WRITE:
{{voiceProfile}}

Change what was asked and leave the rest alone. If the instruction is vague
("not how I'd phrase it"), the problem is voice — rewrite for voice and keep the
substance.

Do not improve things you were not asked to improve. The user has already
approved everything you are about to change unprompted.

Return JSON: { "content": string, "whatChanged": string }`,
});

export const ALL_TEMPLATES = [
  INTAKE_FOLLOWUP_V1,
  BRIEF_SYNTHESIZE_V1,
  BRIEF_SYNTHESIZE_V1_1,
  CONTENT_DRAFT_V1,
  CONTENT_DRAFT_V1_1,
  ENGAGEMENT_COMMENT_V1,
  VOICE_SUMMARY_V1,
  REFINE_DRAFT_V1,
] as const;

/** What new generations use. Bump deliberately; never edit a published version. */
export const CURRENT = {
  intakeFollowup: INTAKE_FOLLOWUP_V1,
  briefSynthesize: BRIEF_SYNTHESIZE_V1_1,
  contentDraft: CONTENT_DRAFT_V1_1,
  engagementComment: ENGAGEMENT_COMMENT_V1,
  voiceSummary: VOICE_SUMMARY_V1,
  refineDraft: REFINE_DRAFT_V1,
} as const;
