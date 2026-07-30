import { prisma } from "@guru/db";
import { decryptToken, encryptToken } from "@guru/core";
import type { EmailHeaderLike } from "@guru/archive";

/**
 * Google connection — Gmail for the archive emails (§1.1), Drive for meeting
 * notes (§1.9).
 *
 * Read-only scopes only. Guru never sends mail, never modifies a document, and
 * never touches anything outside the two narrow queries below — which is worth
 * being able to say plainly on the consent screen, because "connect your Gmail"
 * is a much bigger ask than "connect your LinkedIn".
 */

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
] as const;

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export class GoogleApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

export function googleAuthorizationUrl(config: GoogleConfig, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    state,
    scope: GOOGLE_SCOPES.join(" "),
    // Without these, Google withholds the refresh token on re-consent and the
    // watcher silently stops working a week later.
    access_type: "offline",
    prompt: "consent",
  });
  return `${AUTH_URL}?${params.toString()}`;
}

interface RawGoogleToken {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

async function postToken(body: URLSearchParams) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new GoogleApiError("Google token exchange failed.", res.status);
  }
  const raw = (await res.json()) as RawGoogleToken;
  return {
    accessToken: raw.access_token,
    expiresAt: new Date(Date.now() + raw.expires_in * 1000),
    refreshToken: raw.refresh_token,
    scope: raw.scope ?? GOOGLE_SCOPES.join(" "),
  };
}

export function exchangeGoogleCode(config: GoogleConfig, code: string) {
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
 * Returns a usable access token, refreshing first if it is close to expiry.
 * Google access tokens last an hour, so the watcher refreshes constantly — this
 * is the hot path, not an edge case.
 */
export async function googleAccessToken(
  config: GoogleConfig,
  userId: string,
): Promise<string> {
  const account = await prisma.googleAccount.findUnique({ where: { userId } });
  if (!account || account.disconnectedAt) {
    throw new GoogleApiError("No connected Google account for this user.");
  }

  const marginMs = 5 * 60 * 1000;
  if (account.accessTokenExpiresAt.getTime() - Date.now() > marginMs) {
    return decryptToken(account.accessTokenCipher);
  }

  if (!account.refreshTokenCipher) {
    throw new GoogleApiError(
      "Google access token expired and no refresh token is stored — the user must reconnect.",
    );
  }

  const refreshed = await postToken(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: decryptToken(account.refreshTokenCipher),
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  );

  await prisma.googleAccount.update({
    where: { userId },
    data: {
      accessTokenCipher: encryptToken(refreshed.accessToken),
      accessTokenExpiresAt: refreshed.expiresAt,
    },
  });

  return refreshed.accessToken;
}

async function gmailGet<T>(accessToken: string, path: string): Promise<T> {
  const res = await fetch(`${GMAIL_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new GoogleApiError(`Gmail ${path} failed with ${res.status}.`, res.status);
  }
  return (await res.json()) as T;
}

interface GmailMessageRef {
  id: string;
}
interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
}
interface GmailMessage {
  id: string;
  internalDate?: string;
  payload?: GmailPart & { headers?: { name: string; value: string }[] };
}

export interface FetchedEmail {
  header: EmailHeaderLike;
  body: string;
}

/** Search headers only — cheap enough to poll, and enough to classify. */
export async function searchMessages(
  accessToken: string,
  query: string,
): Promise<string[]> {
  const result = await gmailGet<{ messages?: GmailMessageRef[] }>(
    accessToken,
    `/messages?q=${encodeURIComponent(query)}&maxResults=25`,
  );
  return (result.messages ?? []).map((m) => m.id);
}

export async function fetchMessage(
  accessToken: string,
  messageId: string,
): Promise<FetchedEmail> {
  const message = await gmailGet<GmailMessage>(accessToken, `/messages/${messageId}?format=full`);

  const headers = message.payload?.headers ?? [];
  const headerValue = (name: string) =>
    headers.find((h) => h.name.toLowerCase() === name)?.value ?? "";

  return {
    header: {
      from: headerValue("from"),
      subject: headerValue("subject"),
      receivedAt: new Date(Number(message.internalDate ?? Date.now())),
      messageId: message.id,
    },
    body: collectBody(message.payload),
  };
}

/**
 * Gmail nests bodies arbitrarily deep under multipart/alternative and
 * multipart/related. Concatenating every text part is simpler and more robust
 * than trying to pick "the" body — the link extractor only needs the link to
 * appear somewhere.
 */
function collectBody(part: GmailPart | undefined, depth = 0): string {
  if (!part || depth > 10) return "";

  const chunks: string[] = [];
  if (part.body?.data) {
    chunks.push(Buffer.from(part.body.data, "base64url").toString("utf8"));
  }
  for (const child of part.parts ?? []) {
    chunks.push(collectBody(child, depth + 1));
  }
  return chunks.join("\n");
}
