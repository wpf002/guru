import { prisma, type Prisma, type SourceDocument } from "@guru/db";
import { DocumentInsightSchema, type GuruLlm } from "@guru/llm";
import { googleAccessToken, type GoogleConfig } from "./google.js";

/**
 * Meeting notes and document ingestion — roadmap §1.9.
 *
 * The data contract from §0.7: summaries and user-tagged excerpts only, never
 * raw transcripts. Nothing auto-ingests — every document is confirmed
 * individually, and deletion actually deletes.
 *
 * These are business conversations containing other people's words. The
 * confirm-per-document step is the entire safety model, so it is enforced here:
 * a document with no `confirmedAt` cannot be analysed and cannot reach a prompt.
 */

const DRIVE_LIST =
  "https://www.googleapis.com/drive/v3/files" +
  "?q=" +
  encodeURIComponent(
    "(mimeType='application/vnd.google-apps.document' or mimeType='text/plain') and trashed=false",
  ) +
  "&orderBy=modifiedTime desc&pageSize=25&fields=files(id,name,modifiedTime,mimeType)";

export interface DriveCandidate {
  externalId: string;
  title: string;
  modifiedAt: string;
}

/**
 * Lists candidates. Deliberately does not fetch content — nothing leaves Drive
 * until the user confirms a specific document.
 */
export async function listDriveCandidates(
  config: GoogleConfig,
  userId: string,
): Promise<DriveCandidate[]> {
  const accessToken = await googleAccessToken(config, userId);
  const res = await fetch(DRIVE_LIST, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Drive list failed with ${res.status}.`);

  const body = (await res.json()) as {
    files?: { id: string; name: string; modifiedTime: string }[];
  };

  return (body.files ?? []).map((f) => ({
    externalId: f.id,
    title: f.name,
    modifiedAt: f.modifiedTime,
  }));
}

/**
 * Confirm and ingest one document.
 *
 * The raw text is fetched, summarized, and then discarded — only the summary,
 * the excerpts the user tagged, and the extracted insights are persisted. That
 * is the §0.7 contract, and it is enforced by never writing the transcript to a
 * column rather than by remembering not to.
 */
export async function confirmAndIngestDrive(
  llm: GuruLlm,
  config: GoogleConfig,
  userId: string,
  externalId: string,
  taggedExcerpts: string[] = [],
): Promise<SourceDocument> {
  const accessToken = await googleAccessToken(config, userId);

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${externalId}/export?mimeType=text/plain`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) throw new Error(`Drive export failed with ${res.status}.`);

  const raw = await res.text();
  return ingestText(llm, userId, {
    source: "GOOGLE_DRIVE",
    externalId,
    title: externalId,
    raw,
    taggedExcerpts,
  });
}

export async function ingestUploadedDocument(
  llm: GuruLlm,
  userId: string,
  options: { title: string; raw: string; taggedExcerpts?: string[] },
): Promise<SourceDocument> {
  return ingestText(llm, userId, {
    source: "UPLOAD",
    externalId: null,
    title: options.title,
    raw: options.raw,
    taggedExcerpts: options.taggedExcerpts ?? [],
  });
}

async function ingestText(
  llm: GuruLlm,
  userId: string,
  options: {
    source: "GOOGLE_DRIVE" | "UPLOAD";
    externalId: string | null;
    title: string;
    raw: string;
    taggedExcerpts: string[];
  },
): Promise<SourceDocument> {
  const { value, generationId } = await llm.structured(
    {
      userId,
      purpose: "document.extract",
      promptName: "document.extract",
      promptVersion: "1.0.0",
      system: DOCUMENT_SYSTEM,
      prompt: `Document: ${options.title}\n\n${options.raw.slice(0, 60000)}\n\n${
        options.taggedExcerpts.length > 0
          ? `The user specifically flagged these passages:\n${options.taggedExcerpts.map((e) => `- ${e}`).join("\n")}`
          : ""
      }`,
      effort: "medium",
      // The prompt carries the transcript, and the §0.7 contract says it does
      // not persist. Without this the audit row would quietly become the copy
      // of the transcript we promised not to keep — the one place the contract
      // is easiest to break by accident.
      redactPrompt: true,
      auditInputs: {
        title: options.title,
        rawLength: options.raw.length,
        taggedExcerptCount: options.taggedExcerpts.length,
      },
    },
    DocumentInsightSchema,
  );

  void generationId;

  return prisma.sourceDocument.create({
    data: {
      userId,
      source: options.source,
      externalId: options.externalId,
      title: options.title,
      confirmedAt: new Date(),
      summary: value.summary,
      excerpts: options.taggedExcerpts as unknown as Prisma.InputJsonValue,
      extractedInsights: {
        insights: value.insights,
        recurringProblems: value.recurringProblems,
        clientLanguage: value.clientLanguage,
      } as Prisma.InputJsonValue,
    },
  });
}

const DOCUMENT_SYSTEM = `You extract strategic signal from a user's work documents — usually meeting notes.

Return a summary, the insights worth carrying into content strategy, problems
that recur across their work, and verbatim phrasing worth reusing.

The verbatim phrasing is the most valuable output: how a client actually
describes their problem is almost always better copy than how a marketer would.

Never reproduce identifying details about third parties — names, companies,
contract terms, figures. Describe the pattern, not the party.`;

/** Real deletion, not a flag (§1.9). */
export async function deleteDocument(documentId: string): Promise<void> {
  await prisma.sourceDocument.delete({ where: { id: documentId } });
}

/** Confirmed documents only — enforced here so no caller can forget. */
export async function documentSignal(userId: string): Promise<string> {
  const documents = await prisma.sourceDocument.findMany({
    where: { userId, confirmedAt: { not: null }, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 15,
    select: { title: true, summary: true, extractedInsights: true },
  });

  if (documents.length === 0) return "";

  return documents
    .map((d) => {
      const insights = d.extractedInsights as {
        insights?: string[];
        recurringProblems?: string[];
        clientLanguage?: string[];
      } | null;
      return [
        `## ${d.title}`,
        d.summary,
        insights?.recurringProblems?.length
          ? `Recurring problems: ${insights.recurringProblems.join("; ")}`
          : "",
        insights?.clientLanguage?.length
          ? `Their words: ${insights.clientLanguage.map((c) => `"${c}"`).join(", ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}
