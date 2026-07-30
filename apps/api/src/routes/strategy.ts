import type { FastifyInstance } from "fastify";
import { prisma } from "@guru/db";
import { ConstraintViolationError, SimilarityError } from "@guru/core";
import type { GuruLlm } from "@guru/llm";
import { networkPicture, scorePersonaFit, setPeers } from "../services/analysis.js";
import { activeRoadmap, generateRoadmap } from "../services/roadmap.js";
import {
  applyUserEdit,
  generateDraft,
  publishDraft,
  publishDueDrafts,
  refineDraft,
  reviewDraft,
  scheduleDraft,
} from "../services/content.js";
import { ReauthRequiredError } from "../services/linkedin-session.js";
import type { Env } from "../env.js";

/** Analysis, roadmap, and content routes — roadmap §1.4 and §1.5. */
export async function strategyRoutes(app: FastifyInstance, env: Env, llm: GuruLlm) {
  // --- Analysis (§1.4) ---

  app.post<{ Body: { userId: string; peers: { name: string; linkedinUrl?: string }[] } }>(
    "/peers",
    async (request, reply) => {
      return reply.send({ peers: await setPeers(request.body.userId, request.body.peers) });
    },
  );

  /**
   * Resumable by design — a 10,000-connection network is scored across several
   * calls, and the response says how many are left.
   */
  app.post<{ Body: { userId: string; limit?: number } }>(
    "/analysis/persona-fit",
    async (request, reply) => {
      const result = await scorePersonaFit(llm, request.body.userId, {
        limit: request.body.limit,
      });
      return reply.send(result);
    },
  );

  app.get<{ Params: { userId: string } }>(
    "/analysis/network/:userId",
    async (request, reply) => {
      return reply.send(await networkPicture(request.params.userId));
    },
  );

  // --- Roadmap (§1.4) ---

  app.post<{ Body: { userId: string } }>("/roadmap", async (request, reply) => {
    try {
      return reply.send(await generateRoadmap(llm, request.body.userId, env.intel));
    } catch (err) {
      return reply.code(409).send({ error: (err as Error).message });
    }
  });

  app.get<{ Params: { userId: string } }>("/roadmap/:userId", async (request, reply) => {
    const roadmap = await activeRoadmap(request.params.userId);
    if (!roadmap) return reply.code(404).send({ error: "No roadmap yet." });
    return reply.send(roadmap);
  });

  // --- Content (§1.5) ---

  /**
   * A draft cannot exist without a roadmap element. That is the whole mechanism
   * behind "strategy before content" — there is deliberately no route that
   * generates a post from a free-text topic.
   */
  app.post<{ Body: { userId: string; roadmapElementId: string } }>(
    "/content/draft",
    async (request, reply) => {
      try {
        const draft = await generateDraft(
          llm,
          request.body.userId,
          request.body.roadmapElementId,
        );
        return reply.send(draft);
      } catch (err) {
        // Both of these are the gates doing their job, so they get a specific
        // status and a usable message rather than a 500.
        if (err instanceof ConstraintViolationError) {
          return reply.code(422).send({
            error: "Generated draft violated the brief's constraints.",
            violations: err.violations,
          });
        }
        if (err instanceof SimilarityError) {
          return reply.code(422).send({
            error: "Generated draft was too close to peer source material.",
            match: err.match,
          });
        }
        throw err;
      }
    },
  );

  app.get<{ Params: { userId: string }; Querystring: { status?: string } }>(
    "/content/:userId",
    async (request, reply) => {
      const drafts = await prisma.contentDraft.findMany({
        where: {
          userId: request.params.userId,
          ...(request.query.status ? { status: request.query.status as never } : {}),
        },
        orderBy: { createdAt: "desc" },
        include: {
          roadmapElement: { select: { title: true, phase: true, rationale: true } },
          revisions: { orderBy: { index: "asc" } },
        },
        take: 50,
      });
      return reply.send({ drafts });
    },
  );

  app.post<{ Params: { draftId: string }; Body: { instruction: string } }>(
    "/content/:draftId/refine",
    async (request, reply) => {
      try {
        return reply.send(
          await refineDraft(llm, request.params.draftId, request.body.instruction),
        );
      } catch (err) {
        if (err instanceof ConstraintViolationError) {
          return reply
            .code(422)
            .send({ error: "Revision violated the brief.", violations: err.violations });
        }
        throw err;
      }
    },
  );

  app.patch<{ Params: { draftId: string }; Body: { content: string } }>(
    "/content/:draftId",
    async (request, reply) => {
      return reply.send(await applyUserEdit(request.params.draftId, request.body.content));
    },
  );

  /** Re-check a hand-edited draft before it goes out. */
  app.get<{ Params: { draftId: string } }>(
    "/content/:draftId/review",
    async (request, reply) => {
      return reply.send(await reviewDraft(request.params.draftId));
    },
  );

  app.post<{ Params: { draftId: string }; Body: { scheduledFor: string } }>(
    "/content/:draftId/schedule",
    async (request, reply) => {
      try {
        return reply.send(
          await scheduleDraft(request.params.draftId, new Date(request.body.scheduledFor)),
        );
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.post<{ Params: { draftId: string } }>(
    "/content/:draftId/publish",
    async (request, reply) => {
      try {
        return reply.send(await publishDraft(env, request.params.draftId));
      } catch (err) {
        if (err instanceof ReauthRequiredError) {
          return reply.code(401).send({ error: "Reconnect LinkedIn to publish." });
        }
        return reply.code(502).send({ error: (err as Error).message });
      }
    },
  );

  /** Scheduler tick. One failure must not stop the rest of the queue. */
  app.post("/content/publish-due", async (_request, reply) => {
    return reply.send({ results: await publishDueDrafts(env) });
  });
}
