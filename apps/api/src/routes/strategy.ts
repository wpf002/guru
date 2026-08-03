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
import { MissingScopeError } from "@guru/linkedin";
import { ReauthRequiredError } from "../services/linkedin-session.js";
import { ownedBy, requireUser } from "../auth.js";
import type { Env } from "../env.js";

/** Analysis, roadmap, and content routes — roadmap §1.4 and §1.5. */
export async function strategyRoutes(app: FastifyInstance, env: Env, llm: GuruLlm) {
  // --- Analysis (§1.4) ---

  app.post<{ Body: { peers: { name: string; linkedinUrl?: string }[] } }>(
    "/peers",
    async (request, reply) => {
      return reply.send({ peers: await setPeers(requireUser(request), request.body.peers) });
    },
  );

  /**
   * Resumable by design — a 10,000-connection network is scored across several
   * calls, and the response says how many are left.
   */
  app.post<{ Body: { limit?: number } }>(
    "/analysis/persona-fit",
    async (request, reply) => {
      const result = await scorePersonaFit(llm, requireUser(request), {
        limit: request.body?.limit,
      });
      return reply.send(result);
    },
  );

  app.get("/analysis/network", async (request, reply) => {
    return reply.send(await networkPicture(requireUser(request)));
  });

  // --- Roadmap (§1.4) ---

  app.post("/roadmap", async (request, reply) => {
    // Resolved before the try. Inside it, the catch-all 409 would answer an
    // anonymous request with "conflict" and echo "Sign in to continue" as the
    // reason, which is neither the right status nor a usable message.
    const userId = requireUser(request);
    try {
      return reply.send(await generateRoadmap(llm, userId, env.intel));
    } catch (err) {
      return reply.code(409).send({ error: (err as Error).message });
    }
  });

  app.get("/roadmap", async (request, reply) => {
    const roadmap = await activeRoadmap(requireUser(request));
    if (!roadmap) return reply.code(404).send({ error: "No roadmap yet." });
    return reply.send(roadmap);
  });

  // --- Content (§1.5) ---

  /**
   * A draft cannot exist without a roadmap element. That is the whole mechanism
   * behind "strategy before content" — there is deliberately no route that
   * generates a post from a free-text topic.
   */
  app.post<{ Body: { roadmapElementId: string } }>(
    "/content/draft",
    async (request, reply) => {
      // generateDraft already refuses a roadmap element belonging to someone
      // else; passing the session user is what makes that check meaningful.
      const userId = requireUser(request);
      try {
        const draft = await generateDraft(llm, userId, request.body.roadmapElementId);
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

  app.get<{ Querystring: { status?: string } }>(
    "/content",
    async (request, reply) => {
      const drafts = await prisma.contentDraft.findMany({
        where: {
          userId: requireUser(request),
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
      await assertOwnsDraft(request.params.draftId, requireUser(request));
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
      await assertOwnsDraft(request.params.draftId, requireUser(request));
      return reply.send(await applyUserEdit(request.params.draftId, request.body.content));
    },
  );

  /** Re-check a hand-edited draft before it goes out. */
  app.get<{ Params: { draftId: string } }>(
    "/content/:draftId/review",
    async (request, reply) => {
      await assertOwnsDraft(request.params.draftId, requireUser(request));
      return reply.send(await reviewDraft(request.params.draftId));
    },
  );

  app.post<{ Params: { draftId: string }; Body: { scheduledFor: string } }>(
    "/content/:draftId/schedule",
    async (request, reply) => {
      await assertOwnsDraft(request.params.draftId, requireUser(request));
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
      await assertOwnsDraft(request.params.draftId, requireUser(request));
      try {
        return reply.send(await publishDraft(env, request.params.draftId));
      } catch (err) {
        if (err instanceof ReauthRequiredError) {
          return reply.code(401).send({ error: "Reconnect LinkedIn to publish." });
        }
        if (err instanceof MissingScopeError) {
          return reply.code(403).send({
            error: err.message,
            requiredScope: err.requiredScope,
          });
        }
        return reply.code(502).send({ error: (err as Error).message });
      }
    },
  );

  /**
   * Manual "publish anything that is due" for the signed-in user. One failure
   * must not stop the rest of the queue.
   *
   * Scoped to the caller: the background scheduler sweeps every account by
   * calling the service directly, but an HTTP trigger must not be able to push
   * someone else's scheduled posts out early.
   */
  app.post("/content/publish-due", async (request, reply) => {
    const userId = requireUser(request);
    return reply.send({ results: await publishDueDrafts(env, new Date(), userId) });
  });
}

async function assertOwnsDraft(draftId: string, userId: string): Promise<void> {
  const draft = await prisma.contentDraft.findUnique({
    where: { id: draftId },
    select: { id: true, userId: true },
  });
  ownedBy(draft, userId);
}
