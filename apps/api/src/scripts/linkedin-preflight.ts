/**
 * `pnpm linkedin:preflight` — exercise the publish path without publishing.
 *
 * Publishing is the one part of §1.5 that has never been called. Actually
 * posting to prove it works is a real post on a real profile, which is a high
 * price for a smoke test — so this isolates everything *except* the final
 * write and reports which layer, if any, is broken.
 *
 * Four checks, none of which create anything:
 *
 *   1. Token decryption and validity, via the OIDC userinfo endpoint.
 *   2. The versioned REST surface, via a GET that the pinned
 *      `LinkedIn-Version` must be accepted for. A sunset version answers 426
 *      here rather than at 9am on the morning of a scheduled post.
 *   3. The posts endpoint itself, with a deliberately invalid body. LinkedIn
 *      checks the token, the scope, the protocol headers and the version
 *      *before* it validates the body, so a complaint about the body proves
 *      everything underneath it is right.
 *   4. The body shape — because that complaint enumerates every field LinkedIn
 *      requires, which is a contract the real payload can be held to without
 *      sending one. This is what would catch a newly-required field.
 *
 * What remains unproven is the *content* of those fields: that a real
 * commentary string and a real visibility value are accepted. Only an actual
 * post settles that, and it can be deleted immediately afterwards. The gap is
 * stated at the end rather than glossed.
 */

import { prisma } from "@guru/db";
import { decryptToken } from "@guru/core";
import { LINKEDIN_API_VERSION } from "@guru/linkedin";
import { loadEnv } from "../env.js";

const REST_BASE = "https://api.linkedin.com/rest";
const USERINFO = "https://api.linkedin.com/v2/userinfo";

type Level = "ok" | "warn" | "fail";
const results: { level: Level; message: string }[] = [];
const record = (level: Level, message: string) => results.push({ level, message });

async function main() {
  const env = loadEnv();
  if (!env.linkedin) {
    record("fail", "LinkedIn is not configured — set LINKEDIN_CLIENT_ID and friends.");
    return report();
  }

  const account = await prisma.linkedInAccount.findFirst({
    orderBy: { connectedAt: "desc" },
    select: {
      userId: true,
      accessTokenCipher: true,
      accessTokenExpiresAt: true,
      scopes: true,
      linkedinSub: true,
      user: { select: { email: true } },
    },
  });

  if (!account) {
    record("fail", "No LinkedIn account is connected. Sign in and connect one first.");
    return report();
  }

  record("ok", `Testing the connection on ${account.user.email}.`);

  // --- 1. Token decryption -------------------------------------------------

  let token: string;
  try {
    token = decryptToken(account.accessTokenCipher);
  } catch (err) {
    record("fail", `Stored token will not decrypt: ${(err as Error).message}. ` +
      "TOKEN_ENCRYPTION_KEY has probably changed since the token was written.");
    return report();
  }
  record("ok", "Stored token decrypts with the current TOKEN_ENCRYPTION_KEY.");

  const msLeft = account.accessTokenExpiresAt.getTime() - Date.now();
  const daysLeft = Math.floor(msLeft / 86_400_000);
  if (msLeft <= 0) {
    record("fail", "The access token has expired. Reconnect LinkedIn.");
  } else if (daysLeft < 7) {
    record("warn", `The access token expires in ${daysLeft} day(s) and there is no refresh token.`);
  } else {
    record("ok", `Access token is valid for another ${daysLeft} days.`);
  }

  if (!account.scopes.includes("w_member_social")) {
    record("fail", `w_member_social was not granted (got: ${account.scopes}). Publishing cannot work.`);
  } else {
    record("ok", "w_member_social is granted, so publishing is permitted.");
  }

  // --- 2. Is the token actually live? --------------------------------------

  const who = await fetch(USERINFO, { headers: { Authorization: `Bearer ${token}` } });
  if (who.status === 401) {
    record("fail", "LinkedIn rejected the token (401). It has been revoked or expired early.");
    return report();
  }
  if (!who.ok) {
    record("warn", `userinfo returned ${who.status}; token state is unclear.`);
  } else {
    const body = (await who.json()) as { sub?: string; name?: string };
    const matches = body.sub === account.linkedinSub;
    record(
      matches ? "ok" : "warn",
      matches
        ? `LinkedIn accepted the token and returned the expected member (${body.name}).`
        : `Token is live but the member id differs from the stored one (${body.sub} vs ${account.linkedinSub}).`,
    );
  }

  // --- 3. Is the pinned API version still supported? -----------------------
  //
  // LinkedIn supports each monthly version for a minimum of a year and then
  // rejects it outright — no fallback. 426 is what that looks like.

  const versionProbe = await fetch(`${REST_BASE}/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Restli-Protocol-Version": "2.0.0",
      "LinkedIn-Version": LINKEDIN_API_VERSION,
    },
  });

  if (versionProbe.status === 426) {
    record("fail", `LINKEDIN_API_VERSION ${LINKEDIN_API_VERSION} is no longer supported (426). Bump it.`);
  } else if (versionProbe.status === 401) {
    record("fail", "The versioned REST surface rejected the token (401).");
  } else {
    record("ok", `Versioned REST surface accepts LinkedIn-Version ${LINKEDIN_API_VERSION} (probe returned ${versionProbe.status}).`);
  }

  // --- 4. The posts endpoint, without creating a post ----------------------
  //
  // Deliberately invalid twice over: no commentary (required) and a
  // lifecycleState that does not exist. There is no path from this body to a
  // published post, but it still travels the full auth + scope + version stack.

  const probe = await fetch(`${REST_BASE}/posts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
      "LinkedIn-Version": LINKEDIN_API_VERSION,
    },
    body: JSON.stringify({
      author: `urn:li:person:${account.linkedinSub}`,
      lifecycleState: "GURU_PREFLIGHT_NOT_A_REAL_STATE",
    }),
  });

  const raw = await probe.text();
  const detail = raw.slice(0, 300);

  if (probe.status === 401) {
    record("fail", `POST /posts rejected the token (401): ${detail}`);
  } else if (probe.status === 403) {
    record(
      "fail",
      `POST /posts refused the scope (403). w_member_social is recorded as granted but LinkedIn disagrees: ${detail}`,
    );
  } else if (probe.status === 426) {
    record("fail", `POST /posts rejects LinkedIn-Version ${LINKEDIN_API_VERSION} (426): ${detail}`);
  } else if (probe.status === 400 || probe.status === 422) {
    record(
      "ok",
      `POST /posts authenticated and reached body validation (${probe.status}) — auth, scope, ` +
        "protocol headers and API version are all correct.",
    );
    // LinkedIn's rejection names every field it wanted, which is a contract we
    // can hold the real payload to without sending one.
    checkRequiredFields(raw);
  } else if (probe.status >= 200 && probe.status < 300) {
    record(
      "warn",
      `POST /posts returned ${probe.status} for a body that should have been rejected. ` +
        "Check the profile for a stray post.",
    );
  } else {
    record("warn", `POST /posts returned an unclassified ${probe.status}: ${detail}`);
  }

  report();
}

/**
 * Turns LinkedIn's own error into a schema check.
 *
 * The rejection lists each missing required field, so the set of names it
 * complains about *is* the required-field list for this API version. Comparing
 * that to the body `publishPost` builds catches the case that would otherwise
 * only surface on a real post: a field LinkedIn started requiring that we never
 * learned about.
 */
function checkRequiredFields(raw: string): void {
  const required = new Set(
    [...raw.matchAll(/\/(\w+) :: field is required but not found/g)].map((m) => m[1]!),
  );
  if (required.size === 0) {
    record("warn", "LinkedIn did not enumerate required fields, so the body shape is unverified.");
    return;
  }

  // Exactly what packages/linkedin publishPost sends, minus the two fields the
  // probe deliberately omitted or corrupted.
  const sends = new Set([
    "author",
    "commentary",
    "visibility",
    "distribution",
    "lifecycleState",
    "isReshareDisabledByAuthor",
  ]);

  const missing = [...required].filter((f) => !sends.has(f));
  const listed = [...required].join(", ");

  if (missing.length > 0) {
    record(
      "fail",
      `LinkedIn requires ${listed}, and publishPost does not send: ${missing.join(", ")}. ` +
        "A real post would be rejected.",
    );
  } else {
    record("ok", `Every field LinkedIn requires (${listed}) is present in the payload publishPost builds.`);
  }
}

function report() {
  const icon: Record<Level, string> = { ok: "✓", warn: "!", fail: "✗" };
  console.log("\nLinkedIn publish preflight\n");
  for (const { level, message } of results) console.log(`  ${icon[level]} ${message}`);

  const failures = results.filter((r) => r.level === "fail").length;
  console.log("");

  if (failures > 0) {
    console.log(`${failures} problem(s) would stop a real post from publishing.\n`);
    process.exitCode = 1;
    return;
  }

  console.log(
    "Verified against the live API without creating anything: token, scope, protocol\n" +
      "headers, API version, and that the payload carries every field LinkedIn says it\n" +
      "requires. What remains unproven is the *content* of those fields — that a real\n" +
      "commentary string and visibility value are accepted. Only an actual post settles\n" +
      "that, and it can be deleted immediately afterwards.\n",
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
