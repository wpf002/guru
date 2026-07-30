import { z } from "zod";

/**
 * Output schemas for every structured generation.
 *
 * These are stricter than "valid JSON": a persona with an empty signals array
 * parses fine and is useless — you cannot score a connection list against it.
 * The minimums here encode what each artifact must contain to be usable
 * downstream, so a weak generation fails at the boundary rather than producing
 * a roadmap nobody can act on.
 */

export const BriefSchema = z.object({
  role: z.string().min(1),
  industry: z.string().min(1),
  niche: z.string().min(1),
  subNiche: z.string().min(1),
  offer: z.string().min(1),
  currentState: z.object({
    activity: z.string(),
    network: z.string(),
    leadFlow: z.string(),
  }),
  targetState: z.object({
    goals: z.string().min(1),
    outcomes: z.array(z.string()).min(1),
    timeline: z.string(),
  }),
  persona: z.object({
    description: z.string().min(1),
    // Must be observable on a LinkedIn profile — these are matched against
    // Connection rows, so an unobservable signal is dead weight.
    signals: z.array(z.string()).min(1),
  }),
  neverSay: z.array(z.string()),
  complianceFlags: z.array(z.string()),
});
export type BriefOutput = z.infer<typeof BriefSchema>;

export const IntakeFollowupSchema = z.object({
  question: z.string().min(1),
  /** Criteria the model believes the last answer satisfied. */
  satisfiedCriteria: z.array(z.string()),
  areaComplete: z.boolean(),
  /** Structured extraction so far for this area. */
  extracted: z.record(z.string(), z.unknown()),
});
export type IntakeFollowupOutput = z.infer<typeof IntakeFollowupSchema>;

export const RoadmapSchema = z.object({
  summary: z.string().min(1),
  elements: z
    .array(
      z.object({
        phase: z.number().int().min(1),
        title: z.string().min(1),
        // Every draft inherits its "why" from here, so a rationale-free element
        // would produce drafts that cannot explain themselves.
        rationale: z.string().min(1),
        businessGoal: z.string(),
        audienceSegment: z.string(),
        targetFormats: z.array(z.string()),
        targetTopics: z.array(z.string()),
      }),
    )
    .min(1),
});
export type RoadmapOutput = z.infer<typeof RoadmapSchema>;

export const ContentDraftSchema = z.object({
  content: z.string().min(1),
  format: z.string(),
  whyThis: z.string().min(1),
});
export type ContentDraftOutput = z.infer<typeof ContentDraftSchema>;

export const RefinementSchema = z.object({
  content: z.string().min(1),
  whatChanged: z.string(),
});
export type RefinementOutput = z.infer<typeof RefinementSchema>;

export const EngagementCommentSchema = z.object({
  content: z.string().min(1),
  whyThis: z.string().min(1),
});
export type EngagementCommentOutput = z.infer<typeof EngagementCommentSchema>;

export const VoiceProfileSchema = z.object({
  summary: z.string().min(1),
  traits: z.object({
    rhythm: z.string(),
    openings: z.string(),
    endings: z.string(),
    punctuation: z.string(),
    vocabulary: z.string(),
    stance: z.string(),
    formatting: z.string(),
    humour: z.string(),
  }),
});
export type VoiceProfileOutput = z.infer<typeof VoiceProfileSchema>;

export const PersonaScoreSchema = z.object({
  scores: z.array(
    z.object({
      /** Index into the batch that was sent, so results can be matched back. */
      index: z.number().int().min(0),
      fit: z.number().min(0).max(1),
      reason: z.string(),
    }),
  ),
});
export type PersonaScoreOutput = z.infer<typeof PersonaScoreSchema>;

export const TrendAnalysisSchema = z.object({
  themes: z.array(
    z.object({
      theme: z.string().min(1),
      evidence: z.string(),
      relevance: z.number().min(0).max(1),
    }),
  ),
  peerPatterns: z.array(
    z.object({
      pattern: z.string().min(1),
      /** Abstracted, not copied — §1.4 is explicit about pattern-learning. */
      appliesTo: z.string(),
    }),
  ),
});
export type TrendAnalysisOutput = z.infer<typeof TrendAnalysisSchema>;

export const DocumentInsightSchema = z.object({
  summary: z.string().min(1),
  insights: z.array(z.string()),
  recurringProblems: z.array(z.string()),
  /** Verbatim phrasing worth reusing — the point of §1.9. */
  clientLanguage: z.array(z.string()),
});
export type DocumentInsightOutput = z.infer<typeof DocumentInsightSchema>;

/**
 * Phase 3 hedge (§5). Classifying inbound along the customer/operator axis costs
 * almost nothing now and means Phase 3 starts with a year of labeled data
 * instead of a cold start.
 */
export const AudienceAxisSchema = z.object({
  axis: z.enum(["CUSTOMER", "OPERATOR", "PEER", "UNKNOWN"]),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});
export type AudienceAxisOutput = z.infer<typeof AudienceAxisSchema>;

export const OutreachDraftSchema = z.object({
  message: z.string().min(1),
  whyThisPerson: z.string().min(1),
});
export type OutreachDraftOutput = z.infer<typeof OutreachDraftSchema>;
