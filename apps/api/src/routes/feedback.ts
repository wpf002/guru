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
import { ownedBy, requireUser } from "../auth.js";

/** Feedback, confidence, voice, and metrics routes — §1.7, §1.8, §1.10, §9. */
export async function feedbackRoutes(app: FastifyInstance, llm: GuruLlm) {
  // --- Approve / reject (§1.7) ---

  app.post<{ Body: Omit<DecisionInput, "userId"> }>("/decisions", async (request, reply) => {
    const userId = requireUser(request);

    // The decision names a draft, so the draft has to be the caller's — otherwise
    // approving someone else's post is a matter of knowing its id.
    if (request.body.contentDraftId) {
      const draft = await prisma.contentDraft.findUnique({
        where: { id: request.body.contentDraftId },
        select: { id: true, userId: true },
      });
      ownedBy(draft, userId);
    }
    if (request.body.engagementDraftId) {
      const draft = await prisma.engagementDraft.findUnique({
        where: { id: request.body.engagementDraftId },
        select: { id: true, userId: true },
      });
      ownedBy(draft, userId);
    }

    try {
      return reply.send(await recordDecision({ ...request.body, userId }));
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  /** Visible to the user, by design — trust is earned transparently. */
  app.get("/confidence", async (request, reply) => {
    return reply.send(await confidenceDashboard(requireUser(request)));
  });

  /** §1.10 — records intent, gates nothing in Phase 1. */
  app.get("/confidence/autonomy-prompt", async (request, reply) => {
    return reply.send(await autonomyPromptState(requireUser(request)));
  });

  // --- Voice model (§1.8) ---

  app.post("/voice/build", async (request, reply) => {
    try {
      return reply.send(await buildVoiceProfile(llm, requireUser(request)));
    } catch (err) {
      return reply.code(409).send({ error: (err as Error).message });
    }
  });

  app.get("/voice", async (request, reply) => {
    const profile = await activeVoiceProfile(requireUser(request));
    if (!profile) return reply.code(404).send({ error: "No voice profile yet." });
    return reply.send(profile);
  });

  /** User-inspectable and editable (§1.8). */
  app.patch<{ Params: { profileId: string }; Body: { summary?: string; traits?: unknown } }>(
    "/voice/id/:profileId",
    async (request, reply) => {
      const userId = requireUser(request);
      const existing = await prisma.voiceProfile.findUnique({
        where: { id: request.params.profileId },
        select: { id: true, userId: true },
      });
      ownedBy(existing, userId);

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

  app.post<{ Body: Record<string, never> }>("/metrics/weekly", async (request, reply) => {
    return reply.send(await recordWeeklyReport(requireUser(request), request.body));
  });

  app.get("/metrics", async (request, reply) => {
    return reply.send(await metricsView(requireUser(request)));
  });
}
