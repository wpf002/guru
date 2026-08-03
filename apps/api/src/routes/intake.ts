import type { FastifyInstance } from "fastify";
import { prisma } from "@guru/db";
import type { GuruLlm } from "@guru/llm";
import { startIntake, submitAnswer } from "../services/intake.js";
import { activeBrief, editBrief, synthesizeBrief } from "../services/brief.js";
import { ownedBy, requireUser } from "../auth.js";

/**
 * Intake and brief routes — roadmap §1.2 and §1.3.
 *
 * Session ids and brief ids are addressable, so every route that takes one loads
 * the row and checks it belongs to the caller before touching it. An id is not
 * a capability.
 */
export async function intakeRoutes(app: FastifyInstance, llm: GuruLlm) {
  /** Idempotent: returns the in-progress session if one exists (resumable). */
  app.post("/intake/start", async (request, reply) => {
    return reply.send(await startIntake(requireUser(request)));
  });

  app.post<{ Params: { sessionId: string }; Body: { message: string | null } }>(
    "/intake/:sessionId/answer",
    async (request, reply) => {
      await assertOwnsSession(request.params.sessionId, requireUser(request));
      const result = await submitAnswer(llm, request.params.sessionId, request.body.message);
      return reply.send(result);
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    "/intake/:sessionId",
    async (request, reply) => {
      const userId = requireUser(request);
      const session = await prisma.intakeSession.findUnique({
        where: { id: request.params.sessionId },
        include: {
          slots: { orderBy: { area: "asc" } },
          turns: { orderBy: { index: "asc" } },
        },
      });
      // ownedBy collapses "no such session" and "not yours" into one response,
      // so the endpoint cannot be used to discover which ids exist.
      return reply.send(ownedBy(session, userId));
    },
  );

  /**
   * Synthesizing twice returns the same brief rather than minting a duplicate
   * version — a double-click should not create v2 of an unchanged brief.
   */
  app.post<{ Params: { sessionId: string } }>(
    "/intake/:sessionId/brief",
    async (request, reply) => {
      await assertOwnsSession(request.params.sessionId, requireUser(request));
      try {
        return reply.send(await synthesizeBrief(llm, request.params.sessionId));
      } catch (err) {
        return reply.code(409).send({ error: (err as Error).message });
      }
    },
  );

  /** Cheap "where am I" for the setup flow — no model call, no session created. */
  app.get("/intake/state", async (request, reply) => {
    const userId = requireUser(request);

    // "Have you ever finished one", not "is the newest one finished". Opening
    // the intake screen starts a fresh session, so reading the latest reported
    // a completed intake as unfinished the moment someone looked at the page.
    const [finished, latest] = await Promise.all([
      prisma.intakeSession.findFirst({
        where: { userId, status: "COMPLETE" },
        select: { id: true },
      }),
      prisma.intakeSession.findFirst({
        where: { userId },
        orderBy: { startedAt: "desc" },
        select: { id: true, _count: { select: { turns: true } } },
      }),
    ]);

    return reply.send({
      sessionId: latest?.id ?? null,
      started: Boolean(latest && latest._count.turns > 0),
      complete: Boolean(finished),
    });
  });

  app.get("/brief", async (request, reply) => {
    const brief = await activeBrief(requireUser(request));
    if (!brief) return reply.code(404).send({ error: "No brief yet." });
    return reply.send(brief);
  });

  app.get("/brief/versions", async (request, reply) => {
    const versions = await prisma.strategicBrief.findMany({
      where: { userId: requireUser(request) },
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
  });

  app.patch<{ Params: { briefId: string }; Body: Record<string, unknown> }>(
    "/brief/id/:briefId",
    async (request, reply) => {
      const userId = requireUser(request);
      const brief = await prisma.strategicBrief.findUnique({
        where: { id: request.params.briefId },
        select: { id: true, userId: true },
      });
      ownedBy(brief, userId);
      return reply.send(await editBrief(request.params.briefId, request.body));
    },
  );
}

async function assertOwnsSession(sessionId: string, userId: string): Promise<void> {
  const session = await prisma.intakeSession.findUnique({
    where: { id: sessionId },
    select: { id: true, userId: true },
  });
  ownedBy(session, userId);
}
