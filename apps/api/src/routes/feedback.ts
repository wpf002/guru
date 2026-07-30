import type { FastifyInstance } from "fastify";
import { prisma } from "@guru/db";
import type { GuruLlm } from "@guru/llm";
import {
  autonomyPromptState,
  confidenceDashboard,
  recordDecision,
  type DecisionInput,
} from "../services/confidence.js";
import { activeVoiceProfile, buildVoiceProfile } from "../services/voice.js";
import { metricsView, recordWeeklyReport } from "../services/metrics.js";

/** Feedback, confidence, voice, and metrics routes — §1.7, §1.8, §1.10, §9. */
export async function feedbackRoutes(app: FastifyInstance, llm: GuruLlm) {
  // --- Approve / reject (§1.7) ---

  app.post<{ Body: DecisionInput }>("/decisions", async (request, reply) => {
    try {
      return reply.send(await recordDecision(request.body));
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  /** Visible to the user, by design — trust is earned transparently. */
  app.get<{ Params: { userId: string } }>(
    "/confidence/:userId",
    async (request, reply) => {
      return reply.send(await confidenceDashboard(request.params.userId));
    },
  );

  /** §1.10 — records intent, gates nothing in Phase 1. */
  app.get<{ Params: { userId: string } }>(
    "/confidence/:userId/autonomy-prompt",
    async (request, reply) => {
      return reply.send(await autonomyPromptState(request.params.userId));
    },
  );

  // --- Voice model (§1.8) ---

  app.post<{ Body: { userId: string } }>("/voice/build", async (request, reply) => {
    try {
      return reply.send(await buildVoiceProfile(llm, request.body.userId));
    } catch (err) {
      return reply.code(409).send({ error: (err as Error).message });
    }
  });

  app.get<{ Params: { userId: string } }>("/voice/:userId", async (request, reply) => {
    const profile = await activeVoiceProfile(request.params.userId);
    if (!profile) return reply.code(404).send({ error: "No voice profile yet." });
    return reply.send(profile);
  });

  /** User-inspectable and editable (§1.8). */
  app.patch<{ Params: { profileId: string }; Body: { summary?: string; traits?: unknown } }>(
    "/voice/id/:profileId",
    async (request, reply) => {
      return reply.send(
        await prisma.voiceProfile.update({
          where: { id: request.params.profileId },
          data: {
            summary: request.body.summary,
            traits: request.body.traits as never,
            editedByUser: true,
          },
        }),
      );
    },
  );

  // --- Metrics (§9) ---

  app.post<{ Body: { userId: string } & Record<string, never> }>(
    "/metrics/weekly",
    async (request, reply) => {
      const { userId, ...report } = request.body;
      return reply.send(await recordWeeklyReport(userId, report));
    },
  );

  app.get<{ Params: { userId: string } }>("/metrics/:userId", async (request, reply) => {
    return reply.send(await metricsView(request.params.userId));
  });
}
