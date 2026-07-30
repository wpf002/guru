import type { FastifyInstance } from "fastify";
import { prisma } from "@guru/db";
import { encryptToken, generateStateToken, safeEqual } from "@guru/core";
import {
  exchangeGoogleCode,
  googleAuthorizationUrl,
  type GoogleConfig,
} from "../services/google.js";
import { ingestUpload, pollAndIngest, snapshotDelta } from "../services/archive-ingest.js";
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

      try {
        const tokens = await exchangeGoogleCode(google, code);
        const userId = await currentUserId(request.headers["x-guru-user"]);

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
  app.post<{ Body: { userId: string } }>("/archive/poll", async (request, reply) => {
    if (!google) return reply.code(503).send({ error: "Google is not configured." });
    const results = await pollAndIngest(google, request.body.userId);
    return reply.send({ results });
  });

  /** Manual upload — the fallback, and where the semi-automatic path lands. */
  app.post("/archive/upload", async (request, reply) => {
    const file = await request.file({ limits: { fileSize: MAX_UPLOAD_BYTES } });
    if (!file) return reply.code(400).send({ error: "No file was uploaded." });

    const userId = String(
      (file.fields.userId as { value?: string } | undefined)?.value ?? "",
    );
    if (!userId) return reply.code(400).send({ error: "userId is required." });

    const buffer = await file.toBuffer();
    const result = await ingestUpload(userId, buffer);
    return reply.send(result);
  });

  app.get<{ Params: { userId: string } }>(
    "/archive/status/:userId",
    async (request, reply) => {
      const snapshots = await prisma.archiveSnapshot.findMany({
        where: { userId: request.params.userId },
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
    },
  );

  /** Growth and churn between the two most recent snapshots (§9). */
  app.get<{ Params: { userId: string } }>(
    "/archive/delta/:userId",
    async (request, reply) => {
      const delta = await snapshotDelta(request.params.userId);
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
    },
  );
}

/**
 * Single-tenant UX over a multi-tenant schema (§0.7): the header is the seam
 * where real session auth will attach, and it exists now so no route has to be
 * rewritten to add it.
 */
async function currentUserId(header: string | string[] | undefined): Promise<string> {
  const id = Array.isArray(header) ? header[0] : header;
  if (id) return id;

  const only = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  if (!only) throw new Error("No user exists yet — connect LinkedIn first.");
  return only.id;
}
