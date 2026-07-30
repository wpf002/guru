import { parse } from "csv-parse/sync";
import {
  cleanField,
  normalizeCompany,
  normalizeName,
  parseArchiveDate,
} from "./normalize.js";

/**
 * Archive file parsers — roadmap §0.2 and §1.1.
 *
 * Every parser is tolerant by design: LinkedIn changes column headers between
 * exports without notice, and a single unexpected column must not cost the user
 * their entire archive. Rows that cannot be parsed are counted and reported
 * (ArchiveSnapshot.fileReport) rather than thrown.
 */

export interface ParseReport {
  rows: number;
  skipped: number;
  warnings: string[];
}

export interface ParseResult<T> {
  records: T[];
  report: ParseReport;
}

/**
 * Connections.csv opens with a "Notes:" preamble of two or three lines before
 * the real header row. Feeding that straight to a CSV parser yields one garbage
 * record and a header of "Notes:", which is exactly the kind of failure that
 * looks like an empty network rather than a parse bug.
 */
export function stripPreamble(csv: string): string {
  const lines = csv.split(/\r?\n/);
  const headerIndex = lines.findIndex(
    (line) => /first\s*name/i.test(line) && /last\s*name/i.test(line),
  );
  if (headerIndex <= 0) return csv;
  return lines.slice(headerIndex).join("\n");
}

function readCsv(csv: string): Record<string, string>[] {
  return parse(csv, {
    columns: (header: string[]) => header.map((h) => h.trim()),
    skip_empty_lines: true,
    relax_column_count: true,
    bom: true,
    trim: true,
  }) as Record<string, string>[];
}

/** Header names drift between exports; check several spellings. */
function pick(row: Record<string, string>, ...keys: string[]): string | null {
  for (const key of keys) {
    const match = Object.keys(row).find(
      (k) => k.toLowerCase().replace(/\s+/g, "") === key.toLowerCase().replace(/\s+/g, ""),
    );
    if (match) {
      const value = cleanField(row[match]);
      if (value) return value;
    }
  }
  return null;
}

export interface ParsedConnection {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  company: string | null;
  position: string | null;
  profileUrl: string | null;
  connectedOn: Date | null;
  normalizedName: string | null;
  normalizedCompany: string | null;
  rawRow: Record<string, string>;
}

export function parseConnections(csv: string): ParseResult<ParsedConnection> {
  const report: ParseReport = { rows: 0, skipped: 0, warnings: [] };
  const rows = readCsv(stripPreamble(csv));
  const records: ParsedConnection[] = [];

  for (const row of rows) {
    const firstName = pick(row, "First Name", "FirstName");
    const lastName = pick(row, "Last Name", "LastName");
    const profileUrl = pick(row, "URL", "Profile URL", "ProfileUrl");

    // A row with no name and no URL is not a person — usually a trailing
    // fragment from the preamble or a stray newline inside a quoted field.
    if (!firstName && !lastName && !profileUrl) {
      report.skipped++;
      continue;
    }

    const company = pick(row, "Company", "Company Name");
    records.push({
      firstName,
      lastName,
      email: pick(row, "Email Address", "Email"),
      company,
      position: pick(row, "Position", "Title"),
      profileUrl,
      connectedOn: parseArchiveDate(pick(row, "Connected On", "ConnectedOn")),
      normalizedName: normalizeName([firstName, lastName].filter(Boolean).join(" ")),
      normalizedCompany: normalizeCompany(company),
      rawRow: row,
    });
    report.rows++;
  }

  // Needs enough rows for the ratio to mean anything — on a handful of
  // connections it swings between 0% and 50% on one row either way.
  const withEmail = records.filter((r) => r.email).length;
  if (records.length >= 20 && withEmail / records.length < 0.1) {
    // Expected, not an error: most members withhold their address by default.
    // Worth surfacing so nobody spends a day debugging "missing" emails.
    report.warnings.push(
      `Only ${withEmail}/${records.length} connections exposed an email address. This is normal — LinkedIn withholds it unless the connection opted in.`,
    );
  }

  return { records, report };
}

export interface ParsedShare {
  shareLink: string | null;
  publishedAt: Date | null;
  content: string | null;
  visibility: string | null;
  mediaUrl: string | null;
  rawRow: Record<string, string>;
}

export function parseShares(csv: string): ParseResult<ParsedShare> {
  const report: ParseReport = { rows: 0, skipped: 0, warnings: [] };
  const records: ParsedShare[] = [];

  for (const row of readCsv(csv)) {
    const content = pick(row, "ShareCommentary", "Share Commentary", "Commentary");
    const shareLink = pick(row, "ShareLink", "Share Link");
    if (!content && !shareLink) {
      report.skipped++;
      continue;
    }
    records.push({
      shareLink,
      publishedAt: parseArchiveDate(pick(row, "Date", "Date Published")),
      content,
      visibility: pick(row, "Visibility"),
      mediaUrl: pick(row, "MediaUrl", "Media Url"),
      rawRow: row,
    });
    report.rows++;
  }

  return { records, report };
}

export interface ParsedComment {
  postUrl: string | null;
  createdAt: Date | null;
  message: string | null;
  rawRow: Record<string, string>;
}

/** The voice corpus (§1.8). Empty comments are worthless to it, so they are dropped. */
export function parseComments(csv: string): ParseResult<ParsedComment> {
  const report: ParseReport = { rows: 0, skipped: 0, warnings: [] };
  const records: ParsedComment[] = [];

  for (const row of readCsv(csv)) {
    const message = pick(row, "Message", "Comment");
    if (!message) {
      report.skipped++;
      continue;
    }
    records.push({
      postUrl: pick(row, "Link", "PostLink", "Post Link"),
      createdAt: parseArchiveDate(pick(row, "Date")),
      message,
      rawRow: row,
    });
    report.rows++;
  }

  if (records.length > 0) {
    report.warnings.push(`${records.length} comments available for voice modeling.`);
  }
  return { records, report };
}

export interface ParsedMessage {
  conversationId: string | null;
  fromName: string | null;
  toName: string | null;
  sentAt: Date | null;
  content: string | null;
  rawRow: Record<string, string>;
}

/**
 * DM history. Note what this does *not* return: `usableForAnalysis` is not set
 * here. It defaults to false in the schema and only the user can flip it — these
 * are other people's words, and opt-in is the only defensible default.
 */
export function parseMessages(csv: string): ParseResult<ParsedMessage> {
  const report: ParseReport = { rows: 0, skipped: 0, warnings: [] };
  const records: ParsedMessage[] = [];

  for (const row of readCsv(csv)) {
    const content = pick(row, "Content", "Message");
    if (!content) {
      report.skipped++;
      continue;
    }
    records.push({
      conversationId: pick(row, "CONVERSATION ID", "ConversationId", "Conversation ID"),
      fromName: pick(row, "FROM", "From"),
      toName: pick(row, "TO", "To"),
      sentAt: parseArchiveDate(pick(row, "DATE", "Date")),
      content,
      rawRow: row,
    });
    report.rows++;
  }

  return { records, report };
}

export interface ParsedInvitation {
  fromName: string | null;
  toName: string | null;
  sentAt: Date | null;
  direction: string | null;
  message: string | null;
  rawRow: Record<string, string>;
}

export function parseInvitations(csv: string): ParseResult<ParsedInvitation> {
  const report: ParseReport = { rows: 0, skipped: 0, warnings: [] };
  const records: ParsedInvitation[] = [];

  for (const row of readCsv(csv)) {
    const fromName = pick(row, "From");
    const toName = pick(row, "To");
    if (!fromName && !toName) {
      report.skipped++;
      continue;
    }
    records.push({
      fromName,
      toName,
      sentAt: parseArchiveDate(pick(row, "Sent At", "SentAt", "Date")),
      direction: pick(row, "Direction"),
      message: pick(row, "Message"),
      rawRow: row,
    });
    report.rows++;
  }

  return { records, report };
}
