/**
 * LinkedIn scopes — roadmap §0.6, and a correction to §0.1.
 *
 * The roadmap reads `w_member_social`'s description ("post, comment, and like
 * posts on behalf of an authenticated member") and concludes that commenting and
 * reacting are self-serve. The scope *description* says that. The per-endpoint
 * permission tables do not:
 *
 *   POST /rest/posts           → w_member_social          (Share on LinkedIn, self-serve)
 *   POST /rest/socialActions/… → w_member_social_feed     (Community Management, vetted)
 *   POST /rest/reactions       → w_member_social_feed     (Community Management, vetted)
 *
 * So publishing is self-serve and the engagement engine is not. Community
 * Management is a vetted product with a Development → Standard tier application
 * and a screencast review.
 *
 * Two consequences shape this file:
 *
 *  1. Scopes must be configurable, because LinkedIn rejects an authorization
 *     request that names a scope the app has not been approved for. Asking for
 *     `w_member_social_feed` before approval breaks sign-in entirely — it does
 *     not degrade to a partial grant.
 *
 *  2. Granted scopes must be checked before an action is attempted, so a missing
 *     approval surfaces as an explicable message rather than a 403 from
 *     somewhere deep in a publish path.
 */

/** Always required: identity, plus publishing. Both self-serve. */
export const BASE_SCOPES = ["openid", "profile", "email", "w_member_social"] as const;

/**
 * Comment and react. Gated behind the Community Management API.
 * Do not request until the Developer Portal shows that product as approved.
 */
export const FEED_SCOPES = ["w_member_social_feed"] as const;

export type LinkedInScope = (typeof BASE_SCOPES)[number] | (typeof FEED_SCOPES)[number];

export interface ScopeConfig {
  /** True once Community Management is approved for the app. */
  feedApproved: boolean;
}

export function requestedScopes(config: ScopeConfig): string[] {
  return config.feedApproved ? [...BASE_SCOPES, ...FEED_SCOPES] : [...BASE_SCOPES];
}

/**
 * Parses the `scope` string LinkedIn returns with the token.
 *
 * Read from the grant, never from what was requested — LinkedIn can return a
 * narrower set than asked for, and assuming otherwise means discovering the
 * difference at publish time.
 */
export function parseGrantedScopes(scope: string | null | undefined): Set<string> {
  return new Set(
    (scope ?? "")
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export type MemberCapability = "PUBLISH" | "COMMENT" | "REACT";

const CAPABILITY_SCOPE: Record<MemberCapability, string> = {
  PUBLISH: "w_member_social",
  COMMENT: "w_member_social_feed",
  REACT: "w_member_social_feed",
};

export function hasCapability(granted: Set<string>, capability: MemberCapability): boolean {
  return granted.has(CAPABILITY_SCOPE[capability]);
}

export class MissingScopeError extends Error {
  constructor(
    readonly capability: MemberCapability,
    readonly requiredScope: string,
  ) {
    super(
      `This LinkedIn connection cannot ${capability.toLowerCase()} — it was granted without "${requiredScope}". ` +
        (requiredScope === "w_member_social_feed"
          ? "That scope comes from the Community Management API, which is a vetted product: apply for Development Tier in the Developer Portal, then upgrade to Standard Tier. Publishing still works without it."
          : "Add the Share on LinkedIn product to the app and reconnect."),
    );
    this.name = "MissingScopeError";
  }
}

export function assertCapability(granted: Set<string>, capability: MemberCapability): void {
  if (!hasCapability(granted, capability)) {
    throw new MissingScopeError(capability, CAPABILITY_SCOPE[capability]);
  }
}

/** What this connection can actually do, for the UI to render honestly. */
export function capabilities(granted: Set<string>): Record<MemberCapability, boolean> {
  return {
    PUBLISH: hasCapability(granted, "PUBLISH"),
    COMMENT: hasCapability(granted, "COMMENT"),
    REACT: hasCapability(granted, "REACT"),
  };
}
