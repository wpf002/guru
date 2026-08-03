import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@guru/db";
import { buildServer } from "../server.js";
import { resetDatabase, seedArchive, seedBrief, seedRoadmap } from "./helpers.js";

/**
 * Multi-user access — the front door.
 *
 * The schema was always multi-tenant, but nothing authenticated anyone: `userId`
 * arrived in a path, a body, or an `x-guru-user` header and every route believed
 * it, and a missing header resolved to the oldest row in the database. Signing
 * in as somebody else was a matter of typing their id.
 *
 * These assert the promise a user cares about — "my data is mine" — rather than
 * the mechanism, so a later rewrite of the session layer still has to satisfy
 * them.
 */

const { app } = await buildServer();

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDatabase();
});

const PASSWORD = "correct horse battery staple";

async function signUp(email: string) {
  const res = await app.inject({
    method: "POST",
    url: "/auth/signup",
    payload: { email, password: PASSWORD, name: email.split("@")[0] },
  });
  expect(res.statusCode).toBe(201);
  const cookie = res.cookies.find((c) => c.name === "guru_session")!;
  return {
    userId: (res.json() as { user: { id: string } }).user.id,
    cookies: { guru_session: cookie.value },
  };
}

describe("signup", () => {
  it("creates an account and signs it in", async () => {
    const { userId, cookies } = await signUp("first@example.test");
    const me = await app.inject({ method: "GET", url: "/auth/me", cookies });
    expect(me.statusCode).toBe(200);
    expect((me.json() as { user: { id: string } }).user.id).toBe(userId);
  });

  it("never returns the password hash", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: "hash@example.test", password: PASSWORD },
    });
    expect(JSON.stringify(res.json())).not.toContain("scrypt");
    expect(res.json()).not.toHaveProperty("user.passwordHash");
  });

  it("stores the password hashed, never in plaintext", async () => {
    await signUp("stored@example.test");
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: "stored@example.test" },
      select: { passwordHash: true },
    });
    expect(user.passwordHash).not.toBe(PASSWORD);
    expect(user.passwordHash).toMatch(/^scrypt\$/);
  });

  it("rejects a weak password before creating anything", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: "weak@example.test", password: "short" },
    });
    expect(res.statusCode).toBe(400);
    expect(await prisma.user.count()).toBe(0);
  });

  it("rejects a second signup for the same email", async () => {
    await signUp("dupe@example.test");
    const res = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: "dupe@example.test", password: PASSWORD },
    });
    expect(res.statusCode).toBe(409);
  });

  it("treats email as case-insensitive", async () => {
    await signUp("Mixed@Example.test");
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "mixed@example.TEST", password: PASSWORD },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("login", () => {
  it("gives the same answer for a wrong password and an unknown account", async () => {
    // Different messages here turn the login endpoint into a way to find out
    // which addresses have accounts.
    await signUp("real@example.test");

    const wrongPassword = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "real@example.test", password: "not the password at all" },
    });
    const noSuchUser = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "ghost@example.test", password: PASSWORD },
    });

    expect(wrongPassword.statusCode).toBe(401);
    expect(noSuchUser.statusCode).toBe(401);
    expect(wrongPassword.json()).toEqual(noSuchUser.json());
  });
});

describe("logout", () => {
  it("revokes the session server-side, not just the cookie", async () => {
    // Clearing the cookie alone leaves a token that still works if it was
    // captured — that is not a logout.
    const { cookies } = await signUp("bye@example.test");
    expect((await app.inject({ method: "GET", url: "/auth/me", cookies })).statusCode).toBe(200);

    await app.inject({ method: "POST", url: "/auth/logout", cookies });

    const after = await app.inject({ method: "GET", url: "/auth/me", cookies });
    expect(after.statusCode).toBe(401);
    expect(await prisma.session.count()).toBe(0);
  });

  it("logout-all revokes every session for that user only", async () => {
    const a1 = await signUp("multi@example.test");
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "multi@example.test", password: PASSWORD },
    });
    const second = { guru_session: login.cookies.find((c) => c.name === "guru_session")!.value };
    const other = await signUp("bystander@example.test");

    await app.inject({ method: "POST", url: "/auth/logout-all", cookies: a1.cookies });

    expect((await app.inject({ method: "GET", url: "/auth/me", cookies: a1.cookies })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/auth/me", cookies: second })).statusCode).toBe(401);
    // The other account is untouched.
    expect((await app.inject({ method: "GET", url: "/auth/me", cookies: other.cookies })).statusCode).toBe(200);
  });
});

describe("anonymous requests", () => {
  it("are rejected rather than resolving to whoever signed up first", async () => {
    // The old fallback returned the oldest user in the database for any request
    // without a header, which made every unauthenticated read a cross-tenant
    // read the moment a second account existed.
    const { userId } = await signUp("owner@example.test");
    await seedBrief(userId);

    for (const url of [
      "/brief",
      "/confidence",
      "/metrics",
      "/roadmap",
      "/content",
      "/archive/status",
      "/autonomy",
      "/prospects",
      "/engagement/queue",
    ]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, `${url} must require a session`).toBe(401);
    }
  });

  it("cannot upload an archive", async () => {
    const res = await app.inject({ method: "POST", url: "/archive/upload" });
    expect(res.statusCode).toBe(401);
  });

  it("a forged session cookie does not authenticate", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/auth/me",
      cookies: { guru_session: "made-up-token" },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("one user cannot reach another user's data", () => {
  it("reads only its own brief", async () => {
    const alice = await signUp("alice@example.test");
    const bob = await signUp("bob@example.test");

    await seedBrief(alice.userId, { niche: "Cold-chain logistics" });
    await seedBrief(bob.userId, { niche: "Detection engineering" });

    const asAlice = await app.inject({ method: "GET", url: "/brief", cookies: alice.cookies });
    const asBob = await app.inject({ method: "GET", url: "/brief", cookies: bob.cookies });

    expect((asAlice.json() as { niche: string }).niche).toBe("Cold-chain logistics");
    expect((asBob.json() as { niche: string }).niche).toBe("Detection engineering");
  });

  it("cannot edit another user's brief by id", async () => {
    const alice = await signUp("alice2@example.test");
    const bob = await signUp("bob2@example.test");
    const brief = await seedBrief(alice.userId, { niche: "Cold-chain logistics" });

    const res = await app.inject({
      method: "PATCH",
      url: `/brief/id/${brief.id}`,
      cookies: bob.cookies,
      payload: { niche: "Something Bob prefers" },
    });

    expect(res.statusCode).toBe(404);
    const unchanged = await prisma.strategicBrief.findUniqueOrThrow({ where: { id: brief.id } });
    expect(unchanged.niche).toBe("Cold-chain logistics");
  });

  it("cannot read another user's intake session by id", async () => {
    const alice = await signUp("alice3@example.test");
    const bob = await signUp("bob3@example.test");

    const started = await app.inject({
      method: "POST",
      url: "/intake/start",
      cookies: alice.cookies,
    });
    const sessionId = (started.json() as { sessionId: string }).sessionId;

    const res = await app.inject({
      method: "GET",
      url: `/intake/${sessionId}`,
      cookies: bob.cookies,
    });
    expect(res.statusCode).toBe(404);
  });

  it("cannot answer another user's intake session", async () => {
    const alice = await signUp("alice4@example.test");
    const bob = await signUp("bob4@example.test");

    const started = await app.inject({
      method: "POST",
      url: "/intake/start",
      cookies: alice.cookies,
    });
    const sessionId = (started.json() as { sessionId: string }).sessionId;

    const res = await app.inject({
      method: "POST",
      url: `/intake/${sessionId}/answer`,
      cookies: bob.cookies,
      payload: { message: "an answer Bob should not be able to give" },
    });

    expect(res.statusCode).toBe(404);
    expect(await prisma.intakeTurn.count()).toBe(0);
  });

  it("cannot edit, schedule, publish or approve another user's draft", async () => {
    const alice = await signUp("alice5@example.test");
    const bob = await signUp("bob5@example.test");

    const brief = await seedBrief(alice.userId);
    const roadmap = await seedRoadmap(alice.userId, brief.id);
    const draft = await prisma.contentDraft.create({
      data: {
        userId: alice.userId,
        roadmapElementId: roadmap.elements[0]!.id,
        content: "Alice's post.",
        format: "short post",
        whyThis: "because",
      },
    });

    const attempts = [
      app.inject({
        method: "PATCH",
        url: `/content/${draft.id}`,
        cookies: bob.cookies,
        payload: { content: "Bob rewrote this." },
      }),
      app.inject({
        method: "POST",
        url: `/content/${draft.id}/schedule`,
        cookies: bob.cookies,
        payload: { scheduledFor: new Date(Date.now() + 86_400_000).toISOString() },
      }),
      app.inject({ method: "POST", url: `/content/${draft.id}/publish`, cookies: bob.cookies }),
      app.inject({ method: "GET", url: `/content/${draft.id}/review`, cookies: bob.cookies }),
      app.inject({
        method: "POST",
        url: "/decisions",
        cookies: bob.cookies,
        payload: { type: "APPROVED", category: "CONTENT", contentDraftId: draft.id },
      }),
    ];

    for (const res of await Promise.all(attempts)) {
      expect(res.statusCode).toBe(404);
    }

    const after = await prisma.contentDraft.findUniqueOrThrow({ where: { id: draft.id } });
    expect(after.content).toBe("Alice's post.");
    expect(after.status).not.toBe("SCHEDULED");
    expect(await prisma.decision.count()).toBe(0);
  });

  it("cannot delete another user's document", async () => {
    // §0.7 promises real deletion of documents. It must be the owner doing it.
    const alice = await signUp("alice6@example.test");
    const bob = await signUp("bob6@example.test");

    const doc = await prisma.sourceDocument.create({
      data: {
        userId: alice.userId,
        source: "UPLOAD",
        title: "Private notes",
        summary: "A summary.",
        confirmedAt: new Date(),
      },
    });

    const res = await app.inject({
      method: "DELETE",
      url: `/documents/${doc.id}`,
      cookies: bob.cookies,
    });

    expect(res.statusCode).toBe(404);
    expect(await prisma.sourceDocument.count({ where: { id: doc.id } })).toBe(1);
  });

  it("cannot disconnect another user's LinkedIn account", async () => {
    const alice = await signUp("alice7@example.test");
    const bob = await signUp("bob7@example.test");

    await prisma.linkedInAccount.create({
      data: {
        userId: alice.userId,
        linkedinSub: "sub-alice",
        accessTokenCipher: "cipher",
        accessTokenExpiresAt: new Date(Date.now() + 86_400_000),
        scopes: "openid",
      },
    });

    // The route no longer takes a userId at all, so Bob's call can only ever
    // disconnect Bob — who has nothing connected.
    const res = await app.inject({
      method: "POST",
      url: "/auth/linkedin/disconnect",
      cookies: bob.cookies,
      payload: { userId: alice.userId },
    });

    expect(res.statusCode).toBe(200);
    expect(await prisma.linkedInAccount.count({ where: { userId: alice.userId } })).toBe(1);
  });

  it("sees only its own archive snapshots", async () => {
    const alice = await signUp("alice8@example.test");
    const bob = await signUp("bob8@example.test");
    await seedArchive(alice.userId, { connections: 3 });

    const asBob = await app.inject({
      method: "GET",
      url: "/archive/status",
      cookies: bob.cookies,
    });
    expect((asBob.json() as { snapshots: unknown[] }).snapshots).toHaveLength(0);

    const asAlice = await app.inject({
      method: "GET",
      url: "/archive/status",
      cookies: alice.cookies,
    });
    expect((asAlice.json() as { snapshots: unknown[] }).snapshots).toHaveLength(1);
  });

  it("has no endpoint that lists other accounts", async () => {
    // /bootstrap/users returned every user's email. Harmless with one account,
    // an enumeration endpoint with two.
    const alice = await signUp("alice9@example.test");
    await signUp("bob9@example.test");

    const res = await app.inject({
      method: "GET",
      url: "/bootstrap/users",
      cookies: alice.cookies,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("claiming a pre-auth account", () => {
  it("attaches a password to an existing passwordless user rather than forking it", async () => {
    // Single-user installs predate signup: their archive, brief and drafts hang
    // off a user row with no password. Signing up with that email has to adopt
    // the row, not create a second one.
    const legacy = await prisma.user.create({
      data: { email: "legacy@example.test", name: "Legacy" },
    });
    const brief = await seedBrief(legacy.id, { niche: "Cold-chain logistics" });

    const res = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: "legacy@example.test", password: PASSWORD },
    });

    expect(res.statusCode).toBe(201);
    expect((res.json() as { user: { id: string } }).user.id).toBe(legacy.id);
    expect(await prisma.user.count()).toBe(1);

    const cookies = {
      guru_session: res.cookies.find((c) => c.name === "guru_session")!.value,
    };
    const briefRes = await app.inject({ method: "GET", url: "/brief", cookies });
    expect((briefRes.json() as { id: string }).id).toBe(brief.id);
  });
});
