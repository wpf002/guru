import { prisma } from "@guru/db";
import type { GenerationRecord, GenerationSink } from "./client.js";

/**
 * The Prisma-backed audit sink.
 *
 * Separated from the client so the model layer can be unit-tested without a
 * database, and so a failure to *write the audit row* is visible rather than
 * silently swallowed inside the generation path.
 */
export const prismaGenerationSink: GenerationSink = async (record: GenerationRecord) => {
  const row = await prisma.generation.create({
    data: {
      userId: record.userId,
      purpose: record.purpose,
      promptName: record.promptName,
      promptVersion: record.promptVersion,
      model: record.model,
      inputs: record.inputs as object,
      output: record.output ?? null,
      outputJson: (record.outputJson as object | undefined) ?? undefined,
      inputTokens: record.inputTokens ?? null,
      outputTokens: record.outputTokens ?? null,
      latencyMs: record.latencyMs ?? null,
      error: record.error ?? null,
    },
    select: { id: true },
  });
  return { id: row.id };
};
