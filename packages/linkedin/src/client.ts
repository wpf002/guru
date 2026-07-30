import {
  assertCapability,
  capabilities,
  parseGrantedScopes,
  type MemberCapability,
} from "./scopes.js";

/**
 * LinkedIn member actions — roadmap §1.5 and §1.6.
 *
 * All three actions live here, but they do *not* share a scope, which is a
 * correction to §0.1. Publishing needs `w_member_social` (Share on LinkedIn,
 * self-serve); commenting and reacting need `w_member_social_feed` (Community
 * Management, vetted). See scopes.ts for why the roadmap's reading was wrong.
 *
 * Each method checks the granted scope before spending a round trip, so a
 * missing approval reads as an explanation rather than a 403 from inside a
 * publish path.
 *
 * What is *not* here: connection requests and DMs. There is no sanctioned API
 * path for either (§0.4). Anything that appears to offer one is session-cookie
 * automation that puts the member's account — the asset this product exists to
 * grow — at risk.
 */

const API_BASE = "https://api.linkedin.com/rest";

/**
 * LinkedIn versions its REST API by month and supports each version for a
 * minimum of twelve months. Pinned so an upgrade is a deliberate, greppable
 * change rather than a silent behavioural shift — and it needs revisiting
 * yearly, because a sunset version is rejected outright rather than falling
 * back to the latest.
 */
export const LINKEDIN_API_VERSION = "202607";

export type ReactionType =
  | "LIKE"
  | "PRAISE"
  | "EMPATHY"
  | "INTEREST"
  | "APPRECIATION"
  | "ENTERTAINMENT";

export type Visibility = "PUBLIC" | "CONNECTIONS";

export interface PublishResult {
  /** The post URN, tracked forward from creation (§0.3). */
  urn: string;
}

export class LinkedInApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "LinkedInApiError";
  }
}

/** 401 means re-auth; the caller must not retry it as a transient failure. */
export class LinkedInAuthExpiredError extends LinkedInApiError {
  constructor(body: string) {
    super("LinkedIn access token is invalid or expired.", 401, body, false);
    this.name = "LinkedInAuthExpiredError";
  }
}

export class LinkedInClient {
  private readonly granted: Set<string>;

  constructor(
    private readonly accessToken: string,
    /** `urn:li:person:{sub}` — the OIDC sub, not the profile vanity name. */
    private readonly personUrn: string,
    /** Scopes as granted with the token, not as requested. */
    grantedScopes: string | Set<string> = "",
  ) {
    this.granted =
      typeof grantedScopes === "string" ? parseGrantedScopes(grantedScopes) : grantedScopes;
  }

  static personUrnFromSub(sub: string): string {
    return `urn:li:person:${sub}`;
  }

  /** What this connection can actually do — for the UI to render honestly. */
  can(): Record<MemberCapability, boolean> {
    return capabilities(this.granted);
  }

  private async request(
    path: string,
    init: { method: string; body?: unknown; query?: Record<string, string> },
  ): Promise<{ status: number; headers: Headers; text: string }> {
    const url = new URL(`${API_BASE}${path}`);
    for (const [k, v] of Object.entries(init.query ?? {})) {
      url.searchParams.set(k, v);
    }

    const res = await fetch(url, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
        "LinkedIn-Version": LINKEDIN_API_VERSION,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

    const text = await res.text();

    if (res.status === 401) throw new LinkedInAuthExpiredError(text);
    if (!res.ok) {
      // 429 and 5xx are worth retrying with backoff; 4xx is a bad request that
      // will fail identically forever.
      const retryable = res.status === 429 || res.status >= 500;
      throw new LinkedInApiError(
        `LinkedIn API ${init.method} ${path} failed with ${res.status}.`,
        res.status,
        text,
        retryable,
      );
    }

    return { status: res.status, headers: res.headers, text };
  }

  /**
   * Publish a text post to the member's feed. §1.5.
   *
   * The created URN comes back in `x-restli-id`, not the body — the Posts API
   * returns 201 with an empty body.
   */
  async publishPost(options: {
    text: string;
    visibility?: Visibility;
  }): Promise<PublishResult> {
    assertCapability(this.granted, "PUBLISH");

    const res = await this.request("/posts", {
      method: "POST",
      body: {
        author: this.personUrn,
        commentary: options.text,
        visibility: options.visibility ?? "PUBLIC",
        distribution: {
          feedDistribution: "MAIN_FEED",
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
      },
    });

    const urn = res.headers.get("x-restli-id");
    if (!urn) {
      throw new LinkedInApiError(
        "LinkedIn accepted the post but returned no URN — publish state is unknown.",
        res.status,
        res.text,
        false,
      );
    }
    return { urn };
  }

  /**
   * Comment on any post as the member. §1.6 — the highest-ROI action available.
   *
   * `postUrn` is the activity or share URN of the target post.
   */
  async comment(options: { postUrn: string; text: string }): Promise<PublishResult> {
    assertCapability(this.granted, "COMMENT");

    const encoded = encodeURIComponent(options.postUrn);
    const res = await this.request(`/socialActions/${encoded}/comments`, {
      method: "POST",
      body: {
        actor: this.personUrn,
        object: options.postUrn,
        message: { text: options.text },
      },
    });

    // A comment URN is composite: urn:li:comment:(threadUrn,commentId). The
    // body carries the assembled form; the header carries only the bare id, so
    // it has to be composed with the thread we commented on.
    const body = safeParse(res.text);
    const composite = body?.commentUrn as string | undefined;
    const bareId = res.headers.get("x-restli-id") ?? (body?.id as string | undefined);

    const urn = composite ?? (bareId ? `urn:li:comment:(${options.postUrn},${bareId})` : null);

    if (!urn) {
      throw new LinkedInApiError(
        "LinkedIn accepted the comment but returned no identifier.",
        res.status,
        res.text,
        false,
      );
    }
    return { urn };
  }

  /** React to a post as the member. §1.6 — lower-stakes presence. */
  async react(options: {
    postUrn: string;
    type?: ReactionType;
  }): Promise<void> {
    assertCapability(this.granted, "REACT");

    await this.request("/reactions", {
      method: "POST",
      // Encoded because it is a URN in a query parameter under Rest.li 2.0.
      query: { actor: this.personUrn },
      body: {
        root: options.postUrn,
        // MAYBE was removed in 202307 and now 400s; ReactionType excludes it.
        reactionType: options.type ?? "LIKE",
      },
    });
  }

  /** Delete a post the member published. */
  async deletePost(postUrn: string): Promise<void> {
    assertCapability(this.granted, "PUBLISH");
    await this.request(`/posts/${encodeURIComponent(postUrn)}`, { method: "DELETE" });
  }
}

function safeParse(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}
