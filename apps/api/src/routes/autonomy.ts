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
import { ownedBy, requireUser } from "../auth.js";
import { prisma } from "@guru/db";
import type { Env } from "../env.js";

/** Phase 2 and Phase 3 routes, plus document ingestion (§1.9). */
export async function autonomyRoutes(app: FastifyInstance, env: Env, llm: GuruLlm) {
  // --- Autonomy settings and runs (§2.1, §2.2) ---

  app.get("/autonomy", async (request, reply) => {
    return reply.send(await settingsFor(requireUser(request)));
  });

  app.patch<{ Body: Record<string, never> }>("/autonomy", async (request, reply) => {
    return reply.send(await updateSettings(requireUser(request), request.body));
  });

  /** Halts everything immediately, independent of scores and caps. */
  app.post<{ Body: { reason?: string } }>("/autonomy/kill", async (request, reply) => {
    return reply.send(
      await engageKillSwitch(
        requireUser(request),
        request.body?.reason ?? "Stopped by the user.",
      ),
    );
  });

  app.post("/autonomy/resume", async (request, reply) => {
    return reply.send(await releaseKillSwitch(requireUser(request)));
  });

  app.post("/autonomy/run-engagement", async (request, reply) => {
    return reply.send(await runEngagementAutonomy(env, requireUser(request)));
  });

  app.post("/autonomy/run-content", async (request, reply) => {
    return reply.send(await runContentAutonomy(env, requireUser(request)));
  });

  /** The audit trail — blocked actions included, because those are the point. */
  app.get("/autonomy/log", async (request, reply) => {
    return reply.send({ actions: await autonomyLog(requireUser(request)) });
  });

  // --- Prospecting and assisted outreach (§2.3, §2.4) ---

  app.post<{ Body: { limit?: number; minFit?: number } }>(
    "/prospects/identify",
    async (request, reply) => {
      const prospects = await identifyProspects(requireUser(request), request.body ?? {});
      return reply.send({ prospects });
    },
  );

  app.get("/prospects", async (request, reply) => {
    return reply.send({ prospects: await prospectQueue(requireUser(request)) });
  });

  /**
   * Returns the drafted message and a deep link. Nothing is sent — there is no
   * route in this application that sends a connection request or a DM, and
   * there should not be one (§0.4).
   */
  app.post<{ Params: { prospectId: string } }>(
    "/prospects/:prospectId/draft",
    async (request, reply) => {
      await assertOwnsProspect(request.params.prospectId, requireUser(request));
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
    async (request, reply) => {
      await assertOwnsProspect(request.params.prospectId, requireUser(request));
      return reply.send(await markSent(request.params.prospectId));
    },
  );

  app.post<{ Params: { prospectId: string } }>(
    "/prospects/:prospectId/dismiss",
    async (request, reply) => {
      await assertOwnsProspect(request.params.prospectId, requireUser(request));
      return reply.send(await dismissProspect(request.params.prospectId));
    },
  );

  // --- Phase 3 hedge (§5) ---

  app.post<{ Body: { limit?: number } }>(
    "/audience/classify",
    async (request, reply) => {
      try {
        return reply.send(
          await classifyAudience(llm, requireUser(request), { limit: request.body?.limit }),
        );
      } catch (err) {
        return reply.code(409).send({ error: (err as Error).message });
      }
    },
  );

  app.get("/audience", async (request, reply) => {
    return reply.send(await audienceBreakdown(requireUser(request)));
  });

  // --- Documents (§1.9) ---

  app.get("/documents/candidates", async (request, reply) => {
    if (!env.google) return reply.code(503).send({ error: "Google is not configured." });
    return reply.send({
      candidates: await listDriveCandidates(env.google, requireUser(request)),
    });
  });

  /** Per-document confirm. Nothing auto-ingests (§0.7). */
  app.post<{
    Body: { externalId: string; taggedExcerpts?: string[] };
  }>("/documents/confirm", async (request, reply) => {
    if (!env.google) return reply.code(503).send({ error: "Google is not configured." });
    return reply.send(
      await confirmAndIngestDrive(
        llm,
        env.google,
        requireUser(request),
        request.body.externalId,
        request.body.taggedExcerpts ?? [],
      ),
    );
  });

  app.post<{
    Body: { title: string; raw: string; taggedExcerpts?: string[] };
  }>("/documents/upload", async (request, reply) => {
    return reply.send(await ingestUploadedDocument(llm, requireUser(request), request.body));
  });

  /** Real deletion, not a flag. */
  app.delete<{ Params: { documentId: string } }>(
    "/documents/:documentId",
    async (request, reply) => {
      const userId = requireUser(request);
      const doc = await prisma.sourceDocument.findUnique({
        where: { id: request.params.documentId },
        select: { id: true, userId: true },
      });
      ownedBy(doc, userId);
      await deleteDocument(request.params.documentId);
      return reply.send({ deleted: true });
    },
  );
}

async function assertOwnsProspect(prospectId: string, userId: string): Promise<void> {
  const prospect = await prisma.prospectTarget.findUnique({
    where: { id: prospectId },
    select: { id: true, userId: true },
  });
  ownedBy(prospect, userId);
}
