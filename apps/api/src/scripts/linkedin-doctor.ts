/**
 * `pnpm linkedin:doctor` — check LinkedIn credentials before trusting them.
 *
 * Every failure mode here is one that otherwise surfaces halfway through an
 * OAuth redirect, where the error is a LinkedIn error page rather than
 * something actionable. The point is to fail on this side of the redirect,
 * with a sentence saying what to change.
 *
 * It makes exactly one network call, deliberately doomed: a token exchange with
 * a bogus authorization code. LinkedIn distinguishes "I don't recognise this
 * client" from "I recognise the client, that code is nonsense", which is enough
 * to verify the client id and secret without any user interaction.
 */

import { authorizationUrl, requestedScopes } from "@guru/linkedin";

const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";

type Level = "ok" | "warn" | "fail";

const results: { level: Level; message: string }[] = [];
const record = (level: Level, message: string) => results.push({ level, message });

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

async function main() {
  const clientId = env("LINKEDIN_CLIENT_ID");
  const clientSecret = env("LINKEDIN_CLIENT_SECRET");
  const redirectUri = env("LINKEDIN_REDIRECT_URI");
  const feedApproved = env("LINKEDIN_FEED_SCOPES_APPROVED") === "true";

  // --- Presence ---

  if (!clientId) record("fail", "LINKEDIN_CLIENT_ID is not set.");
  if (!clientSecret) record("fail", "LINKEDIN_CLIENT_SECRET is not set.");
  if (!redirectUri) record("fail", "LINKEDIN_REDIRECT_URI is not set.");

  if (clientId && /^(dev-placeholder|test|changeme|xxx)/i.test(clientId)) {
    record("fail", `LINKEDIN_CLIENT_ID is still a placeholder ("${clientId}").`);
  }

  // --- Redirect URI shape ---
  //
  // LinkedIn matches the redirect URI exactly, including trailing slash and
  // scheme. A near-miss produces a redirect_uri_mismatch at consent time, which
  // is a confusing place to learn about a trailing slash.

  if (redirectUri) {
    try {
      const url = new URL(redirectUri);
      if (url.protocol !== "https:" && url.hostname !== "localhost") {
        record("fail", `Redirect URI must be https unless it is localhost: ${redirectUri}`);
      }
      if (url.hash || url.search) {
        record("fail", "Redirect URI must have no query string or fragment.");
      }
      if (!url.pathname.endsWith("/auth/linkedin/callback")) {
        record(
          "warn",
          `Redirect URI path is "${url.pathname}"; this app serves the callback at /auth/linkedin/callback.`,
        );
      }
      record(
        "ok",
        `Redirect URI is well-formed. Paste it into the Developer Portal exactly: ${redirectUri}`,
      );
    } catch {
      record("fail", `Redirect URI is not a valid URL: ${redirectUri}`);
    }
  }

  // --- Scopes ---

  const scopes = requestedScopes({ feedApproved });
  record("ok", `Will request: ${scopes.join(" ")}`);

  if (feedApproved) {
    record(
      "warn",
      "LINKEDIN_FEED_SCOPES_APPROVED is true, so w_member_social_feed will be requested. " +
        "If Community Management is not actually approved for this app, sign-in will fail outright — " +
        "LinkedIn rejects the whole request rather than granting a subset.",
    );
  } else {
    record(
      "warn",
      "Commenting and reacting are disabled: w_member_social_feed is not being requested. " +
        "Publishing works. Apply for the Community Management API to enable the engagement engine (§1.6).",
    );
  }

  // --- Live credential check ---

  if (clientId && clientSecret) {
    const verdict = await probeCredentials(clientId, clientSecret);
    record(verdict.level, verdict.message);
  }

  // --- Authorization URL ---

  if (clientId && redirectUri) {
    const url = authorizationUrl(
      { clientId, clientSecret: clientSecret ?? "", redirectUri, feedScopesApproved: feedApproved },
      "doctor-check",
    );
    record("ok", `Consent URL (open to test the full flow):\n    ${url}`);
  }

  report();
}

/**
 * Probes with the `client_credentials` grant.
 *
 * The obvious approach — a token exchange with a bogus authorization code —
 * does not work: LinkedIn validates the code first and returns
 * "authorization code not found" for a real and a fabricated client alike, so
 * it reports success for credentials that are complete nonsense.
 *
 * `client_credentials` validates the client first, so an unknown id comes back
 * as `invalid_client_id` and a bad secret as a distinct client error. Most apps
 * are not entitled to this grant, and that is fine — being told "you may not
 * use this grant" still proves LinkedIn recognised the app.
 */
async function probeCredentials(
  clientId: string,
  clientSecret: string,
): Promise<{ level: Level; message: string }> {
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
  } catch (err) {
    return {
      level: "warn",
      message: `Could not reach LinkedIn to verify credentials: ${(err as Error).message}`,
    };
  }

  const body = await res.text();
  const lower = body.toLowerCase();

  if (lower.includes("invalid_client_id")) {
    return {
      level: "fail",
      message:
        "LinkedIn does not recognise this client ID. Copy it again from the Developer Portal " +
        "(My Apps → your app → Auth).",
    };
  }

  // Verified against the live endpoint: a wrong or truncated secret comes back
  // as `invalid_client` / "Client authentication failed" — *not*
  // `invalid_client_secret`, which LinkedIn does not appear to emit at all.
  // Matching only the latter made this check pass for any secret whatsoever,
  // which is worse than not checking.
  if (lower.includes("invalid_client") || lower.includes("client authentication failed")) {
    return {
      level: "fail",
      message:
        "The client ID is valid but the secret is not. The secret is shown in full only once — " +
        "a truncated paste fails exactly like this. Generate a new one if you no longer have it.",
    };
  }

  // The expected success shape: authentication passed, and LinkedIn refused the
  // grant itself because self-serve apps are not entitled to application
  // tokens. Refusing *this* far in proves the id and secret were accepted.
  if (lower.includes("application tokens") || lower.includes("access_denied")) {
    return {
      level: "ok",
      message: "LinkedIn accepted this client ID and secret.",
    };
  }

  if (res.ok) {
    return { level: "ok", message: "LinkedIn accepted this client ID and secret." };
  }

  // Anything else is unclassified. Do not call it a pass — an unrecognised
  // error shape is exactly how the previous false pass happened.
  return {
    level: "warn",
    message:
      `Could not classify LinkedIn's response (HTTP ${res.status}): ${body.slice(0, 200)}. ` +
      "Treat the credentials as unverified and test the consent URL.",
  };
}

function report() {
  const icon: Record<Level, string> = { ok: "✓", warn: "!", fail: "✗" };
  console.log("\nLinkedIn credential check\n");
  for (const { level, message } of results) {
    console.log(`  ${icon[level]} ${message}`);
  }

  const failures = results.filter((r) => r.level === "fail").length;
  console.log("");

  if (failures > 0) {
    console.log(`${failures} problem(s) must be fixed before connecting an account.\n`);
    process.exit(1);
  }
  console.log("Credentials look usable. Open the consent URL above to test the full flow.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
