import type { FastifyInstance } from "fastify";
import { prisma } from "@guru/db";
import { MIN_PASSWORD_LENGTH, WeakPasswordError } from "@guru/core";
import {
  EmailInUseError,
  SESSION_COOKIE,
  authenticate,
  clearSessionCookie,
  createSession,
  destroySession,
  registerUser,
  requireUser,
  setSessionCookie,
} from "../auth.js";
import type { Env } from "../env.js";

/**
 * Sign up, sign in, sign out.
 *
 * Email and password rather than "sign in with LinkedIn": LinkedIn is optional
 * by design here — the archive is a ZIP upload and everything through §1.5 runs
 * without the API — so making it the only way in would turn an optional
 * integration into a hard prerequisite.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function authRoutes(app: FastifyInstance, env: Env) {
  const secureCookies = env.nodeEnv === "production";

  app.post<{ Body: { email?: string; password?: string; name?: string } }>(
    "/auth/signup",
    async (request, reply) => {
      const { email, password, name } = request.body ?? {};

      if (!email || !EMAIL_PATTERN.test(email.trim())) {
        return reply.code(400).send({ error: "Enter a valid email address." });
      }
      if (!password) {
        return reply
          .code(400)
          .send({ error: `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.` });
      }

      try {
        const user = await registerUser(email, password, name);
        const { token, expiresAt } = await createSession(user.id, request.headers["user-agent"]);
        setSessionCookie(reply, token, expiresAt, secureCookies);
        return reply.code(201).send({ user: await publicUser(user.id) });
      } catch (err) {
        if (err instanceof WeakPasswordError) {
          return reply.code(400).send({ error: err.message });
        }
        if (err instanceof EmailInUseError) {
          // Signup necessarily reveals that an email is taken — there is no way
          // to create an account without it. Login does not, which is where it
          // matters.
          return reply.code(409).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.post<{ Body: { email?: string; password?: string } }>(
    "/auth/login",
    async (request, reply) => {
      const { email, password } = request.body ?? {};
      if (!email || !password) {
        return reply.code(400).send({ error: "Email and password are required." });
      }

      const userId = await authenticate(email, password);
      if (!userId) {
        // One message for both "no such account" and "wrong password".
        return reply.code(401).send({ error: "Email or password is incorrect." });
      }

      const { token, expiresAt } = await createSession(userId, request.headers["user-agent"]);
      setSessionCookie(reply, token, expiresAt, secureCookies);
      return reply.send({ user: await publicUser(userId) });
    },
  );

  app.post("/auth/logout", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    // Delete the row, not just the cookie. A session that still resolves after
    // "sign out" is not signed out.
    if (token) await destroySession(token);
    clearSessionCookie(reply);
    return reply.send({ ok: true });
  });

  /** Who am I — the web app's check for whether to show the sign-in page. */
  app.get("/auth/me", async (request, reply) => {
    if (!request.authUserId) return reply.code(401).send({ error: "Not signed in." });
    return reply.send({ user: await publicUser(request.authUserId) });
  });

  /** Sign out everywhere — the recovery path when a session may be compromised. */
  app.post("/auth/logout-all", async (request, reply) => {
    const userId = requireUser(request);
    const { count } = await prisma.session.deleteMany({ where: { userId } });
    clearSessionCookie(reply);
    return reply.send({ ok: true, sessionsRevoked: count });
  });
}

/** Never returns passwordHash. Selected explicitly rather than deleted after. */
async function publicUser(userId: string) {
  return prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      createdAt: true,
      linkedinAccount: { select: { name: true, scopes: true, connectedAt: true } },
    },
  });
}
