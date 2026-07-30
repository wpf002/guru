import { prisma, type ArchiveSnapshot, type Prisma } from "@guru/db";
import {
  GMAIL_QUERY,
  classifyContents,
  diffConnections,
  extractArchiveLink,
  isLinkedInHost,
  looksLikeZip,
  parseArchiveZip,
  selectNew,
  type ArchiveContents,
} from "@guru/archive";
import {
  fetchMessage,
  googleAccessToken,
  searchMessages,
  type GoogleConfig,
} from "./google.js";

/**
 * Archive ingestion — roadmap §1.1.
 *
 * The roadmap's target is "archive email → parsed network profile with zero
 * user steps". That holds when LinkedIn's email carries a directly-fetchable
 * link. It often doesn't — the link goes to a settings page behind the member's
 * own session (see packages/archive/src/email-link.ts).
 *
 * So this pipeline degrades in one visible step rather than silently: it tries
 * the fetch, and when it can't get a ZIP it records the extracted link on the
 * snapshot and surfaces it as a one-click download that feeds the upload path.
 * Two clicks in the bad case, zero in the good one, and never a spinner that
 * never resolves.
 */

export interface IngestResult {
  snapshotId: string;
  status: "INGESTED" | "NEEDS_MANUAL_DOWNLOAD" | "NOTHING_NEW";
  /** Populated when the fetch failed — hand this to the user. */
  downloadUrl?: string;
  counts?: Record<string, number>;
}

const MAX_ARCHIVE_BYTES = 500 * 1024 * 1024;

/**
 * Poll Gmail for archive emails and ingest whatever is fetchable.
 *
 * Idempotent: already-ingested message ids are filtered before anything is
 * downloaded, so running this on a schedule is safe.
 */
export async function pollAndIngest(
  config: GoogleConfig,
  userId: string,
): Promise<IngestResult[]> {
  const accessToken = await googleAccessToken(config, userId);

  const ingestedIds = (
    await prisma.archiveSnapshot.findMany({
      where: { userId },
      select: { gmailMessageIds: true },
    })
  ).flatMap((s) => s.gmailMessageIds);

  const messageIds = await searchMessages(accessToken, GMAIL_QUERY);
  const emails = await Promise.all(messageIds.map((id) => fetchMessage(accessToken, id)));

  const detections = selectNew(
    emails.map((e) => e.header),
    ingestedIds,
  );
  if (detections.length === 0) return [];

  const bodyById = new Map(emails.map((e) => [e.header.messageId, e.body]));
  const results: IngestResult[] = [];

  for (const detection of detections) {
    const body = bodyById.get(detection.messageId) ?? "";
    const link = extractArchiveLink(body);

    const snapshot = await openSnapshot(userId, "GMAIL_AUTO", detection.messageId);

    if (!link) {
      await failSnapshot(snapshot.id, "Archive email contained no recognisable download link.");
      results.push({ snapshotId: snapshot.id, status: "NEEDS_MANUAL_DOWNLOAD" });
      continue;
    }

    const buffer = await tryDownload(link.url);
    if (!buffer) {
      await prisma.archiveSnapshot.update({
        where: { id: snapshot.id },
        data: {
          error:
            "LinkedIn's download link requires your own session. Open it, download the ZIP, and upload it here.",
          fileReport: { downloadUrl: link.url } as Prisma.InputJsonValue,
        },
      });
      results.push({
        snapshotId: snapshot.id,
        status: "NEEDS_MANUAL_DOWNLOAD",
        downloadUrl: link.url,
      });
      continue;
    }

    results.push(await ingestBuffer(userId, snapshot, buffer));
  }

  return results;
}

/** Manual upload — the fallback for users who decline Gmail access (§1.1.3). */
export async function ingestUpload(userId: string, buffer: Buffer): Promise<IngestResult> {
  const snapshot = await openSnapshot(userId, "MANUAL_UPLOAD", null);
  return ingestBuffer(userId, snapshot, buffer);
}

async function openSnapshot(
  userId: string,
  source: "GMAIL_AUTO" | "MANUAL_UPLOAD",
  messageId: string | null,
): Promise<ArchiveSnapshot> {
  // Each snapshot is diffed against the previous one — that diff is where three
  // of the §9 metrics come from, so the link is established at creation rather
  // than reconstructed later.
  const previous = await prisma.archiveSnapshot.findFirst({
    where: { userId, status: { in: ["FIRST_INSTALLMENT_INGESTED", "COMPLETE"] } },
    orderBy: { requestedAt: "desc" },
    select: { id: true },
  });

  return prisma.archiveSnapshot.create({
    data: {
      userId,
      source,
      gmailMessageIds: messageId ? [messageId] : [],
      previousSnapshotId: previous?.id ?? null,
    },
  });
}

async function failSnapshot(snapshotId: string, error: string) {
  await prisma.archiveSnapshot.update({
    where: { id: snapshotId },
    data: { status: "FAILED", error },
  });
}

async function tryDownload(url: string): Promise<Buffer | null> {
  // The host was already checked at extraction; re-checked here because this is
  // the call that actually leaves the network, and redirects can move hosts.
  if (!isLinkedInHost(url)) return null;

  let res: Response;
  try {
    res = await fetch(url, { redirect: "follow" });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  if (!isLinkedInHost(res.url)) return null;

  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_ARCHIVE_BYTES) return null;

  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) return null;

  // A login page served as 200 would otherwise parse as an empty archive and
  // look exactly like a user with no connections.
  if (!looksLikeZip(bytes)) return null;

  return Buffer.from(bytes);
}

async function ingestBuffer(
  userId: string,
  snapshot: ArchiveSnapshot,
  buffer: Buffer,
): Promise<IngestResult> {
  let contents: ArchiveContents;
  try {
    contents = parseArchiveZip(buffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failSnapshot(snapshot.id, message);
    return { snapshotId: snapshot.id, status: "NEEDS_MANUAL_DOWNLOAD" };
  }

  await persistContents(userId, snapshot.id, contents);

  const kind = classifyContents(contents);
  const now = new Date();

  await prisma.archiveSnapshot.update({
    where: { id: snapshot.id },
    data: {
      status:
        kind === "COMPLETE"
          ? "COMPLETE"
          : kind === "FIRST"
            ? "FIRST_INSTALLMENT_INGESTED"
            : "COMPLETE",
      firstInstallmentAt: kind === "SECOND" ? snapshot.firstInstallmentAt : now,
      secondInstallmentAt: kind === "SECOND" ? now : snapshot.secondInstallmentAt,
      completedAt: kind === "FIRST" ? null : now,
      fileReport: {
        ...contents.report,
        unrecognizedFiles: contents.unrecognizedFiles,
      } as unknown as Prisma.InputJsonValue,
      error: null,
    },
  });

  return {
    snapshotId: snapshot.id,
    status: "INGESTED",
    counts: {
      connections: contents.connections.length,
      shares: contents.shares.length,
      comments: contents.comments.length,
      messages: contents.messages.length,
      invitations: contents.invitations.length,
      articles: contents.articles.length,
    },
  };
}

/**
 * The second installment lands as its own email but belongs to the same
 * snapshot conceptually. Rather than merge across rows, both write into the
 * snapshot they arrived with and the analysis layer reads the most recent
 * non-empty value per file type — simpler, and it keeps snapshots immutable so
 * diffs stay meaningful.
 */
async function persistContents(
  userId: string,
  snapshotId: string,
  contents: ArchiveContents,
) {
  const chunk = 1000;
  const inChunks = async <T>(rows: T[], write: (batch: T[]) => Promise<unknown>) => {
    for (let i = 0; i < rows.length; i += chunk) {
      await write(rows.slice(i, i + chunk));
    }
  };

  await inChunks(contents.connections, (batch) =>
    prisma.connection.createMany({
      data: batch.map((c) => ({
        userId,
        snapshotId,
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email,
        company: c.company,
        position: c.position,
        profileUrl: c.profileUrl,
        connectedOn: c.connectedOn,
        normalizedName: c.normalizedName,
        normalizedCompany: c.normalizedCompany,
        rawRow: c.rawRow as Prisma.InputJsonValue,
      })),
    }),
  );

  await inChunks(contents.shares, (batch) =>
    prisma.shareRecord.createMany({
      data: batch.map((s) => ({
        userId,
        snapshotId,
        shareLink: s.shareLink,
        publishedAt: s.publishedAt,
        content: s.content,
        visibility: s.visibility,
        mediaUrl: s.mediaUrl,
        rawRow: s.rawRow as Prisma.InputJsonValue,
      })),
    }),
  );

  await inChunks(contents.comments, (batch) =>
    prisma.commentRecord.createMany({
      data: batch.map((c) => ({
        userId,
        snapshotId,
        postUrl: c.postUrl,
        createdAt: c.createdAt ?? undefined,
        message: c.message,
        rawRow: c.rawRow as Prisma.InputJsonValue,
      })),
    }),
  );

  await inChunks(contents.messages, (batch) =>
    prisma.messageRecord.createMany({
      data: batch.map((m) => ({
        userId,
        snapshotId,
        conversationId: m.conversationId,
        fromName: m.fromName,
        toName: m.toName,
        sentAt: m.sentAt,
        content: m.content,
        // Never set here. These are other people's words; only the user flips it.
        usableForAnalysis: false,
      })),
    }),
  );

  await inChunks(contents.invitations, (batch) =>
    prisma.invitationRecord.createMany({
      data: batch.map((i) => ({
        userId,
        snapshotId,
        fromName: i.fromName,
        toName: i.toName,
        sentAt: i.sentAt,
        direction: i.direction,
        message: i.message,
      })),
    }),
  );

  await inChunks(contents.articles, (batch) =>
    prisma.articleRecord.createMany({
      data: batch.map((a) => ({
        userId,
        snapshotId,
        title: a.title,
        content: a.content,
        sourceFile: a.sourceFile,
      })),
    }),
  );
}

/** Growth and churn between the two most recent snapshots (§9). */
export async function snapshotDelta(userId: string) {
  const [current, previous] = await prisma.archiveSnapshot.findMany({
    where: { userId, status: { in: ["FIRST_INSTALLMENT_INGESTED", "COMPLETE"] } },
    orderBy: { requestedAt: "desc" },
    take: 2,
    select: { id: true, requestedAt: true },
  });

  if (!current) return null;

  const load = (snapshotId: string) =>
    prisma.connection.findMany({
      where: { snapshotId },
      select: {
        profileUrl: true,
        normalizedName: true,
        normalizedCompany: true,
        connectedOn: true,
        personaFitScore: true,
      },
    });

  const currentRows = await load(current.id);
  const previousRows = previous ? await load(previous.id) : [];

  return {
    from: previous?.requestedAt ?? null,
    to: current.requestedAt,
    ...diffConnections(previousRows, currentRows),
  };
}
