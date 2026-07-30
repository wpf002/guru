import { randomBytes } from "node:crypto";

/**
 * LinkedIn three-legged OAuth — roadmap §1.0 / §0.6.
 *
 * Products: "Sign In with LinkedIn using OpenID Connect" + "Share on LinkedIn".
 * Scopes:   openid profile email w_member_social
 *
 * All scopes appear on a single consent screen and the member accepts all or
 * none, so the requested set is the minimum that makes the product work. Adding
 * a scope later means every existing user re-consents.
 */

export const LINKEDIN_SCOPES = ["openid", "profile", "email", "w_member_social"] as const;

const AUTHORIZE_URL = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const USERINFO_URL = "https://api.linkedin.com/v2/userinfo";

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface TokenResponse {
  accessToken: string;
  /** Authorization-code tokens run ~60 days. */
  expiresAt: Date;
  refreshToken?: string;
  refreshTokenExpiresAt?: Date;
  /** Scopes as *granted*, which is not always what was requested. */
  scope: string;
}

export interface LinkedInProfile {
  sub: string;
  name?: string;
  email?: string;
  emailVerified?: boolean;
  picture?: string;
}

export class LinkedInAuthError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = "LinkedInAuthError";
  }
}

/** CSRF state. Store it server-side against the session and compare with safeEqual. */
export function generateState(): string {
  return randomBytes(32).toString("base64url");
}

export function authorizationUrl(config: OAuthConfig, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    state,
    scope: LINKEDIN_SCOPES.join(" "),
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

interface RawTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
}

async function postToken(body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const text = await res.text();
  if (!res.ok) {
    // The body can echo the client_secret back on some error paths, so it is
    // never included in the message — only in the structured field, which the
    // logger redacts.
    throw new LinkedInAuthError("LinkedIn token exchange failed.", res.status, text);
  }

  let raw: RawTokenResponse;
  try {
    raw = JSON.parse(text) as RawTokenResponse;
  } catch {
    throw new LinkedInAuthError("LinkedIn returned a non-JSON token response.", res.status);
  }

  const now = Date.now();
  return {
    accessToken: raw.access_token,
    expiresAt: new Date(now + raw.expires_in * 1000),
    refreshToken: raw.refresh_token,
    refreshTokenExpiresAt: raw.refresh_token_expires_in
      ? new Date(now + raw.refresh_token_expires_in * 1000)
      : undefined,
    scope: raw.scope ?? LINKEDIN_SCOPES.join(" "),
  };
}

export function exchangeCode(config: OAuthConfig, code: string): Promise<TokenResponse> {
  return postToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  );
}

/**
 * Refresh tokens are only issued to approved applications. When one is absent,
 * the account re-authorizes at expiry — which is why LinkedInAccount tracks
 * refreshFailureCount and the UI has a re-auth path rather than silently
 * failing to publish.
 */
export function refreshAccessToken(
  config: OAuthConfig,
  refreshToken: string,
): Promise<TokenResponse> {
  return postToken(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  );
}

export async function fetchProfile(accessToken: string): Promise<LinkedInProfile> {
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new LinkedInAuthError(
      "Failed to fetch LinkedIn profile.",
      res.status,
      await res.text(),
    );
  }
  const raw = (await res.json()) as Record<string, unknown>;
  return {
    sub: String(raw.sub),
    name: raw.name as string | undefined,
    email: raw.email as string | undefined,
    emailVerified: raw.email_verified as boolean | undefined,
    picture: raw.picture as string | undefined,
  };
}

/**
 * Rotate well before expiry rather than at it. A token that expires between the
 * scheduler picking up a post and the publish call is a failed post the user
 * finds out about later.
 */
export function needsRefresh(expiresAt: Date, marginDays = 7, now = new Date()): boolean {
  return expiresAt.getTime() - now.getTime() < marginDays * 86_400_000;
}
