import type { FastifyInstance } from "fastify";
import { prisma } from "@guru/db";
import { encryptToken, safeEqual } from "@guru/core";
import {
  LinkedInAuthError,
  authorizationUrl,
  exchangeCode,
  fetchProfile,
  generateState,
} from "@guru/linkedin";
import type { Env } from "../env.js";

/**
 * LinkedIn connection — roadmap §1.0.
 *
 * Three-legged OAuth, plus the one-click disconnect that deletes tokens and
 * halts processing. The trust-checkpoint screen lives in apps/web and is shown
 * *before* the redirect here — by the time this route runs, the user has already
 * been told in plain language what is accessed and why.
 */

const STATE_COOKIE = "li_oauth_state";
const STATE_TTL_SECONDS = 600;

export async function linkedinAuthRoutes(app: FastifyInstance, env: Env) {
  const linkedin = env.linkedin;

  /** Step 1 — redirect to LinkedIn's consent screen. */
  app.get("/auth/linkedin/start", async (request, reply) => {
    if (!linkedin) {
      return reply.code(503).send({
        error:
          "LinkedIn is not configured. Publishing is unavailable; everything else works. See docs/LINKEDIN-SETUP.md.",
      });
    }
    const state = generateState();

    reply.setCookie(STATE_COOKIE, state, {
      httpOnly: true,
      secure: env.nodeEnv === "production",
      sameSite: "lax",
      path: "/",
      maxAge: STATE_TTL_SECONDS,
    });

    return reply.redirect(authorizationUrl(linkedin, state));
  });

  /** Step 2 — the callback. */
  app.get<{ Querystring: { code?: string; state?: string; error?: string; error_description?: string } }>(
    "/auth/linkedin/callback",
    async (request, reply) => {
      if (!linkedin) return reply.code(503).send({ error: "LinkedIn is not configured." });

      const { code, state, error, error_description } = request.query;

      if (error) {
        // The user declining consent is a normal outcome, not an exception.
        request.log.info({ error }, "LinkedIn consent was declined");
        return reply.redirect(
          `${env.webOrigin}/connect?error=${encodeURIComponent(error_description ?? error)}`,
        );
      }

      const expectedState = request.cookies[STATE_COOKIE];
      if (!code || !state || !expectedState || !safeEqual(state, expectedState)) {
        return reply.redirect(`${env.webOrigin}/connect?error=invalid_state`);
      }
      reply.clearCookie(STATE_COOKIE, { path: "/" });

      try {
        const tokens = await exchangeCode(linkedin, code);
        const profile = await fetchProfile(tokens.accessToken);

        // Multi-tenant schema, single-tenant UX (§0.7): the user row is keyed on
        // email, and every downstream table hangs off its id.
        const user = await prisma.user.upsert({
          where: { email: profile.email ?? `${profile.sub}@linkedin.local` },
          update: { name: profile.name },
          create: { email: profile.email ?? `${profile.sub}@linkedin.local`, name: profile.name },
        });

        const tokenData = {
          linkedinSub: profile.sub,
          name: profile.name,
          email: profile.email,
          pictureUrl: profile.picture,
          accessTokenCipher: encryptToken(tokens.accessToken),
          refreshTokenCipher: tokens.refreshToken
            ? encryptToken(tokens.refreshToken)
            : null,
          accessTokenExpiresAt: tokens.expiresAt,
          refreshTokenExpiresAt: tokens.refreshTokenExpiresAt ?? null,
          // Recorded as granted, not as requested — LinkedIn can grant a subset.
          scopes: tokens.scope,
          refreshFailureCount: 0,
          disconnectedAt: null,
        };

        await prisma.linkedInAccount.upsert({
          where: { userId: user.id },
          update: tokenData,
          create: { userId: user.id, ...tokenData },
        });

        return reply.redirect(`${env.webOrigin}/connect/success`);
      } catch (err) {
        // The LinkedIn error body can echo the client_secret on some paths, so
        // only the status is logged.
        const status = err instanceof LinkedInAuthError ? err.status : undefined;
        request.log.error({ status }, "LinkedIn OAuth callback failed");
        return reply.redirect(`${env.webOrigin}/connect?error=connection_failed`);
      }
    },
  );

  /**
   * One-click disconnect (§1.0). Tokens are deleted, not flagged — a revoked
   * connection that leaves ciphertext in the database is not a disconnect.
   */
  app.post<{ Body: { userId: string } }>("/auth/linkedin/disconnect", async (request, reply) => {
    const { userId } = request.body;
    await prisma.linkedInAccount.deleteMany({ where: { userId } });
    return reply.send({ disconnected: true });
  });

  /** Connection status for the dashboard. Never returns token material. */
  app.get<{ Params: { userId: string } }>("/auth/linkedin/status/:userId", async (request, reply) => {
    const account = await prisma.linkedInAccount.findUnique({
      where: { userId: request.params.userId },
      select: {
        linkedinSub: true,
        name: true,
        scopes: true,
        connectedAt: true,
        accessTokenExpiresAt: true,
        refreshFailureCount: true,
      },
    });

    if (!account) return reply.send({ connected: false });

    return reply.send({
      connected: true,
      ...account,
      // Surfaced so the UI can prompt for re-auth before a scheduled post fails.
      needsReauth: account.refreshFailureCount > 0,
    });
  });
}
