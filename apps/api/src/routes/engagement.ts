import type { FastifyInstance } from "fastify";
import { ConstraintViolationError } from "@guru/core";
import type { GuruLlm } from "@guru/llm";
import { MissingScopeError, type ReactionType } from "@guru/linkedin";
import {
  discoverTargets,
  draftComment,
  draftReaction,
  publishEngagement,
  targetQueue,
} from "../services/engagement.js";
import { ReauthRequiredError } from "../services/linkedin-session.js";
import type { Env } from "../env.js";

/** Engagement engine routes — roadmap §1.6. */
export async function engagementRoutes(app: FastifyInstance, env: Env, llm: GuruLlm) {
  app.post<{ Body: { userId: string } }>("/engagement/discover", async (request, reply) => {
    try {
      const result = await discoverTargets(llm, request.body.userId, env.intel);
      if (result.degraded) {
        // A clear "not configured" beats an empty queue that looks like a bug.
        return reply.send({
          ...result,
          note: "No intel provider configured — set INTEL_SEARCH_API_KEY to build a target feed.",
        });
      }
      return reply.send(result);
    } catch (err) {
      return reply.code(409).send({ error: (err as Error).message });
    }
  });

  app.get<{ Params: { userId: string } }>(
    "/engagement/queue/:userId",
    async (request, reply) => {
      return reply.send({ targets: await targetQueue(request.params.userId) });
    },
  );

  app.post<{ Params: { targetId: string }; Body: { roadmapElementId?: string } }>(
    "/engagement/:targetId/comment",
    async (request, reply) => {
      try {
        return reply.send(
          await draftComment(llm, request.params.targetId, request.body?.roadmapElementId),
        );
      } catch (err) {
        if (err instanceof ConstraintViolationError) {
          return reply.code(422).send({
            error: "Generated comment violated the brief's constraints.",
            violations: err.violations,
          });
        }
        return reply.code(409).send({ error: (err as Error).message });
      }
    },
  );

  app.post<{ Params: { targetId: string }; Body: { type?: ReactionType } }>(
    "/engagement/:targetId/react",
    async (request, reply) => {
      return reply.send(
        await draftReaction(request.params.targetId, request.body?.type ?? "LIKE"),
      );
    },
  );

  /**
   * Human-approved in Phase 1, exactly like content. There is no route that
   * posts an engagement without this call.
   */
  app.post<{ Params: { draftId: string } }>(
    "/engagement/draft/:draftId/publish",
    async (request, reply) => {
      try {
        return reply.send(await publishEngagement(env, request.params.draftId));
      } catch (err) {
        if (err instanceof ReauthRequiredError) {
          return reply.code(401).send({ error: "Reconnect LinkedIn to engage." });
        }
        // Not a transport failure: the app was never granted the scope. 403
        // with the reason, so the UI can say what to apply for.
        if (err instanceof MissingScopeError) {
          return reply.code(403).send({
            error: err.message,
            requiredScope: err.requiredScope,
            capability: err.capability,
          });
        }
        return reply.code(502).send({ error: (err as Error).message });
      }
    },
  );
}
