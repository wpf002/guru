/**
 * Normalization for LinkedIn archive data — roadmap §1.1.
 *
 * The archive is dirty in ways that matter: emoji and credential salad in names
 * ("Jane Doe 🚀 | MBA, PMP"), inconsistent company casing and suffixes, blank
 * positions, and emails withheld for most connections by privacy default.
 *
 * Raw values are always preserved alongside normalized ones (Connection.rawRow),
 * so a parser fix can be replayed against stored rows instead of requiring the
 * user to request a fresh archive — which takes LinkedIn a day and the user a
 * trip through three settings screens.
 */

/**
 * Decorations people put in their names. Stripped for matching only; the raw
 * name is what gets displayed back to the user, because that is how they know
 * the person.
 */
const NAME_NOISE = [
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F000}-\u{1F02F}]/gu,
  /\|.*$/,
  /\bMBA\b|\bPMP\b|\bPhD\b|\bMD\b|\bCPA\b|\bCFA\b|\bMSc\b|\bBSc\b|\bJD\b|\bRN\b/gi,
  /\(.*?\)/g,
  /[,·•—–-]+\s*$/,
];

const COMPANY_SUFFIXES =
  /\b(inc|incorporated|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|plc|gmbh|s\.a|sa|bv|nv|pty|pte|ag|oy|ab)\b\.?/gi;

export function normalizeName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let out = raw;
  for (const pattern of NAME_NOISE) out = out.replace(pattern, " ");
  out = out.replace(/\s+/g, " ").trim().toLowerCase();
  return out || null;
}

export function normalizeCompany(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const out = raw
    .replace(COMPANY_SUFFIXES, " ")
    .replace(/[.,&]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return out || null;
}

/** Blank-ish values are common; `"-"` and `"N/A"` are not real positions. */
export function cleanField(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^(n\/?a|none|-|--|null|undefined)$/i.test(trimmed)) return null;
  return trimmed;
}

/**
 * LinkedIn is inconsistent about date formats across files and locales:
 * "15 Mar 2023", "03/15/23", ISO in some exports. Anything unparseable returns
 * null rather than an Invalid Date, which would otherwise propagate silently
 * into cadence maths and produce NaN gaps.
 */
export function parseArchiveDate(raw: string | null | undefined): Date | null {
  const value = cleanField(raw);
  if (!value) return null;

  const dmy = value.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/);
  if (dmy) {
    const parsed = new Date(`${dmy[2]} ${dmy[1]}, ${dmy[3]} UTC`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Dedupe key across snapshots. Profile URL is the only stable identifier
 * LinkedIn gives us; name+company is the fallback and it is imperfect — two
 * people with the same name at the same company will collide. That is rare
 * enough to accept and frequent enough to be worth knowing about.
 */
export function connectionKey(c: {
  profileUrl?: string | null;
  normalizedName?: string | null;
  normalizedCompany?: string | null;
}): string {
  if (c.profileUrl) return `url:${c.profileUrl.toLowerCase().replace(/\/$/, "")}`;
  return `nc:${c.normalizedName ?? ""}|${c.normalizedCompany ?? ""}`;
}
