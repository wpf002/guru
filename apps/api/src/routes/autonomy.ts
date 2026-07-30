import type { FastifyInstance } from "fastify";
import { ConstraintViolationError } from "@guru/core";
import type { GuruLlm } from "@guru/llm";
import {
  autonomyLog,
  engageKillSwitch,
  releaseKillSwitch,
  runContentAutonomy,
  runEngagementAutonomy,
  settingsFor,
  updateSettings,
} from "../services/autonomy.js";
import {
  dismissProspect,
  draftOutreach,
  identifyProspects,
  markSent,
  prospectQueue,
} from "../services/prospecting.js";
import { audienceBreakdown, classifyAudience } from "../services/classification.js";
import {
  confirmAndIngestDrive,
  deleteDocument,
  ingestUploadedDocument,
  listDriveCandidates,
} from "../services/documents.js";
import type { Env } from "../env.js";

/** Phase 2 and Phase 3 routes, plus document ingestion (§1.9). */
export async function autonomyRoutes(app: FastifyInstance, env: Env, llm: GuruLlm) {
  // --- Autonomy settings and runs (§2.1, §2.2) ---

  app.get<{ Params: { userId: string } }>("/autonomy/:userId", async (request, reply) => {
    return reply.send(await settingsFor(request.params.userId));
  });

  app.patch<{ Params: { userId: string }; Body: Record<string, never> }>(
    "/autonomy/:userId",
    async (request, reply) => {
      return reply.send(await updateSettings(request.params.userId, request.body));
    },
  );

  /** Halts everything immediately, independent of scores and caps. */
  app.post<{ Params: { userId: string }; Body: { reason?: string } }>(
    "/autonomy/:userId/kill",
    async (request, reply) => {
      return reply.send(
        await engageKillSwitch(
          request.params.userId,
          request.body?.reason ?? "Stopped by the user.",
        ),
      );
    },
  );

  app.post<{ Params: { userId: string } }>(
    "/autonomy/:userId/resume",
    async (request, reply) => {
      return reply.send(await releaseKillSwitch(request.params.userId));
    },
  );

  app.post<{ Params: { userId: string } }>(
    "/autonomy/:userId/run-engagement",
    async (request, reply) => {
      return reply.send(await runEngagementAutonomy(env, request.params.userId));
    },
  );

  app.post<{ Params: { userId: string } }>(
    "/autonomy/:userId/run-content",
    async (request, reply) => {
      return reply.send(await runContentAutonomy(env, request.params.userId));
    },
  );

  /** The audit trail — blocked actions included, because those are the point. */
  app.get<{ Params: { userId: string } }>(
    "/autonomy/:userId/log",
    async (request, reply) => {
      return reply.send({ actions: await autonomyLog(request.params.userId) });
    },
  );

  // --- Prospecting and assisted outreach (§2.3, §2.4) ---

  app.post<{ Body: { userId: string; limit?: number; minFit?: number } }>(
    "/prospects/identify",
    async (request, reply) => {
      const { userId, ...options } = request.body;
      return reply.send({ prospects: await identifyProspects(userId, options) });
    },
  );

  app.get<{ Params: { userId: string } }>("/prospects/:userId", async (request, reply) => {
    return reply.send({ prospects: await prospectQueue(request.params.userId) });
  });

  /**
   * Returns the drafted message and a deep link. Nothing is sent — there is no
   * route in this application that sends a connection request or a DM, and
   * there should not be one (§0.4).
   */
  app.post<{ Params: { prospectId: string } }>(
    "/prospects/:prospectId/draft",
    async (request, reply) => {
      try {
        const assisted = await draftOutreach(llm, request.params.prospectId);
        return reply.send({
          ...assisted,
          note: "Copy the message, open the deep link, and send it yourself. Guru does not send outreach.",
        });
      } catch (err) {
        if (err instanceof ConstraintViolationError) {
          return reply
            .code(422)
            .send({ error: "Draft violated the brief.", violations: err.violations });
        }
        return reply.code(409).send({ error: (err as Error).message });
      }
    },
  );

  app.post<{ Params: { prospectId: string } }>(
    "/prospects/:prospectId/sent",
    async (request, reply) => reply.send(await markSent(request.params.prospectId)),
  );

  app.post<{ Params: { prospectId: string } }>(
    "/prospects/:prospectId/dismiss",
    async (request, reply) => reply.send(await dismissProspect(request.params.prospectId)),
  );

  // --- Phase 3 hedge (§5) ---

  app.post<{ Body: { userId: string; limit?: number } }>(
    "/audience/classify",
    async (request, reply) => {
      try {
        return reply.send(
          await classifyAudience(llm, request.body.userId, { limit: request.body.limit }),
        );
      } catch (err) {
        return reply.code(409).send({ error: (err as Error).message });
      }
    },
  );

  app.get<{ Params: { userId: string } }>("/audience/:userId", async (request, reply) => {
    return reply.send(await audienceBreakdown(request.params.userId));
  });

  // --- Documents (§1.9) ---

  app.get<{ Params: { userId: string } }>(
    "/documents/candidates/:userId",
    async (request, reply) => {
      if (!env.google) return reply.code(503).send({ error: "Google is not configured." });
      return reply.send({
        candidates: await listDriveCandidates(env.google, request.params.userId),
      });
    },
  );

  /** Per-document confirm. Nothing auto-ingests (§0.7). */
  app.post<{
    Body: { userId: string; externalId: string; taggedExcerpts?: string[] };
  }>("/documents/confirm", async (request, reply) => {
    if (!env.google) return reply.code(503).send({ error: "Google is not configured." });
    return reply.send(
      await confirmAndIngestDrive(
        llm,
        env.google,
        request.body.userId,
        request.body.externalId,
        request.body.taggedExcerpts ?? [],
      ),
    );
  });

  app.post<{
    Body: { userId: string; title: string; raw: string; taggedExcerpts?: string[] };
  }>("/documents/upload", async (request, reply) => {
    const { userId, ...options } = request.body;
    return reply.send(await ingestUploadedDocument(llm, userId, options));
  });

  /** Real deletion, not a flag. */
  app.delete<{ Params: { documentId: string } }>(
    "/documents/:documentId",
    async (request, reply) => {
      await deleteDocument(request.params.documentId);
      return reply.send({ deleted: true });
    },
  );
}
