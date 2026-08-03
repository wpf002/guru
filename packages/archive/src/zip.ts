import AdmZip from "adm-zip";
import {
  parseComments,
  parseConnections,
  parseInvitations,
  parseMessages,
  parseShares,
  type ParseReport,
  type ParsedComment,
  type ParsedConnection,
  type ParsedInvitation,
  type ParsedMessage,
  type ParsedShare,
} from "./parsers.js";

/**
 * Unpacking a LinkedIn archive — roadmap §1.1 and §0.2.
 *
 * The archive's internal layout is not stable: file names vary in case, some
 * exports nest everything under a folder, and the article files live in a
 * directory rather than a CSV. So entries are matched on their basename,
 * case-insensitively, and anything unrecognised is reported rather than
 * silently dropped — an unrecognised file is usually LinkedIn having renamed
 * something, which we want to find out about from a report, not from a user
 * whose voice model came back empty.
 */

export interface ParsedArticle {
  title: string | null;
  content: string;
  sourceFile: string;
}

export interface ArchiveContents {
  connections: ParsedConnection[];
  shares: ParsedShare[];
  comments: ParsedComment[];
  messages: ParsedMessage[];
  invitations: ParsedInvitation[];
  articles: ParsedArticle[];
  /** Per-file outcome, persisted to ArchiveSnapshot.fileReport. */
  report: Record<string, ParseReport>;
  unrecognizedFiles: string[];
}

export class ArchiveUnpackError extends Error {}

/** Guards against a zip bomb — the largest real archives are well under this. */
const MAX_TOTAL_UNCOMPRESSED_BYTES = 2_000_000_000;

/**
 * The basename, lowercased, with LinkedIn's member-id suffix removed.
 *
 * Real exports do not use the clean names the documentation implies. Activity
 * files carry the member id: `Shares_1638994912.csv`, `Comments_1638994912.csv`,
 * `Reactions_1638994912.csv`. Matching the bare name meant shares and comments
 * fell through to `unrecognizedFiles` on every genuine archive, and ingestion
 * reported success with zero of both — which silently empties the voice model,
 * posting cadence, the brief's archive summary, and the §1.2 seeds.
 *
 * Only a trailing `_<digits>` is stripped, so `learning_coach_messages.csv`
 * stays distinct from `messages.csv`.
 */
export function canonicalArchiveName(entryName: string): string {
  const parts = entryName.split("/");
  const name = (parts[parts.length - 1] ?? entryName).toLowerCase();
  return name.replace(/_\d+(\.[a-z0-9]+)$/, "$1");
}

function basename(entryName: string): string {
  return canonicalArchiveName(entryName);
}

function isUnderArticlesDir(entryName: string): boolean {
  return /(^|\/)articles?\//i.test(entryName);
}

export function parseArchiveZip(buffer: Buffer): ArchiveContents {
  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch (err) {
    throw new ArchiveUnpackError(
      `Could not open the archive as a ZIP: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const contents: ArchiveContents = {
    connections: [],
    shares: [],
    comments: [],
    messages: [],
    invitations: [],
    articles: [],
    report: {},
    unrecognizedFiles: [],
  };

  let totalBytes = 0;

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;

    totalBytes += entry.header.size;
    if (totalBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new ArchiveUnpackError(
        "Archive expands to more than 2GB — refusing to unpack. This is not a normal LinkedIn export.",
      );
    }

    // Path traversal: entry names come from the ZIP, and we only ever match on
    // the basename, but a traversal name would still be worth knowing about.
    if (entry.entryName.includes("..")) {
      contents.unrecognizedFiles.push(entry.entryName);
      continue;
    }

    const name = basename(entry.entryName);
    const text = () => entry.getData().toString("utf8");

    switch (name) {
      case "connections.csv": {
        const { records, report } = parseConnections(text());
        contents.connections.push(...records);
        contents.report["Connections.csv"] = report;
        break;
      }
      case "shares.csv": {
        const { records, report } = parseShares(text());
        contents.shares.push(...records);
        contents.report["Shares.csv"] = report;
        break;
      }
      case "comments.csv": {
        const { records, report } = parseComments(text());
        contents.comments.push(...records);
        contents.report["Comments.csv"] = report;
        break;
      }
      case "messages.csv": {
        const { records, report } = parseMessages(text());
        contents.messages.push(...records);
        contents.report["messages.csv"] = report;
        break;
      }
      case "invitations.csv": {
        const { records, report } = parseInvitations(text());
        contents.invitations.push(...records);
        contents.report["Invitations.csv"] = report;
        break;
      }
      default: {
        if (isUnderArticlesDir(entry.entryName) && /\.(html?|txt|md)$/i.test(name)) {
          const raw = text();
          contents.articles.push({
            title: extractTitle(raw) ?? name.replace(/\.[^.]+$/, ""),
            content: stripHtml(raw),
            sourceFile: entry.entryName,
          });
        } else {
          contents.unrecognizedFiles.push(entry.entryName);
        }
      }
    }
  }

  if (contents.articles.length > 0) {
    contents.report["Articles/"] = {
      rows: contents.articles.length,
      skipped: 0,
      warnings: [],
    };
  }

  return contents;
}

function extractTitle(raw: string): string | null {
  const match = raw.match(/<title[^>]*>([^<]+)<\/title>/i) ?? raw.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  return match?.[1]?.trim() || null;
}

/** Articles are exported as HTML; the voice model wants the words, not the tags. */
function stripHtml(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Which installment a set of unpacked contents looks like (§1.1). */
export function classifyContents(contents: ArchiveContents): "FIRST" | "SECOND" | "COMPLETE" {
  const hasConnections = contents.connections.length > 0;
  const hasRest =
    contents.shares.length > 0 ||
    contents.comments.length > 0 ||
    contents.messages.length > 0 ||
    contents.invitations.length > 0 ||
    contents.articles.length > 0;

  if (hasConnections && hasRest) return "COMPLETE";
  return hasConnections ? "FIRST" : "SECOND";
}
