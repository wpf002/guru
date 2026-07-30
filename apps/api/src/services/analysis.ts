import { prisma, type Prisma, type StrategicBrief } from "@guru/db";
import { analyzeNetwork, invitationAcceptRate, postingCadence } from "@guru/core";
import { createProvider, type IntelConfig } from "@guru/intel";
import { PersonaScoreSchema, TrendAnalysisSchema, type GuruLlm } from "@guru/llm";
import { briefContext } from "./brief.js";

/**
 * Deep-dive analysis — roadmap §1.4.
 *
 * Three inputs feed the roadmap: the network (from the archive), the sub-niche
 * trend picture (from the intel layer), and peer patterns. The first is exact,
 * the second and third are best-effort — and the roadmap generator is told which
 * is which, so a missing intel key degrades the roadmap rather than blocking it.
 */

const SCORE_BATCH = 60;

/**
 * Score connections against the brief's persona.
 *
 * Batched because scoring 10,000 connections one call at a time is neither
 * affordable nor necessary — fit is a coarse judgement and the model reads a
 * batch as well as it reads one. Only unscored connections from the latest
 * snapshot are touched, so this is resumable and cheap to re-run.
 */
export async function scorePersonaFit(
  llm: GuruLlm,
  userId: string,
  options: { limit?: number } = {},
): Promise<{ scored: number; remaining: number }> {
  const brief = await prisma.strategicBrief.findFirst({
    where: { userId, supersededById: null },
    orderBy: { version: "desc" },
  });
  if (!brief) throw new Error("Score persona fit after the brief exists — it defines the persona.");

  const snapshot = await prisma.archiveSnapshot.findFirst({
    where: { userId, status: { in: ["FIRST_INSTALLMENT_INGESTED", "COMPLETE"] } },
    orderBy: { requestedAt: "desc" },
    select: { id: true },
  });
  if (!snapshot) return { scored: 0, remaining: 0 };

  // Re-scoring against a *newer* brief is intentional: a revised persona makes
  // every prior score stale, and `scoredAgainstBriefId` is what detects that.
  const pending = await prisma.connection.findMany({
    where: {
      snapshotId: snapshot.id,
      OR: [{ personaFitScore: null }, { scoredAgainstBriefId: { not: brief.id } }],
    },
    select: { id: true, firstName: true, lastName: true, company: true, position: true },
    take: options.limit ?? SCORE_BATCH * 5,
  });

  let scored = 0;

  for (let i = 0; i < pending.length; i += SCORE_BATCH) {
    const batch = pending.slice(i, i + SCORE_BATCH);
    const listing = batch
      .map(
        (c, index) =>
          `${index}. ${[c.firstName, c.lastName].filter(Boolean).join(" ") || "(no name)"} — ` +
          `${c.position ?? "no title"} at ${c.company ?? "no company"}`,
      )
      .join("\n");

    const { value } = await llm.structured(
      {
        userId,
        purpose: "analysis.persona_fit",
        promptName: "analysis.persona_fit",
        promptVersion: "1.0.0",
        system: personaSystem(brief),
        prompt: `Score each connection for fit against the target persona.\n\n${listing}\n\nReturn one entry per index above. Use the full 0–1 range — clustering everything at 0.5 makes the ratio meaningless.`,
        effort: "low",
        auditInputs: { briefId: brief.id, batchSize: batch.length },
      },
      PersonaScoreSchema,
    );

    await Promise.all(
      value.scores
        .filter((s) => s.index >= 0 && s.index < batch.length)
        .map((s) =>
          prisma.connection.update({
            where: { id: batch[s.index]!.id },
            data: {
              personaFitScore: s.fit,
              personaFitReason: s.reason,
              scoredAgainstBriefId: brief.id,
            },
          }),
        ),
    );
    scored += value.scores.length;
  }

  const remaining = await prisma.connection.count({
    where: {
      snapshotId: snapshot.id,
      OR: [{ personaFitScore: null }, { scoredAgainstBriefId: { not: brief.id } }],
    },
  });

  return { scored, remaining };
}

function personaSystem(brief: StrategicBrief): string {
  return `You score LinkedIn connections for fit against a target persona.

${briefContext(brief)}

Score 1.0 for someone who is unmistakably the target buyer, 0.0 for someone with
no plausible relationship to the offer. Judge on title and company only — that is
all the archive gives you, and guessing beyond it produces confident noise.

A network is scored to decide strategy, so the spread matters more than any
single score. Clustering everything near 0.5 makes the audience-fit ratio
meaningless.`;
}

export interface NetworkPicture {
  connectionCount: number;
  audienceFitRatio: number | null;
  effectiveReach: number | null;
  density: "SPARSE" | "MODERATE" | "DENSE";
  needsNetworkBuilding: boolean;
  rationale: string;
  invitationAcceptRate: number | null;
  cadence: ReturnType<typeof postingCadence>;
  /**
   * §1.4 asks for "which past posts drew comments from target-persona
   * accounts", and §9 sources it from "archive re-ingest". Neither is possible:
   * the archive's comments.csv contains comments the member *left*, not
   * comments *received*, and reading engagement back on your own posts needs
   * r_member_social, which is closed (§0.3).
   *
   * Null rather than 0, because "we cannot see this" and "nobody commented" are
   * different facts and a dashboard must not present the first as the second.
   */
  postsThatDrewPersonaComments: number | null;
  postsThatDrewPersonaCommentsNote: string;
}

export async function networkPicture(userId: string): Promise<NetworkPicture> {
  const snapshot = await prisma.archiveSnapshot.findFirst({
    where: { userId, status: { in: ["FIRST_INSTALLMENT_INGESTED", "COMPLETE"] } },
    orderBy: { requestedAt: "desc" },
    select: { id: true },
  });

  const [connections, shares, invitations] = await Promise.all([
    snapshot
      ? prisma.connection.findMany({
          where: { snapshotId: snapshot.id },
          select: { connectedOn: true, personaFitScore: true },
        })
      : Promise.resolve([]),
    prisma.shareRecord.findMany({
      where: { userId },
      select: { publishedAt: true, shareLink: true },
    }),
    prisma.invitationRecord.findMany({
      where: { userId },
      select: { direction: true, status: true },
    }),
  ]);

  const network = analyzeNetwork(connections);

  return {
    connectionCount: network.connectionCount,
    audienceFitRatio: network.audienceFitRatio,
    effectiveReach: network.effectiveReach,
    density: network.density,
    needsNetworkBuilding: network.needsNetworkBuilding,
    rationale: network.rationale,
    invitationAcceptRate: invitationAcceptRate(invitations),
    cadence: postingCadence(shares),
    postsThatDrewPersonaComments: null,
    postsThatDrewPersonaCommentsNote:
      "Not measurable: the archive records comments you left, not comments you received, and reading back engagement on your own posts requires r_member_social, which LinkedIn has closed. Use the weekly self-report instead (§9).",
  };
}

export interface IntelPicture {
  themes: { theme: string; evidence: string; relevance: number }[];
  peerPatterns: { pattern: string; appliesTo: string }[];
  /** Peer post text, kept for the similarity gate on generated drafts. */
  sourceMaterial: string[];
  /** True when no intel provider is configured — the roadmap says so plainly. */
  degraded: boolean;
}

/**
 * Trend and peer analysis (§1.4, §0.5).
 *
 * Tier 1 is a site-restricted search-index query; Tier 2 is the peers named at
 * intake. Tier 3 stays off unless explicitly enabled, and this function never
 * reaches for it — enabling scraping is a deliberate act elsewhere, not a
 * fallback that happens when a search returns thin results.
 */
export async function intelPicture(
  llm: GuruLlm,
  userId: string,
  brief: StrategicBrief,
  config: IntelConfig | null,
): Promise<IntelPicture> {
  if (!config) {
    return {
      themes: [],
      peerPatterns: [],
      sourceMaterial: [],
      degraded: true,
    };
  }

  const peers = await prisma.peer.findMany({
    where: { userId, active: true },
    select: { id: true, name: true },
  });

  const provider = createProvider(config);
  const since = new Date(Date.now() - 90 * 86_400_000);

  const results = await provider.search({
    terms: [brief.subNiche, brief.niche, brief.offer].filter(Boolean) as string[],
    authors: peers.map((p) => p.name),
    since,
    limit: 30,
  });

  // Persist with provenance so "which of our data came from which tier" stays
  // answerable after the fact (§0.5).
  for (const result of results) {
    const peer = peers.find(
      (p) => result.author && p.name.toLowerCase() === result.author.toLowerCase(),
    );
    if (!peer || !result.url) continue;

    await prisma.peerPost.upsert({
      where: { id: `${peer.id}:${result.url}` },
      update: { content: result.content, retrievedAt: new Date() },
      create: {
        id: `${peer.id}:${result.url}`,
        peerId: peer.id,
        userId,
        tier: result.tier,
        url: result.url,
        content: result.content,
        publishedAt: result.publishedAt,
        provider: result.provider,
      },
    });
  }

  const sourceMaterial = results
    .map((r) => r.content)
    .filter((c): c is string => Boolean(c && c.length > 80));

  if (sourceMaterial.length === 0) {
    return { themes: [], peerPatterns: [], sourceMaterial: [], degraded: true };
  }

  const { value } = await llm.structured(
    {
      userId,
      purpose: "analysis.trends",
      promptName: "analysis.trends",
      promptVersion: "1.0.0",
      system: `You analyse what is currently resonating in a specific sub-niche on LinkedIn.

${briefContext(brief)}

Output abstracted patterns, never material to reuse. A pattern is "opens with a
number that contradicts the reader's assumption", not the sentence that did it.
Anything you quote will end up in a draft and get flagged as derivative.`,
      prompt: `Here are recent public posts from this sub-niche and from named peers.\n\n${sourceMaterial
        .map((text, i) => `--- SOURCE ${i} ---\n${text.slice(0, 2000)}`)
        .join("\n\n")}\n\nIdentify the themes that are landing and the formats/structures peers are using.`,
      effort: "high",
      maxTokens: 20000,
      auditInputs: { briefId: brief.id, sourceCount: sourceMaterial.length },
    },
    TrendAnalysisSchema,
  );

  return { ...value, sourceMaterial, degraded: false };
}

/** Peers named at intake (§1.4) — 5–15 is the useful range. */
export async function setPeers(
  userId: string,
  peers: { name: string; linkedinUrl?: string; company?: string }[],
) {
  await prisma.peer.updateMany({ where: { userId }, data: { active: false } });
  await Promise.all(
    peers.map((p) =>
      prisma.peer.create({
        data: {
          userId,
          name: p.name,
          linkedinUrl: p.linkedinUrl ?? null,
          company: p.company ?? null,
          seededByUser: true,
          active: true,
          otherChannels: {} as Prisma.InputJsonValue,
        },
      }),
    ),
  );
  return prisma.peer.findMany({ where: { userId, active: true } });
}
