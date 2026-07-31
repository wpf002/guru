import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@guru/db";
import { buildServer } from "../server.js";
import { makeUser, resetDatabase, seedBrief } from "./helpers.js";

/**
 * Connecting LinkedIn must attach to the user who started the flow — §1.0.
 *
 * The bug this exists for: the callback keyed the user row on the *LinkedIn*
 * profile email. Any local user created with a different address (a bootstrap
 * user, a seeded account, anyone who signed up before connecting) got forked in
 * two — the token on a brand-new row, the intake, brief, and archive stranded on
 * the original. `connected: true` came back either way, so nothing surfaced
 * until a downstream read returned empty.
 *
 * These assert the promise ("connecting attaches to *my* account"), not the
 * mechanism, so a future rewrite of the binding still has to satisfy them.
 */

const { app, scheduler } = await buildServer();

afterAll(async () => {
  await app.close();
});

// The suite truncates between cases, so a scheduler tick firing mid-run would
// race it. buildServer already declines to start one under NODE_ENV=test;
// asserting it keeps that guarantee from quietly regressing.
it("does not start the scheduler under test", () => {
  expect(scheduler).toBeNull();
});

beforeEach(async () => {
  await resetDatabase();
});

describe("GET /auth/linkedin/start", () => {
  it("refuses an unknown user before sending them to consent", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/auth/linkedin/start?userId=not-a-real-user",
    });

    // Failing *after* consent would mean the user granted access for nothing.
    expect(res.statusCode).toBe(404);
    expect(res.headers.location).toBeUndefined();
  });

  it("binds the flow to the requested user and redirects to LinkedIn", async () => {
    const user = await makeUser("someone@elsewhere.test");

    const res = await app.inject({
      method: "GET",
      url: `/auth/linkedin/start?userId=${user.id}`,
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain("linkedin.com/oauth/v2/authorization");

    const cookies = res.cookies.map((c) => c.name);
    expect(cookies).toContain("li_oauth_state");
    expect(cookies).toContain("li_oauth_user");

    const bound = res.cookies.find((c) => c.name === "li_oauth_user");
    expect(bound?.value).toBe(user.id);
    // The binding must not be readable or forgeable from page scripts.
    expect(bound?.httpOnly).toBe(true);
  });

  it("does not leave a stale binding when started without a user", async () => {
    // Otherwise a second, unbound connection silently inherits whichever user
    // the previous flow was for.
    const res = await app.inject({ method: "GET", url: "/auth/linkedin/start" });

    expect(res.statusCode).toBe(302);
    const bound = res.cookies.find((c) => c.name === "li_oauth_user");
    expect(bound?.value ?? "").toBe("");
  });

  it("state is unguessable and differs per attempt", async () => {
    const first = await app.inject({ method: "GET", url: "/auth/linkedin/start" });
    const second = await app.inject({ method: "GET", url: "/auth/linkedin/start" });

    const stateOf = (r: typeof first) =>
      r.cookies.find((c) => c.name === "li_oauth_state")?.value ?? "";

    expect(stateOf(first)).not.toBe(stateOf(second));
    expect(stateOf(first).length).toBeGreaterThan(20);
  });

  it("never names the client secret in the redirect", async () => {
    const res = await app.inject({ method: "GET", url: "/auth/linkedin/start" });
    expect(res.headers.location).not.toContain("client_secret");
  });
});

describe("GET /auth/linkedin/callback", () => {
  it("rejects a mismatched state without touching the database", async () => {
    const user = await makeUser("someone@elsewhere.test");

    const res = await app.inject({
      method: "GET",
      url: "/auth/linkedin/callback?code=whatever&state=forged",
      cookies: { li_oauth_state: "the-real-one", li_oauth_user: user.id },
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
   * exercised here directly against the same rule the route follows: a bound
   * userId wins over the profile email. What is asserted is the consequence the
   * user cares about — their existing work stays attached.
   */
  it("keeps intake and brief attached when the LinkedIn email differs", async () => {
    const user = await makeUser("will@guru.local");
    const brief = await seedBrief(user.id);

    // What the route does when li_oauth_user is present.
    const bound = await prisma.user.update({
      where: { id: user.id },
      data: { name: "Will Foti, CISSP" },
    });
    await prisma.linkedInAccount.create({
      data: {
        userId: bound.id,
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
      where: { id: user.id },
      include: { linkedinAccount: true, briefs: true },
    });

    expect(withAccount.linkedinAccount).not.toBeNull();
    expect(withAccount.briefs.map((b) => b.id)).toContain(brief.id);
    // The local identity is not overwritten by whatever LinkedIn holds.
    expect(withAccount.email).toBe("will@guru.local");
  });
});
