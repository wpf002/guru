/**
 * LinkedIn member actions under `w_member_social` — roadmap §1.5 and §1.6.
 *
 * The scope is documented as: post, comment, and react on posts on behalf of an
 * authenticated member. All three are here. The comment and react halves are
 * what make the engagement engine (§1.6) a Phase 1 subsystem rather than a
 * Phase 2 aspiration — no partner approval, no gray-area automation.
 *
 * What is *not* here: connection requests and DMs. There is no sanctioned API
 * path for either (§0.4). Anything that appears to offer one is session-cookie
 * automation that puts the member's account — the asset this product exists to
 * grow — at risk.
 */

const API_BASE = "https://api.linkedin.com/rest";

/**
 * LinkedIn versions its REST API by month and deprecates versions on a rolling
 * ~12-month window. Pinned here so an upgrade is a deliberate, greppable change
 * rather than a silent behavioural shift.
 */
export const LINKEDIN_API_VERSION = "202506";

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
  constructor(
    private readonly accessToken: string,
    /** `urn:li:person:{sub}` — the OIDC sub, not the profile vanity name. */
    private readonly personUrn: string,
  ) {}

  static personUrnFromSub(sub: string): string {
    return `urn:li:person:${sub}`;
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
    const encoded = encodeURIComponent(options.postUrn);
    const res = await this.request(`/socialActions/${encoded}/comments`, {
      method: "POST",
      body: {
        actor: this.personUrn,
        object: options.postUrn,
        message: { text: options.text },
      },
    });

    const urn =
      res.headers.get("x-restli-id") ??
      (safeParse(res.text)?.["$URN"] as string | undefined) ??
      (safeParse(res.text)?.id as string | undefined);

    if (!urn) {
      throw new LinkedInApiError(
        "LinkedIn accepted the comment but returned no URN.",
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
    await this.request("/reactions", {
      method: "POST",
      query: { actor: this.personUrn },
      body: {
        root: options.postUrn,
        reactionType: options.type ?? "LIKE",
      },
    });
  }

  /** Delete a post the member published. */
  async deletePost(postUrn: string): Promise<void> {
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
