import AdmZip from "adm-zip";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@guru/db";
import { CURRENT, getTemplate } from "@guru/prompts";
import { ingestUpload, snapshotDelta } from "../services/archive-ingest.js";
import { startIntake, submitAnswer } from "../services/intake.js";
import { synthesizeBrief, activeBrief, editBrief } from "../services/brief.js";
import {
  json,
  makeUser,
  resetDatabase,
  scriptedLlm,
  seedArchive,
} from "./helpers.js";

/** Phase 1a — archive ingestion, intake, brief. Real database. */

beforeEach(resetDatabase);

function archiveZip(): Buffer {
  const zip = new AdmZip();
  zip.addFile(
    "Connections.csv",
    Buffer.from(
      `Notes:\n"Some connections have no email address."\n\nFirst Name,Last Name,URL,Email Address,Company,Position,Connected On
Jane,Doe 🚀 | MBA,https://linkedin.com/in/janedoe,,Acme Corp.,VP Operations,15 Mar 2023
John,Smith,https://linkedin.com/in/johnsmith,john@example.com,Acme Corporation,Analyst,01 Apr 2023
`,
      "utf8",
    ),
  );
  zip.addFile(
    "Comments.csv",
    Buffer.from(
      `Date,Link,Message
2024-05-01,https://linkedin.com/feed/a,"Disagree. The constraint is distribution, not headcount."
`,
      "utf8",
    ),
  );
  zip.addFile(
    "messages.csv",
    Buffer.from(
      `CONVERSATION ID,FROM,TO,DATE,CONTENT
c1,Jane Doe,Drew,2024-05-01,"Following up on the proposal."
`,
      "utf8",
    ),
  );
  return zip.toBuffer();
}

describe("§1.1 archive ingestion", () => {
  it("ingests an uploaded archive into normalized rows", async () => {
    const user = await makeUser();
    const result = await ingestUpload(user.id, archiveZip());

    expect(result.status).toBe("INGESTED");
    expect(result.counts).toMatchObject({ connections: 2, comments: 1, messages: 1 });

    const connections = await prisma.connection.findMany({
      where: { userId: user.id },
      orderBy: { firstName: "asc" },
    });
    // Emoji and credentials stripped for matching; raw name preserved for display.
    expect(connections[0]!.normalizedName).toBe("jane doe");
    expect(connections[0]!.lastName).toBe("Doe 🚀 | MBA");
    // "Acme Corp." and "Acme Corporation" normalize to the same company.
    expect(connections[0]!.normalizedCompany).toBe(connections[1]!.normalizedCompany);
  });

  it("never marks DM content usable for analysis on ingest", async () => {
    // Other people's words — opt-in per record, and the pipeline must not be
    // able to flip it even accidentally.
    const user = await makeUser();
    await ingestUpload(user.id, archiveZip());

    const messages = await prisma.messageRecord.findMany({ where: { userId: user.id } });
    expect(messages).toHaveLength(1);
    expect(messages.every((m) => m.usableForAnalysis === false)).toBe(true);
  });

  it("records a failed snapshot instead of throwing on a non-ZIP body", async () => {
    const user = await makeUser();
    const result = await ingestUpload(user.id, Buffer.from("<html>Sign in</html>"));

    expect(result.status).toBe("NEEDS_MANUAL_DOWNLOAD");
    const snapshot = await prisma.archiveSnapshot.findUniqueOrThrow({
      where: { id: result.snapshotId },
    });
    expect(snapshot.status).toBe("FAILED");
    expect(snapshot.error).toMatch(/ZIP/i);
  });

  it("merges the second installment into the first rather than opening a new snapshot", async () => {
    // LinkedIn splits the export across two emails. Treating them as two
    // snapshots means the newest one holds no connections at all — the network
    // then reads as empty and the growth diff reports every connection as
    // churned.
    const user = await makeUser();

    const first = new AdmZip();
    first.addFile(
      "Connections.csv",
      Buffer.from(
        `First Name,Last Name,URL,Email Address,Company,Position,Connected On
Jane,Doe,https://linkedin.com/in/janedoe,,Acme,VP Ops,15 Mar 2023
John,Smith,https://linkedin.com/in/johnsmith,,Acme,Analyst,01 Apr 2023
`,
        "utf8",
      ),
    );
    await ingestUpload(user.id, first.toBuffer());

    const second = new AdmZip();
    second.addFile(
      "Shares.csv",
      Buffer.from(`Date,ShareLink,ShareCommentary\n2024-05-01,https://x,"A post."\n`, "utf8"),
    );
    second.addFile("Comments.csv", Buffer.from(`Date,Link,Message\n2024-05-01,https://y,"A comment."\n`, "utf8"));
    await ingestUpload(user.id, second.toBuffer());

    const snapshots = await prisma.archiveSnapshot.findMany({ where: { userId: user.id } });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]!.status).toBe("COMPLETE");
    expect(snapshots[0]!.secondInstallmentAt).not.toBeNull();

    // Both halves live in the one snapshot, so the network is still visible.
    const snapshotId = snapshots[0]!.id;
    expect(await prisma.connection.count({ where: { snapshotId } })).toBe(2);
    expect(await prisma.shareRecord.count({ where: { snapshotId } })).toBe(1);
    expect(await prisma.commentRecord.count({ where: { snapshotId } })).toBe(1);
  });

  it("does not report the whole network as churned after the second installment", async () => {
    const user = await makeUser();

    const first = new AdmZip();
    first.addFile(
      "Connections.csv",
      Buffer.from(
        `First Name,Last Name,URL,Email Address,Company,Position,Connected On
Jane,Doe,https://linkedin.com/in/janedoe,,Acme,VP Ops,15 Mar 2023
`,
        "utf8",
      ),
    );
    await ingestUpload(user.id, first.toBuffer());

    const second = new AdmZip();
    second.addFile("Comments.csv", Buffer.from(`Date,Link,Message\n2024-05-01,https://y,"c"\n`, "utf8"));
    await ingestUpload(user.id, second.toBuffer());

    // One snapshot, so there is nothing to diff against yet — not a diff that
    // claims everyone left.
    const delta = await snapshotDelta(user.id);
    expect(delta!.removed).toHaveLength(0);
    expect(delta!.added).toHaveLength(1);
  });

  it("ingests a second installment on its own when there is no first to merge into", async () => {
    const user = await makeUser();
    const zip = new AdmZip();
    zip.addFile("Comments.csv", Buffer.from(`Date,Link,Message\n2024-05-01,https://y,"c"\n`, "utf8"));

    const result = await ingestUpload(user.id, zip.toBuffer());
    expect(result.status).toBe("INGESTED");

    const snapshot = await prisma.archiveSnapshot.findUniqueOrThrow({
      where: { id: result.snapshotId },
    });
    expect(snapshot.status).toBe("COMPLETE");
  });

  it("links each snapshot to its predecessor and diffs growth", async () => {
    const user = await makeUser();
    await ingestUpload(user.id, archiveZip());

    const zip = new AdmZip();
    zip.addFile(
      "Connections.csv",
      Buffer.from(
        `First Name,Last Name,URL,Email Address,Company,Position,Connected On
Jane,Doe,https://linkedin.com/in/janedoe,,Acme Corp.,VP Operations,15 Mar 2023
John,Smith,https://linkedin.com/in/johnsmith,,Acme Corporation,Analyst,01 Apr 2023
Ana,Lopez,https://linkedin.com/in/analopez,,Beta Freight,Director,02 Feb 2025
`,
        "utf8",
      ),
    );
    await ingestUpload(user.id, zip.toBuffer());

    const delta = await snapshotDelta(user.id);
    expect(delta!.added).toHaveLength(1);
    expect(delta!.added[0]!.profileUrl).toContain("analopez");
    expect(delta!.netGrowth).toBe(1);
  });
});

describe("§1.2 intake state machine", () => {
  it("seeds areas 2 and 5 from the archive", async () => {
    const user = await makeUser();
    await seedArchive(user.id, {
      connections: 40,
      comments: ["Most people think distribution is a marketing problem. It is not."],
      shares: [{ content: "A post about spoilage.", publishedAt: new Date("2024-06-01") }],
    });

    const result = await startIntake(user.id);
    const seeded = result.progress.filter((p) => p.seeded).map((p) => p.area);

    expect(seeded).toContain("WHERE_THEY_ARE_TODAY");
    expect(seeded).toContain("VOICE_AND_CONSTRAINTS");
    expect(seeded).not.toContain("WHO_THEY_ARE");
  });

  it("is resumable — starting twice returns the same session", async () => {
    const user = await makeUser();
    const first = await startIntake(user.id);
    const second = await startIntake(user.id);
    expect(second.sessionId).toBe(first.sessionId);
  });

  it("advances only when the framework's required criteria are met", async () => {
    const user = await makeUser();
    const session = await startIntake(user.id);

    // The model claims the area is complete while naming only one criterion.
    // The framework must ignore that claim.
    const { llm } = scriptedLlm([
      json({
        question: "What exactly do you sell?",
        satisfiedCriteria: ["role"],
        areaComplete: true,
        extracted: [{ key: "role", value: "Operations consultant" }],
      }),
    ]);

    const result = await submitAnswer(llm, session.sessionId, "I'm an ops consultant.");

    expect(result.area).toBe("WHO_THEY_ARE");
    expect(result.progress.find((p) => p.area === "WHO_THEY_ARE")!.complete).toBe(false);

    const slot = await prisma.intakeSlot.findFirstOrThrow({
      where: { session: { id: session.sessionId }, area: "WHO_THEY_ARE" },
    });
    expect(slot.metCriteria).toEqual(["role"]);
  });

  it("ignores criteria keys the framework does not define", async () => {
    const user = await makeUser();
    const session = await startIntake(user.id);

    const { llm } = scriptedLlm([
      json({
        question: "And what do you sell?",
        satisfiedCriteria: ["role", "invented_key"],
        areaComplete: false,
        extracted: [],
      }),
    ]);

    await submitAnswer(llm, session.sessionId, "Ops consultant.");
    const slot = await prisma.intakeSlot.findFirstOrThrow({
      where: { session: { id: session.sessionId }, area: "WHO_THEY_ARE" },
    });
    expect(slot.metCriteria).toEqual(["role"]);
  });

  it("closes an area and opens the next when every required criterion is met", async () => {
    const user = await makeUser();
    const session = await startIntake(user.id);

    const { llm } = scriptedLlm([
      json({
        question: "(area 1 satisfied)",
        satisfiedCriteria: ["role", "industry", "niche", "subNiche", "offer"],
        areaComplete: true,
        extracted: [{ key: "role", value: "Ops consultant" }, { key: "offer", value: "Fractional ops leadership" }],
      }),
      json({
        question: "How often do you post at the moment?",
        satisfiedCriteria: [],
        areaComplete: false,
        extracted: [],
      }),
    ]);

    const result = await submitAnswer(llm, session.sessionId, "Everything about me.");

    expect(result.area).toBe("WHERE_THEY_ARE_TODAY");
    expect(result.question).toBe("How often do you post at the moment?");
    expect(result.progress.find((p) => p.area === "WHO_THEY_ARE")!.complete).toBe(true);
  });

  it("writes an audit row for every model call", async () => {
    const user = await makeUser();
    const session = await startIntake(user.id);
    const { llm } = scriptedLlm([
      json({ question: "Q", satisfiedCriteria: [], areaComplete: false, extracted: [] }),
    ]);

    await submitAnswer(llm, session.sessionId, "An answer.");

    const generations = await prisma.generation.findMany({ where: { userId: user.id } });
    expect(generations).toHaveLength(1);
    // The version is read from the registry rather than hardcoded: pinning a
    // literal here makes every deliberate prompt bump look like a regression.
    // What must hold is that the row records the version actually used, and
    // that the version is one the registry can still resolve — that pairing is
    // what makes a past generation replayable.
    expect(generations[0]).toMatchObject({
      purpose: "intake.followup",
      promptName: CURRENT.intakeFollowup.name,
      promptVersion: CURRENT.intakeFollowup.version,
      model: "claude-opus-5",
    });
    expect(() =>
      getTemplate(generations[0]!.promptName, generations[0]!.promptVersion),
    ).not.toThrow();
  });
});

describe("§1.3 strategic brief", () => {
  async function completeIntake(userId: string) {
    const session = await startIntake(userId);
    const { llm } = scriptedLlm(
      Array.from({ length: 5 }, () =>
        json({
          question: "next",
          satisfiedCriteria: [
            "role",
            "industry",
            "niche",
            "subNiche",
            "offer",
            "currentActivity",
            "networkComposition",
            "leadFlow",
            "goals",
            "targetOutcomes",
            "timeline",
            "persona",
            "personaSignals",
            "tone",
            "neverSay",
          ],
          areaComplete: true,
          extracted: [],
        }),
      ),
    );
    await submitAnswer(llm, session.sessionId, "Everything.");
    return session.sessionId;
  }

  const briefOutput = {
    role: "Operations consultant",
    industry: "Logistics",
    niche: "Third-party logistics",
    subNiche: "Cold-chain 3PL for regional grocers",
    offer: "Fractional ops leadership",
    currentState: { activity: "sporadic", network: "mixed", leadFlow: "referrals" },
    targetState: { goals: "inbound pipeline", outcomes: ["qualified leads"], timeline: "6 months" },
    persona: { description: "VP Ops at regional grocers", signals: ["VP Operations", "grocery"] },
    neverSay: ["guaranteed"],
    complianceFlags: [],
  };

  it("synthesizes a versioned brief from a completed intake", async () => {
    const user = await makeUser();
    const sessionId = await completeIntake(user.id);
    const { llm } = scriptedLlm([json(briefOutput)]);

    const brief = await synthesizeBrief(llm, sessionId);

    expect(brief.version).toBe(1);
    expect(brief.subNiche).toBe("Cold-chain 3PL for regional grocers");
    expect(brief.neverSay).toEqual(["guaranteed"]);
  });

  it("refuses to synthesize before intake is complete", async () => {
    const user = await makeUser();
    const session = await startIntake(user.id);
    const { llm } = scriptedLlm([]);

    await expect(synthesizeBrief(llm, session.sessionId)).rejects.toThrow(/not complete/i);
  });

  it("returns the same brief on a second call rather than minting v2", async () => {
    // A double-click must not create a second version of an unchanged brief.
    const user = await makeUser();
    const sessionId = await completeIntake(user.id);
    const { llm } = scriptedLlm([json(briefOutput)]);

    const first = await synthesizeBrief(llm, sessionId);
    const second = await synthesizeBrief(llm, sessionId);

    expect(second.id).toBe(first.id);
    expect(await prisma.strategicBrief.count({ where: { userId: user.id } })).toBe(1);
  });

  it("rejects a brief whose persona has no observable signals", async () => {
    // A persona with no signals cannot score a connection list, so it fails at
    // the boundary rather than producing a roadmap nobody can act on.
    const user = await makeUser();
    const sessionId = await completeIntake(user.id);
    const { llm } = scriptedLlm([
      json({ ...briefOutput, persona: { description: "Decision makers", signals: [] } }),
    ]);

    await expect(synthesizeBrief(llm, sessionId)).rejects.toThrow(/schema/i);
  });

  it("marks a hand-edited brief and keeps it active", async () => {
    const user = await makeUser();
    const sessionId = await completeIntake(user.id);
    const { llm } = scriptedLlm([json(briefOutput)]);
    const brief = await synthesizeBrief(llm, sessionId);

    await editBrief(brief.id, { neverSay: ["guaranteed", "passive income"] });

    const active = await activeBrief(user.id);
    expect(active!.editedByUser).toBe(true);
    expect(active!.neverSay).toContain("passive income");
  });
});

describe("§1.2 resuming an intake", () => {
  it("returns the whole transcript in order, not just the last question", async () => {
    // The UI rehydrates from this. Without it a reload dropped everything the
    // user had said and left them looking at one question with no context.
    const user = await makeUser();
    const session = await startIntake(user.id);

    const { llm } = scriptedLlm([
      json({ question: "Q1", satisfiedCriteria: [], areaComplete: false, extracted: [] }),
      json({ question: "Q2", satisfiedCriteria: [], areaComplete: false, extracted: [] }),
    ]);

    await submitAnswer(llm, session.sessionId, "First answer.");
    await submitAnswer(llm, session.sessionId, "Second answer.");

    const stored = await prisma.intakeSession.findUniqueOrThrow({
      where: { id: session.sessionId },
      include: { turns: { orderBy: { index: "asc" } } },
    });

    expect(stored.turns.map((t) => [t.role, t.content])).toEqual([
      ["user", "First answer."],
      ["assistant", "Q1"],
      ["user", "Second answer."],
      ["assistant", "Q2"],
    ]);
    // Indexes are dense and ordered, which is what the client sorts on.
    expect(stored.turns.map((t) => t.index)).toEqual([0, 1, 2, 3]);
  });

  it("records no turn for a null message, so resuming cannot inject a blank answer", async () => {
    const user = await makeUser();
    const session = await startIntake(user.id);
    const { llm } = scriptedLlm([
      json({ question: "Opening question", satisfiedCriteria: [], areaComplete: false, extracted: [] }),
    ]);

    await submitAnswer(llm, session.sessionId, null);

    const turns = await prisma.intakeTurn.findMany({ where: { sessionId: session.sessionId } });
    expect(turns).toHaveLength(1);
    expect(turns[0]!.role).toBe("assistant");
  });

  it("start is idempotent, so a reload resumes rather than restarting", async () => {
    const user = await makeUser();
    const first = await startIntake(user.id);
    const second = await startIntake(user.id);
    expect(second.sessionId).toBe(first.sessionId);
  });
});
