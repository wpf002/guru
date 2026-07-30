/**
 * Archive email detection — roadmap §1.1.
 *
 * LinkedIn delivers the archive in two installments. The first, subject
 * "The first installment of your LinkedIn data archive is ready!", carries
 * Connections.csv and typically lands within minutes. The second follows later
 * with everything else.
 *
 * This module decides *which* email is which. The Gmail API call itself lives in
 * apps/api so that classification stays pure and testable — the interesting
 * failure mode here is misclassifying an email, not failing to fetch one.
 */

export type Installment = "FIRST" | "SECOND";

export interface EmailHeaderLike {
  from: string;
  subject: string;
  receivedAt: Date;
  messageId: string;
}

export interface Detection {
  installment: Installment;
  messageId: string;
  receivedAt: Date;
}

/** Gmail query for the watcher. Narrow enough to avoid scanning the whole inbox. */
export const GMAIL_QUERY =
  'from:(linkedin.com) subject:("your LinkedIn data archive" OR "data export") newer_than:30d';

const LINKEDIN_SENDER = /@(e\.)?linkedin\.com>?\s*$/i;

/**
 * Phishing is the reason this checks the sender domain rather than the subject
 * alone: "your LinkedIn data archive is ready" with a download link is an
 * obvious lure, and this pipeline downloads and unzips what it is pointed at.
 */
export function isFromLinkedIn(from: string): boolean {
  return LINKEDIN_SENDER.test(from.trim());
}

export function classify(header: EmailHeaderLike): Detection | null {
  if (!isFromLinkedIn(header.from)) return null;

  const subject = header.subject.toLowerCase();
  if (!subject.includes("archive") && !subject.includes("data export")) return null;

  const installment: Installment = subject.includes("first installment")
    ? "FIRST"
    : "SECOND";

  return { installment, messageId: header.messageId, receivedAt: header.receivedAt };
}

/**
 * Idempotency: the watcher polls, so the same email will be seen repeatedly.
 * Already-ingested message ids are filtered here rather than relying on a
 * database constraint to reject the duplicate after a download has happened.
 */
export function selectNew(
  headers: readonly EmailHeaderLike[],
  alreadyIngested: readonly string[],
): Detection[] {
  const seen = new Set(alreadyIngested);
  return headers
    .map(classify)
    .filter((d): d is Detection => d !== null && !seen.has(d.messageId))
    .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
}

/** Which archive files each installment is expected to carry. */
export const INSTALLMENT_CONTENTS: Record<Installment, readonly string[]> = {
  FIRST: ["Connections.csv"],
  SECOND: ["Shares.csv", "Comments.csv", "messages.csv", "Invitations.csv", "Articles/"],
};
