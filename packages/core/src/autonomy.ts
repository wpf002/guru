/**
 * Autonomy guardrails — roadmap §2.1, §2.2, §2.5.
 *
 * Autonomy is the feature with the worst failure mode in the product, so the
 * decision to act is pure, ordered, and testable, with no I/O in it. Every gate
 * is a veto; there is no scoring or weighting, and nothing overrides a block.
 *
 * The order is deliberate — the kill switch is checked before anything else, so
 * a user who hits it does not have to out-argue a confidence score.
 */

export type AutonomyKind = "ENGAGEMENT" | "CONTENT" | "OUTREACH";

export type AutonomyDecision =
  | { allowed: true }
  | {
      allowed: false;
      outcome:
        | "BLOCKED_KILL_SWITCH"
        | "BLOCKED_CAP"
        | "BLOCKED_CONFIDENCE"
        | "BLOCKED_ALLOWLIST"
        | "BLOCKED_CONSTRAINT";
      reason: string;
    };

export interface AutonomyGuardrails {
  killSwitch: boolean;
  killSwitchReason?: string | null;
  engagementAutonomyEnabled: boolean;
  contentAutonomyEnabled: boolean;
  dailyEngagementCap: number;
  dailyContentCap: number;
  targetAllowlist: readonly string[];
  requireAllowlist: boolean;
  topicExclusions: readonly string[];
}

export interface AutonomyRequest {
  kind: AutonomyKind;
  /** Actions of this kind already taken in the current 24 hours. */
  actionsToday: number;
  /** Null when the category has not reached its minimum sample size. */
  confidenceScore: number | null;
  /** The post author or profile being acted on, for the allowlist check. */
  targetIdentifier?: string | null;
  /** The text about to be published, for the exclusion check. */
  text?: string | null;
}

/**
 * Content autonomy needs a higher bar than engagement: a bad post goes out under
 * the user's name to their whole network, while a bad comment is one line under
 * someone else's post.
 *
 * Outreach is higher again and permanently so (§2.5) — and in Phase 2 it is
 * never actually autonomous, because no compliant send path exists. The
 * threshold exists so the assisted-send flow can still be gated on earned trust.
 */
export const AUTONOMY_THRESHOLDS: Record<AutonomyKind, number> = {
  ENGAGEMENT: 0.9,
  CONTENT: 0.95,
  OUTREACH: 0.98,
};

export function evaluateAutonomy(
  guardrails: AutonomyGuardrails,
  request: AutonomyRequest,
): AutonomyDecision {
  // 1. Kill switch. First, unconditionally.
  if (guardrails.killSwitch) {
    return {
      allowed: false,
      outcome: "BLOCKED_KILL_SWITCH",
      reason: guardrails.killSwitchReason || "Autonomy is halted by the kill switch.",
    };
  }

  // 2. Is this kind of autonomy switched on at all?
  const enabled =
    request.kind === "ENGAGEMENT"
      ? guardrails.engagementAutonomyEnabled
      : request.kind === "CONTENT"
        ? guardrails.contentAutonomyEnabled
        : false;

  if (!enabled) {
    return {
      allowed: false,
      outcome: "BLOCKED_CONFIDENCE",
      reason:
        request.kind === "OUTREACH"
          ? "Outreach is never autonomous — no compliant send path exists, so it stays assisted."
          : `${request.kind.toLowerCase()} autonomy is not enabled.`,
    };
  }

  // 3. Confidence. An unscored category is not a passing category.
  const threshold = AUTONOMY_THRESHOLDS[request.kind];
  if (request.confidenceScore === null) {
    return {
      allowed: false,
      outcome: "BLOCKED_CONFIDENCE",
      reason: "Not enough decisions yet to score this category.",
    };
  }
  if (request.confidenceScore < threshold) {
    return {
      allowed: false,
      outcome: "BLOCKED_CONFIDENCE",
      reason: `Confidence ${request.confidenceScore.toFixed(2)} is below the ${threshold} threshold for ${request.kind.toLowerCase()}.`,
    };
  }

  // 4. Daily volume cap.
  const cap =
    request.kind === "ENGAGEMENT" ? guardrails.dailyEngagementCap : guardrails.dailyContentCap;
  if (request.actionsToday >= cap) {
    return {
      allowed: false,
      outcome: "BLOCKED_CAP",
      reason: `Daily cap of ${cap} already reached (${request.actionsToday} today).`,
    };
  }

  // 5. Allowlist. An empty list with the requirement on blocks everything —
  // "no allowlist configured" must never quietly mean "everyone is allowed".
  if (guardrails.requireAllowlist && request.kind === "ENGAGEMENT") {
    const target = request.targetIdentifier?.trim().toLowerCase();
    const allowed = guardrails.targetAllowlist.map((a) => a.trim().toLowerCase());
    if (!target || !allowed.includes(target)) {
      return {
        allowed: false,
        outcome: "BLOCKED_ALLOWLIST",
        reason: target
          ? `"${request.targetIdentifier}" is not on the autonomous-engagement allowlist.`
          : "No target identified, and the allowlist is required.",
      };
    }
  }

  // 6. Topic exclusions, on top of the brief's never-say list.
  if (request.text && guardrails.topicExclusions.length > 0) {
    const hit = guardrails.topicExclusions.find((topic) => {
      const trimmed = topic.trim();
      if (!trimmed) return false;
      return new RegExp(escapeRegExp(trimmed), "i").test(request.text!);
    });
    if (hit) {
      return {
        allowed: false,
        outcome: "BLOCKED_CONSTRAINT",
        reason: `Output mentions an excluded topic: "${hit}".`,
      };
    }
  }

  return { allowed: true };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
