/**
 * Extracting the archive download link from LinkedIn's email — roadmap §1.1.
 *
 * A correction to the roadmap's assumption: LinkedIn does not attach the archive
 * to the email, it sends a link. That link is served behind the member's own
 * LinkedIn session, so an unauthenticated server-side fetch generally gets a
 * login page rather than a ZIP.
 *
 * So "zero user steps after the initial request" holds only when the link
 * happens to be directly fetchable. The pipeline therefore does both: it tries
 * the fetch, and when that fails it surfaces the extracted link to the user as a
 * one-click download that feeds straight into the upload path. Two clicks, not
 * a trip through three settings screens — and it degrades honestly instead of
 * appearing to hang.
 */

/** Every https URL in the body. Narrowed by host and path below. */
const ANY_URL = /https:\/\/[^\s"'<>)]+/gi;

/**
 * Paths that actually lead to the archive. Matched after tracker-unwrapping, so
 * a percent-encoded target inside a click tracker is still recognised.
 */
const ARCHIVE_PATHS = [
  /\/dms\/download/i,
  /\/psettings\/download-my-data/i,
  /\/mypreferences\/d\/download-my-data/i,
];

const TRACKER = /^https:\/\/www\.linkedin\.com\/comm\/l\//i;

export interface ExtractedLink {
  url: string;
  /** True when the URL still points at a LinkedIn page rather than a file. */
  requiresMemberSession: boolean;
}

function unwrapTracker(raw: string): string {
  if (!TRACKER.test(raw)) return raw;
  try {
    const inner = new URL(raw).searchParams.get("url");
    return inner ? decodeURIComponent(inner) : raw;
  } catch {
    return raw;
  }
}

function decodeEntities(html: string): string {
  return html
    .replace(/&amp;/g, "&")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/**
 * Returns the first plausible archive link in the email body, or null.
 *
 * Deliberately conservative: this URL gets fetched and unzipped, so a loose
 * match on any LinkedIn link in the message would be a way to point the
 * ingestion pipeline at an attacker-chosen file.
 */
export function extractArchiveLink(body: string): ExtractedLink | null {
  const decoded = decodeEntities(body);

  // A `g` regex carries lastIndex between calls; reset so a second call on the
  // same module-level pattern doesn't start mid-string and skip matches.
  ANY_URL.lastIndex = 0;

  for (const match of decoded.matchAll(ANY_URL)) {
    const url = unwrapTracker(match[0]);
    if (!isLinkedInHost(url)) continue;
    if (!ARCHIVE_PATHS.some((p) => p.test(url))) continue;

    return {
      url,
      // A `/dms/download` path serves the file directly; the settings pages
      // render HTML behind the member's session.
      requiresMemberSession: !/\/dms\/download/i.test(url),
    };
  }

  return null;
}

/**
 * Host allowlist. Checked against the parsed hostname rather than by substring,
 * so `linkedin.com.evil.co` does not pass.
 */
export function isLinkedInHost(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== "https:") return false;
    return hostname === "linkedin.com" || hostname.endsWith(".linkedin.com");
  } catch {
    return false;
  }
}

/**
 * A fetched body is only ingested if it actually is a ZIP. Content-Type alone is
 * not enough — LinkedIn's login page can be served as an attachment-ish type,
 * and a login page silently parsed as an empty archive would look like a user
 * with no connections.
 */
export function looksLikeZip(bytes: Uint8Array): boolean {
  // PK\x03\x04, or the empty/spanned-archive variants.
  if (bytes.length < 4) return false;
  const [a, b, c, d] = [bytes[0], bytes[1], bytes[2], bytes[3]];
  return a === 0x50 && b === 0x4b && (c === 0x03 || c === 0x05 || c === 0x07) && (d === 0x04 || d === 0x06 || d === 0x08);
}
