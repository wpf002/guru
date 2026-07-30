import { prisma, type Prisma, type Roadmap } from "@guru/db";
import type { IntelConfig } from "@guru/intel";
import { RoadmapSchema, type GuruLlm } from "@guru/llm";
import { briefContext } from "./brief.js";
import { intelPicture, networkPicture } from "./analysis.js";

/**
 * Roadmap generation — roadmap §1.4.
 *
 * The output is the gap between current and target state, phased. Its real job
 * is structural: every content draft and engagement comment carries a foreign
 * key to a RoadmapElement, so this is where "strategy before content" stops
 * being a principle and becomes a constraint the database enforces.
 */

export async function generateRoadmap(
  llm: GuruLlm,
  userId: string,
  intelConfig: IntelConfig | null,
): Promise<Roadmap> {
  const brief = await prisma.strategicBrief.findFirst({
    where: { userId, supersededById: null },
    orderBy: { version: "desc" },
  });
  if (!brief) throw new Error("Generate the roadmap after the brief — it is the input.");

  const network = await networkPicture(userId);
  const intel = await intelPicture(llm, userId, brief, intelConfig);

  const { value, generationId } = await llm.structured(
    {
      userId,
      purpose: "roadmap.generate",
      promptName: "roadmap.generate",
      promptVersion: "1.0.0",
      system: `${ROADMAP_SYSTEM}\n\n--- THE BRIEF ---\n${briefContext(brief)}`,
      prompt: buildPrompt(network, intel),
      effort: "xhigh",
      maxTokens: 32000,
      auditInputs: {
        briefId: brief.id,
        briefVersion: brief.version,
        network,
        intelDegraded: intel.degraded,
      },
    },
    RoadmapSchema,
  );

  const previous = await prisma.roadmap.findFirst({
    where: { userId },
    orderBy: { version: "desc" },
    select: { version: true },
  });

  return prisma.roadmap.create({
    data: {
      userId,
      briefId: brief.id,
      version: (previous?.version ?? 0) + 1,
      connectionCount: network.connectionCount,
      density: network.density,
      audienceFitRatio: network.audienceFitRatio,
      invitationAcceptRate: network.invitationAcceptRate,
      historicalCadence: network.cadence as unknown as Prisma.InputJsonValue,
      networkAnalysis: network as unknown as Prisma.InputJsonValue,
      trendAnalysis: { themes: intel.themes, degraded: intel.degraded } as Prisma.InputJsonValue,
      peerAnalysis: { patterns: intel.peerPatterns } as Prisma.InputJsonValue,
      summary: value.summary,
      generationId,
      elements: {
        create: value.elements.map((element, order) => ({
          phase: element.phase,
          title: element.title,
          rationale: element.rationale,
          businessGoal: element.businessGoal,
          audienceSegment: element.audienceSegment,
          targetFormats: element.targetFormats,
          targetTopics: element.targetTopics,
          order,
        })),
      },
    },
    include: { elements: { orderBy: { order: "asc" } } },
  });
}

const ROADMAP_SYSTEM = `You turn a strategic brief and a real network picture into a phased content and positioning roadmap.

The roadmap is the gap between where this person is and where they want to be.
Every element you produce becomes the stated reason a specific post or comment
exists, so an element that cannot justify a piece of content is not an element.

Branch on effective reach, not raw connection count. A large network of the wrong
people needs network-building before content strategy, exactly as a small one
does — the audience-fit ratio is the signal, and the connection count on its own
is not.

Where the trend picture is marked degraded, you have no current market data. Say
so in the summary and lean on the brief and the network rather than inventing
trends.`;

function buildPrompt(
  network: Awaited<ReturnType<typeof networkPicture>>,
  intel: Awaited<ReturnType<typeof intelPicture>>,
): string {
  const sections = [
    `NETWORK
Connections: ${network.connectionCount}
Audience-fit ratio: ${
      network.audienceFitRatio === null
        ? "not yet scored"
        : `${Math.round(network.audienceFitRatio * 100)}%`
    }
Effective reach: ${network.effectiveReach ?? "unknown"}
Density: ${network.density}
Network-building needed first: ${network.needsNetworkBuilding ? "yes" : "no"}
${network.rationale}`,

    `POSTING HISTORY
Total posts: ${network.cadence.totalPosts}
Rate: ${network.cadence.postsPerWeek?.toFixed(2) ?? "n/a"} per week
Longest gap: ${network.cadence.longestGapDays ? `${Math.round(network.cadence.longestGapDays)} days` : "n/a"}
Last posted: ${network.cadence.lastPostedAt?.toISOString().slice(0, 10) ?? "never"}
Invitation acceptance rate: ${
      network.invitationAcceptRate === null
        ? "n/a"
        : `${Math.round(network.invitationAcceptRate * 100)}%`
    }`,

    intel.degraded
      ? `TRENDS AND PEERS
No trend data available — the intel layer is not configured or returned nothing.`
      : `TRENDS AND PEERS
Themes landing in this sub-niche:
${intel.themes.map((t) => `- ${t.theme} (relevance ${t.relevance.toFixed(2)}) — ${t.evidence}`).join("\n")}

Peer patterns (abstracted):
${intel.peerPatterns.map((p) => `- ${p.pattern} — applies to ${p.appliesTo}`).join("\n")}`,
  ];

  return `${sections.join("\n\n")}

Produce a phased roadmap. Phase 1 should be actionable this week.`;
}

/** The roadmap every draft traces to. */
export async function activeRoadmap(userId: string) {
  return prisma.roadmap.findFirst({
    where: { userId },
    orderBy: { version: "desc" },
    include: { elements: { orderBy: [{ phase: "asc" }, { order: "asc" }] }, brief: true },
  });
}
