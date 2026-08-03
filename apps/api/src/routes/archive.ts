import type { FastifyInstance } from "fastify";
import { prisma } from "@guru/db";
import { encryptToken, generateStateToken, safeEqual } from "@guru/core";
import {
  exchangeGoogleCode,
  googleAuthorizationUrl,
  type GoogleConfig,
} from "../services/google.js";
import { ingestUpload, pollAndIngest, snapshotDelta } from "../services/archive-ingest.js";
import { requireUser } from "../auth.js";
import type { Env } from "../env.js";

/**
 * Archive ingestion routes — roadmap §1.1.
 *
 * The Google connection is optional by design: declining it costs the user a
 * manual download, not the feature. Both paths land in the same ingest code.
 */

const STATE_COOKIE = "g_oauth_state";
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

export async function archiveRoutes(app: FastifyInstance, env: Env) {
  const google: GoogleConfig | null = env.google;

  app.get("/auth/google/start", async (request, reply) => {
    if (!google) {
      return reply.code(503).send({ error: "Google is not configured on this deployment." });
    }
    const state = generateStateToken();
    reply.setCookie(STATE_COOKIE, state, {
      httpOnly: true,
      secure: env.nodeEnv === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });
    return reply.redirect(googleAuthorizationUrl(google, state));
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/auth/google/callback",
    async (request, reply) => {
      if (!google) return reply.code(503).send({ error: "Google is not configured." });

      const { code, state, error } = request.query;
      if (error) return reply.redirect(`${env.webOrigin}/archive?error=declined`);

      const expected = request.cookies[STATE_COOKIE];
      if (!code || !state || !expected || !safeEqual(state, expected)) {
        return reply.redirect(`${env.webOrigin}/archive?error=invalid_state`);
      }
      reply.clearCookie(STATE_COOKIE, { path: "/" });

      // Resolved before the try. Inside it, the catch redirects to
      // "connection_failed", which would tell a signed-out user that Google
      // refused them when in fact their session had simply expired mid-flow.
      // SameSite=Lax keeps the session cookie across Google's redirect back, so
      // this only fires when the session is genuinely gone.
      const userId = request.authUserId;
      if (!userId) {
        return reply.redirect(`${env.webOrigin}/archive?error=signed_out`);
      }

      try {
        const tokens = await exchangeGoogleCode(google, code);

        await prisma.googleAccount.upsert({
          where: { userId },
          update: {
            accessTokenCipher: encryptToken(tokens.accessToken),
            refreshTokenCipher: tokens.refreshToken
              ? encryptToken(tokens.refreshToken)
              : undefined,
            accessTokenExpiresAt: tokens.expiresAt,
            scopes: tokens.scope,
            gmailWatchEnabled: true,
            disconnectedAt: null,
          },
          create: {
            userId,
            googleSub: `${userId}:google`,
            accessTokenCipher: encryptToken(tokens.accessToken),
            refreshTokenCipher: tokens.refreshToken
              ? encryptToken(tokens.refreshToken)
              : null,
            accessTokenExpiresAt: tokens.expiresAt,
            scopes: tokens.scope,
            gmailWatchEnabled: true,
          },
        });

        return reply.redirect(`${env.webOrigin}/archive?connected=1`);
      } catch (err) {
        request.log.error({ err: (err as Error).message }, "Google OAuth callback failed");
        return reply.redirect(`${env.webOrigin}/archive?error=connection_failed`);
      }
    },
  );

  /**
   * Poll for archive emails. Safe to call on a schedule and safe to call twice —
   * already-ingested message ids are filtered before anything downloads.
   */
  app.post("/archive/poll", async (request, reply) => {
    // Auth before configuration: answering 503 first tells an anonymous caller
    // whether this deployment has Google set up.
    const userId = requireUser(request);
    if (!google) return reply.code(503).send({ error: "Google is not configured." });
    const results = await pollAndIngest(google, userId);
    return reply.send({ results });
  });

  /** Manual upload — the fallback, and where the semi-automatic path lands. */
  app.post("/archive/upload", async (request, reply) => {
    // Authenticate before touching the body. Parsing first would let an
    // anonymous caller stream half a gigabyte into the process before being
    // told no — and it returns multipart's 406 instead of a 401, which reads
    // like a content-type problem rather than a missing session.
    //
    // The id comes from the session, never from a multipart field: an archive is
    // the most sensitive upload in the product and must land on the uploader.
    const userId = requireUser(request);

    const file = await request.file({ limits: { fileSize: MAX_UPLOAD_BYTES } });
    if (!file) return reply.code(400).send({ error: "No file was uploaded." });

    const buffer = await file.toBuffer();
    const result = await ingestUpload(userId, buffer);
    return reply.send(result);
  });

  app.get("/archive/status", async (request, reply) => {
    const snapshots = await prisma.archiveSnapshot.findMany({
      where: { userId: requireUser(request) },
      orderBy: { requestedAt: "desc" },
      take: 10,
      select: {
        id: true,
        source: true,
        status: true,
        requestedAt: true,
        completedAt: true,
        fileReport: true,
        error: true,
      },
    });
    return reply.send({ snapshots });
  });

  /** Growth and churn between the two most recent snapshots (§9). */
  app.get("/archive/delta", async (request, reply) => {
      const delta = await snapshotDelta(requireUser(request));
      if (!delta) return reply.send({ delta: null });
      return reply.send({
        delta: {
          from: delta.from,
          to: delta.to,
          added: delta.added.length,
          removed: delta.removed.length,
          retained: delta.retained,
          netGrowth: delta.netGrowth,
          newConnectionFitRatio: delta.newConnectionFitRatio,
        },
      });
  });
}
