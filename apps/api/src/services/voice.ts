import { prisma, type Prisma, type VoiceProfile } from "@guru/db";
import { analyzeVoice, editsPerDraft, formatStats } from "@guru/core";
import { CURRENT, render } from "@guru/prompts";
import { VoiceProfileSchema, type GuruLlm } from "@guru/llm";

/**
 * The voice model — roadmap §1.8.
 *
 * Cold-started from comments.csv and Shares.csv, which is the whole point:
 * hundreds or thousands of real samples on day one instead of a profile that
 * slowly assembles itself from months of edits.
 *
 * Refinement then comes from edit diffs — the places the user rewrote us are the
 * places the model was wrong about how they sound.
 */

const MAX_SAMPLES = 120;

export async function buildVoiceProfile(
  llm: GuruLlm,
  userId: string,
): Promise<VoiceProfile> {
  const [comments, shares, edits] = await Promise.all([
    prisma.commentRecord.findMany({
      where: { userId, message: { not: null } },
      select: { message: true },
      orderBy: { createdAt: "desc" },
      take: 1000,
    }),
    prisma.shareRecord.findMany({
      where: { userId, content: { not: null } },
      select: { content: true },
      orderBy: { publishedAt: "desc" },
      take: 500,
    }),
    prisma.draftRevision.findMany({
      where: { userId, author: "user" },
      select: { content: true, instruction: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  const corpus = [
    ...comments.map((c) => c.message ?? ""),
    ...shares.map((s) => s.content ?? ""),
    // User-edited drafts are the highest-signal samples in the set: they are
    // this person deliberately making our output sound like them.
    ...edits.map((e) => e.content),
  ].filter((s) => s.trim().length > 0);

  if (corpus.length === 0) {
    throw new Error(
      "No writing samples yet. Ingest an archive or approve a few edited drafts first.",
    );
  }

  const stats = analyzeVoice(corpus);

  // Longest samples, not the most recent: a corpus of one-line "Congrats!"
  // comments describes nobody, however current it is.
  const samples = [...corpus]
    .sort((a, b) => b.length - a.length)
    .slice(0, MAX_SAMPLES)
    .map((s, i) => `--- SAMPLE ${i + 1} ---\n${s.slice(0, 1500)}`)
    .join("\n\n");

  const { value, generationId } = await llm.structured(
    {
      userId,
      purpose: "voice.summarize",
      promptName: CURRENT.voiceSummary.name,
      promptVersion: CURRENT.voiceSummary.version,
      system: VOICE_SYSTEM,
      prompt: render(CURRENT.voiceSummary, { samples, stats: formatStats(stats) }),
      effort: "high",
      auditInputs: {
        commentCount: comments.length,
        shareCount: shares.length,
        editCount: edits.length,
      },
    },
    VoiceProfileSchema,
  );

  const previous = await prisma.voiceProfile.findFirst({
    where: { userId },
    orderBy: { version: "desc" },
    select: { version: true },
  });

  await prisma.voiceProfile.updateMany({
    where: { userId, active: true },
    data: { active: false },
  });

  return prisma.voiceProfile.create({
    data: {
      userId,
      version: (previous?.version ?? 0) + 1,
      traits: value.traits as unknown as Prisma.InputJsonValue,
      summary: value.summary,
      sourceCommentCount: comments.length,
      sourceShareCount: shares.length,
      sourceEditCount: edits.length,
      generationId,
      active: true,
    },
  });
}

const VOICE_SYSTEM = `You describe how a specific person writes, from their real LinkedIn posts and comments.

Describe what is there, including the habits that are not virtues. The tics are
what make a voice recognisable — a description that sands them off produces
writing that reads like a better writer, which is to say like someone else.

Do not give writing advice. Do not describe what they should do differently.`;

export async function activeVoiceProfile(userId: string): Promise<VoiceProfile | null> {
  return prisma.voiceProfile.findFirst({
    where: { userId, active: true },
    orderBy: { version: "desc" },
  });
}

/** Rendered into every generation. Falls back to raw statistics before a profile exists. */
export async function voiceContext(userId: string): Promise<string> {
  const profile = await activeVoiceProfile(userId);
  if (profile) {
    return `${profile.summary ?? ""}\n\n${JSON.stringify(profile.traits, null, 2)}`;
  }

  const [comments, shares] = await Promise.all([
    prisma.commentRecord.findMany({ where: { userId }, select: { message: true }, take: 500 }),
    prisma.shareRecord.findMany({ where: { userId }, select: { content: true }, take: 500 }),
  ]);
  const corpus = [
    ...comments.map((c) => c.message ?? ""),
    ...shares.map((s) => s.content ?? ""),
  ].filter(Boolean);

  return corpus.length > 0
    ? formatStats(analyzeVoice(corpus))
    : "No voice samples available — write plainly and avoid stylistic flourishes.";
}

/**
 * User edits per draft. This should decline over time; it is the honest proof
 * the system is learning (§1.8, §9), which is why it is measured rather than
 * asserted.
 */
export async function editsPerDraftTrend(
  userId: string,
  windowDays = 30,
): Promise<{ current: number | null; previous: number | null; improving: boolean | null }> {
  const now = Date.now();
  const windowMs = windowDays * 86_400_000;

  const load = async (from: Date, to: Date) => {
    const drafts = await prisma.contentDraft.findMany({
      where: { userId, createdAt: { gte: from, lt: to } },
      select: { revisions: { select: { author: true } } },
    });
    return editsPerDraft(drafts);
  };

  const current = await load(new Date(now - windowMs), new Date(now));
  const previous = await load(new Date(now - 2 * windowMs), new Date(now - windowMs));

  return {
    current,
    previous,
    improving: current !== null && previous !== null ? current < previous : null,
  };
}
