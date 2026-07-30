/**
 * The intake framework — roadmap §1.2.
 *
 * "Preset framework, adaptive within it." Each of the five spec areas is a slot
 * with explicit completion criteria. The model follows up freely until the
 * criteria are met, then advances. The framework constrains the state machine;
 * the model controls the path through it.
 *
 * Criteria are data, not code, so they can be tuned without a deploy and are
 * persisted per-session (IntakeSlot.criteria) — tightening them later does not
 * invalidate a session someone is halfway through.
 */

export type IntakeArea =
  | "WHO_THEY_ARE"
  | "WHERE_THEY_ARE_TODAY"
  | "WHERE_THEY_WANT_TO_BE"
  | "WHO_THEY_REACH"
  | "VOICE_AND_CONSTRAINTS";

export interface Criterion {
  key: string;
  /** What must be established before the slot can close. */
  description: string;
  required: boolean;
}

export interface AreaDefinition {
  area: IntakeArea;
  order: number;
  title: string;
  /** Framing the model opens with, not a script to read. */
  intent: string;
  criteria: Criterion[];
  /** Areas 2 and 5 open pre-populated from the archive (§1.2). */
  seedableFromArchive: boolean;
}

export const INTAKE_FRAMEWORK: readonly AreaDefinition[] = [
  {
    area: "WHO_THEY_ARE",
    order: 1,
    title: "Who they are",
    intent:
      "Establish role, industry, niche, sub-niche, and what they actually sell. " +
      "Push past the job title to the offer — 'consultant' is not a niche.",
    seedableFromArchive: false,
    criteria: [
      { key: "role", description: "Current role, stated plainly", required: true },
      { key: "industry", description: "Industry", required: true },
      { key: "niche", description: "Niche within that industry", required: true },
      {
        key: "subNiche",
        description: "Sub-niche specific enough to run trend analysis against",
        required: true,
      },
      {
        key: "offer",
        description: "What they sell or offer, and to whom money changes hands",
        required: true,
      },
    ],
  },
  {
    area: "WHERE_THEY_ARE_TODAY",
    order: 2,
    title: "Where they are today",
    intent:
      "Current LinkedIn activity, existing content, network size and composition, " +
      "and lead flow from social. Most of this is already known from the archive — " +
      "confirm and fill gaps rather than asking them to recite it.",
    seedableFromArchive: true,
    criteria: [
      {
        key: "currentActivity",
        description: "Posting cadence and what they post now",
        required: true,
      },
      {
        key: "networkComposition",
        description: "Who is actually in the network today",
        required: true,
      },
      {
        key: "leadFlow",
        description: "Inbound they currently get from social, even if zero",
        required: true,
      },
    ],
  },
  {
    area: "WHERE_THEY_WANT_TO_BE",
    order: 3,
    title: "Where they want to be",
    intent:
      "Business goals, target outcomes, timeline. The roadmap is the gap between " +
      "this and the previous area, so vagueness here produces a vague roadmap.",
    seedableFromArchive: false,
    criteria: [
      { key: "goals", description: "Business goals in the user's own terms", required: true },
      {
        key: "targetOutcomes",
        description: "Concrete outcomes — leads, brand, funding, hiring",
        required: true,
      },
      { key: "timeline", description: "Timeline they have in mind", required: true },
    ],
  },
  {
    area: "WHO_THEY_REACH",
    order: 4,
    title: "Who they're trying to reach",
    intent:
      "Ideal audience and persona, sharp enough to score a connection list against. " +
      "'Decision makers' is not scoreable; 'VPs of ops at 200–2000 person logistics " +
      "firms' is.",
    seedableFromArchive: false,
    criteria: [
      { key: "persona", description: "Ideal audience persona", required: true },
      {
        key: "personaSignals",
        description: "Observable signals — title, company size, industry — to match on",
        required: true,
      },
      {
        key: "existingUnderstanding",
        description: "Who they already believe they need in their network",
        required: false,
      },
    ],
  },
  {
    area: "VOICE_AND_CONSTRAINTS",
    order: 5,
    title: "Voice and constraints",
    intent:
      "Tone, the never-say list, competitive sensitivities, compliance. The voice " +
      "half is already modeled from their real writing — this is where the hard " +
      "limits get named.",
    seedableFromArchive: true,
    criteria: [
      { key: "tone", description: "How they want to sound", required: true },
      {
        key: "neverSay",
        description: "Things they will not say publicly — becomes a hard filter",
        required: true,
      },
      {
        key: "competitiveSensitivities",
        description: "Competitors or topics to handle carefully",
        required: false,
      },
      {
        key: "compliance",
        description: "Regulatory or employer constraints, if any",
        required: false,
      },
    ],
  },
] as const;

export function areaDefinition(area: IntakeArea): AreaDefinition {
  const def = INTAKE_FRAMEWORK.find((a) => a.area === area);
  if (!def) throw new Error(`Unknown intake area: ${area}`);
  return def;
}

export function isSlotComplete(area: IntakeArea, metCriteria: readonly string[]): boolean {
  const met = new Set(metCriteria);
  return areaDefinition(area)
    .criteria.filter((c) => c.required)
    .every((c) => met.has(c.key));
}

/** The next area to work, or null when intake is done. */
export function nextArea(
  slots: readonly { area: IntakeArea; complete: boolean }[],
): IntakeArea | null {
  const done = new Set(slots.filter((s) => s.complete).map((s) => s.area));
  const next = [...INTAKE_FRAMEWORK]
    .sort((a, b) => a.order - b.order)
    .find((a) => !done.has(a.area));
  return next?.area ?? null;
}
