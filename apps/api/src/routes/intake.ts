import type { FastifyInstance } from "fastify";
import { prisma } from "@guru/db";
import type { GuruLlm } from "@guru/llm";
import { startIntake, submitAnswer } from "../services/intake.js";
import { activeBrief, editBrief, synthesizeBrief } from "../services/brief.js";

/** Intake and brief routes — roadmap §1.2 and §1.3. */
export async function intakeRoutes(app: FastifyInstance, llm: GuruLlm) {
  /** Idempotent: returns the in-progress session if one exists (resumable). */
  app.post<{ Body: { userId: string } }>("/intake/start", async (request, reply) => {
    return reply.send(await startIntake(request.body.userId));
  });

  app.post<{ Params: { sessionId: string }; Body: { message: string } }>(
    "/intake/:sessionId/answer",
    async (request, reply) => {
      const result = await submitAnswer(llm, request.params.sessionId, request.body.message);
      return reply.send(result);
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    "/intake/:sessionId",
    async (request, reply) => {
      const session = await prisma.intakeSession.findUnique({
        where: { id: request.params.sessionId },
        include: {
          slots: { orderBy: { area: "asc" } },
          turns: { orderBy: { index: "asc" } },
        },
      });
      if (!session) return reply.code(404).send({ error: "No such intake session." });
      return reply.send(session);
    },
  );

  /**
   * Synthesizing twice returns the same brief rather than minting a duplicate
   * version — a double-click should not create v2 of an unchanged brief.
   */
  app.post<{ Params: { sessionId: string } }>(
    "/intake/:sessionId/brief",
    async (request, reply) => {
      try {
        return reply.send(await synthesizeBrief(llm, request.params.sessionId));
      } catch (err) {
        return reply.code(409).send({ error: (err as Error).message });
      }
    },
  );

  app.get<{ Params: { userId: string } }>("/brief/:userId", async (request, reply) => {
    const brief = await activeBrief(request.params.userId);
    if (!brief) return reply.code(404).send({ error: "No brief yet." });
    return reply.send(brief);
  });

  app.get<{ Params: { userId: string } }>(
    "/brief/:userId/versions",
    async (request, reply) => {
      const versions = await prisma.strategicBrief.findMany({
        where: { userId: request.params.userId },
        orderBy: { version: "desc" },
        select: {
          id: true,
          version: true,
          createdAt: true,
          editedByUser: true,
          supersededById: true,
        },
      });
      return reply.send({ versions });
    },
  );

  app.patch<{ Params: { briefId: string }; Body: Record<string, unknown> }>(
    "/brief/id/:briefId",
    async (request, reply) => {
      return reply.send(await editBrief(request.params.briefId, request.body));
    },
  );
}
