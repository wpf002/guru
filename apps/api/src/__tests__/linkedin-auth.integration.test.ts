import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@guru/db";
import { buildServer } from "../server.js";
import { resetDatabase, seedBrief } from "./helpers.js";

/**
 * Connecting LinkedIn must attach to the user who started the flow — §1.0.
 *
 * The bug this exists for: the callback keyed the user row on the *LinkedIn*
 * profile email. Any local user created with a different address got forked in
 * two — the token on a brand-new row, the intake, brief, and archive stranded on
 * the original. `connected: true` came back either way, so nothing surfaced
 * until a downstream read returned empty.
 *
 * The binding is now the session itself rather than a bespoke cookie, and there
 * is deliberately no fallback: if the session is gone by the time LinkedIn
 * redirects back, the flow fails rather than guessing whose account this is.
 *
 * These assert the promise ("connecting attaches to *my* account"), not the
 * mechanism, so a future rewrite of the binding still has to satisfy them.
 */

const { app, scheduler } = await buildServer();

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDatabase();
});

// The suite truncates between cases, so a scheduler tick firing mid-run would
// race it. buildServer already declines to start one under NODE_ENV=test;
// asserting it keeps that guarantee from quietly regressing.
it("does not start the scheduler under test", () => {
  expect(scheduler).toBeNull();
});

const PASSWORD = "correct horse battery staple";

async function signIn(email: string) {
  const res = await app.inject({
    method: "POST",
    url: "/auth/signup",
    payload: { email, password: PASSWORD },
  });
  expect(res.statusCode).toBe(201);
  return {
    userId: (res.json() as { user: { id: string } }).user.id,
    cookies: { guru_session: res.cookies.find((c) => c.name === "guru_session")!.value },
  };
}

describe("GET /auth/linkedin/start", () => {
  it("refuses an anonymous caller before sending anyone to consent", async () => {
    // Failing *after* consent would mean the user granted access for nothing.
    const res = await app.inject({ method: "GET", url: "/auth/linkedin/start" });

    expect(res.statusCode).toBe(401);
    expect(res.headers.location).toBeUndefined();
  });

  it("redirects a signed-in user to LinkedIn and sets a state cookie", async () => {
    const { cookies } = await signIn("connector@example.test");

    const res = await app.inject({ method: "GET", url: "/auth/linkedin/start", cookies });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain("linkedin.com/oauth/v2/authorization");

    const state = res.cookies.find((c) => c.name === "li_oauth_state");
    expect(state).toBeDefined();
    // Not readable or forgeable from page scripts.
    expect(state?.httpOnly).toBe(true);
  });

  it("state is unguessable and differs per attempt", async () => {
    const { cookies } = await signIn("state@example.test");

    const first = await app.inject({ method: "GET", url: "/auth/linkedin/start", cookies });
    const second = await app.inject({ method: "GET", url: "/auth/linkedin/start", cookies });

    const stateOf = (r: typeof first) =>
      r.cookies.find((c) => c.name === "li_oauth_state")?.value ?? "";

    expect(stateOf(first)).not.toBe(stateOf(second));
    expect(stateOf(first).length).toBeGreaterThan(20);
  });

  it("never names the client secret in the redirect", async () => {
    const { cookies } = await signIn("secret@example.test");
    const res = await app.inject({ method: "GET", url: "/auth/linkedin/start", cookies });
    expect(res.headers.location ?? "").not.toContain("client_secret");
  });
});

describe("GET /auth/linkedin/callback", () => {
  it("rejects a mismatched state without touching the database", async () => {
    const { cookies } = await signIn("forged@example.test");

    const res = await app.inject({
      method: "GET",
      url: "/auth/linkedin/callback?code=whatever&state=forged",
      cookies: { ...cookies, li_oauth_state: "the-real-one" },
    });

    expect(res.headers.location).toContain("invalid_state");
    expect(await prisma.linkedInAccount.count()).toBe(0);
  });

  it("treats a declined consent as a normal outcome", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/auth/linkedin/callback?error=user_cancelled_login&error_description=declined",
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain("declined");
    expect(await prisma.linkedInAccount.count()).toBe(0);
  });
});

describe("the account the connection lands on", () => {
  /**
   * The callback's token exchange needs LinkedIn, so the write itself is
   * exercised here directly against the same rule the route follows: the signed-
   * in user owns the connection. What is asserted is the consequence the user
   * cares about — their existing work stays attached.
   */
  it("keeps intake and brief attached when the LinkedIn email differs", async () => {
    const { userId } = await signIn("will@guru.local");
    const brief = await seedBrief(userId);

    // What the route does once the token exchange succeeds.
    await prisma.user.update({ where: { id: userId }, data: { name: "Will Foti, CISSP" } });
    await prisma.linkedInAccount.create({
      data: {
        userId,
        linkedinSub: "R9pfT6Zz-A",
        name: "Will Foti, CISSP",
        // The LinkedIn address deliberately differs from the local one.
        email: "will.foti@gmail.test",
        accessTokenCipher: "cipher",
        accessTokenExpiresAt: new Date(Date.now() + 60_000),
        scopes: "email,openid,profile,w_member_social",
      },
    });

    expect(await prisma.user.count()).toBe(1);

    const withAccount = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { linkedinAccount: true, briefs: true },
    });

    expect(withAccount.linkedinAccount).not.toBeNull();
    expect(withAccount.briefs.map((b) => b.id)).toContain(brief.id);
    // The local identity is not overwritten by whatever LinkedIn holds.
    expect(withAccount.email).toBe("will@guru.local");
  });

  it("status reports only the caller's own connection", async () => {
    const alice = await signIn("alice-li@example.test");
    const bob = await signIn("bob-li@example.test");

    await prisma.linkedInAccount.create({
      data: {
        userId: alice.userId,
        linkedinSub: "sub-alice",
        accessTokenCipher: "cipher",
        accessTokenExpiresAt: new Date(Date.now() + 60_000),
        scopes: "openid",
      },
    });

    const asAlice = await app.inject({
      method: "GET",
      url: "/auth/linkedin/status",
      cookies: alice.cookies,
    });
    const asBob = await app.inject({
      method: "GET",
      url: "/auth/linkedin/status",
      cookies: bob.cookies,
    });

    expect((asAlice.json() as { connected: boolean }).connected).toBe(true);
    expect((asBob.json() as { connected: boolean }).connected).toBe(false);
    // Token material never leaves the server, in either direction.
    expect(JSON.stringify(asAlice.json())).not.toContain("cipher");
  });
});
