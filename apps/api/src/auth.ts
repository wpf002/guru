import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "@guru/db";
import {
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  needsRehash,
  sessionExpiry,
  verifyPassword,
} from "@guru/core";

/**
 * Sessions and authorization.
 *
 * Multi-tenant schema, multi-tenant UX (§0.7). Before this, `userId` arrived in
 * a query string, a path parameter, or an `x-user-id` header, and every route
 * believed it — signing in as somebody else was a matter of typing their id.
 * There was also a fallback that resolved a missing header to the oldest user in
 * the database, which turned every unauthenticated request into a read of
 * whoever signed up first.
 *
 * Two rules replace all of that:
 *
 *   1. `requireUser` is the only way a route learns who is calling.
 *   2. Any route addressing a row by its own id must prove that row belongs to
 *      the caller, via `ownedBy`. A draft id is not a capability.
 */

export const SESSION_COOKIE = "guru_session";

export class UnauthorizedError extends Error {
  constructor(message = "Sign in to continue.") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "That does not belong to you.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

declare module "fastify" {
  interface FastifyRequest {
    /** Populated by the onRequest hook; null when the caller is anonymous. */
    authUserId: string | null;
  }
}

/**
 * Resolves the session cookie on every request.
 *
 * Runs as a hook rather than per-route so a route added later is anonymous by
 * default and has to opt in by calling `requireUser` — the opposite ordering
 * would make "forgot to add the check" the insecure case.
 */
export async function registerAuth(app: FastifyInstance): Promise<void> {
  app.decorateRequest("authUserId", null);

  app.addHook("onRequest", async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) return;
    request.authUserId = await resolveSession(token);
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof UnauthorizedError) {
      return reply.code(401).send({ error: error.message });
    }
    if (error instanceof ForbiddenError) {
      // Deliberately the same shape as a missing row: telling an attacker that
      // an id exists but is not theirs confirms the id.
      return reply.code(404).send({ error: "Not found." });
    }
    request.log.error({ err: error }, "unhandled route error");
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    const message = error instanceof Error ? error.message : "Request failed.";
    // Internal errors are not echoed back — the message can carry a query, a
    // file path, or a fragment of somebody else's row.
    return reply.code(status).send({ error: status >= 500 ? "Internal error." : message });
  });
}

/** The caller's id, or a 401. The only sanctioned source of a userId. */
export function requireUser(request: FastifyRequest): string {
  if (!request.authUserId) throw new UnauthorizedError();
  return request.authUserId;
}

/**
 * Asserts a row belongs to the caller.
 *
 * `row` is whatever was loaded; a missing row and someone else's row produce the
 * same error on purpose.
 */
export function ownedBy<T extends { userId: string }>(
  row: T | null | undefined,
  userId: string,
): T {
  if (!row || row.userId !== userId) throw new ForbiddenError();
  return row;
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

async function resolveSession(token: string): Promise<string | null> {
  const tokenHash = hashSessionToken(token);
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, expiresAt: true },
  });
  if (!session) return null;

  if (session.expiresAt.getTime() <= Date.now()) {
    // Delete rather than ignore: an expired row that lingers is a row that a
    // clock change could revive.
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  // Cheap enough per request, and it is what makes an abandoned session visible.
  await prisma.session
    .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
    .catch(() => {});

  return session.userId;
}

export async function createSession(
  userId: string,
  userAgent?: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const expiresAt = sessionExpiry(new Date());
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt,
      userAgent: userAgent?.slice(0, 256) ?? null,
    },
  });
  return { token, expiresAt };
}

export async function destroySession(token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
}

export function setSessionCookie(
  reply: FastifyReply,
  token: string,
  expiresAt: Date,
  secure: boolean,
): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    // Lax rather than Strict: the LinkedIn OAuth callback is a cross-site
    // top-level navigation back into the app, and Strict would drop the session
    // exactly there.
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

export class EmailInUseError extends Error {
  constructor() {
    super("An account with that email already exists.");
    this.name = "EmailInUseError";
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function registerUser(
  email: string,
  password: string,
  name?: string,
): Promise<{ id: string }> {
  const normalized = normalizeEmail(email);
  // hashPassword enforces the length rule, so a weak password never reaches the
  // uniqueness check and cannot be used to probe which emails are taken.
  const passwordHash = await hashPassword(password);

  const existing = await prisma.user.findUnique({
    where: { email: normalized },
    select: { id: true, passwordHash: true },
  });

  if (existing?.passwordHash) throw new EmailInUseError();

  // A user row created by the local bootstrap path has no password yet. Claiming
  // it is how an existing single-user install becomes a real account without
  // orphaning its archive, brief and drafts.
  if (existing) {
    return prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash, ...(name ? { name } : {}) },
      select: { id: true },
    });
  }

  return prisma.user.create({
    data: { email: normalized, name: name ?? null, passwordHash },
    select: { id: true },
  });
}

/**
 * Verifies credentials in roughly constant time.
 *
 * When the email is unknown we still run a hash, otherwise the response time
 * distinguishes "no such account" from "wrong password" and the login endpoint
 * becomes a way to enumerate users.
 */
const DUMMY_HASH_PROMISE = hashPassword("verify-against-this-when-no-user-exists");

export async function authenticate(email: string, password: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { email: normalizeEmail(email) },
    select: { id: true, passwordHash: true },
  });

  if (!user?.passwordHash) {
    await verifyPassword(password, await DUMMY_HASH_PROMISE);
    return null;
  }

  if (!(await verifyPassword(password, user.passwordHash))) return null;

  if (needsRehash(user.passwordHash)) {
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(password) },
    });
  }

  return user.id;
}
