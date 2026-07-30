/**
 * Hard filters from the strategic brief — roadmap §1.3.
 *
 * The never-say list and compliance flags are enforced here, on generated output,
 * *after* the model returns and before the user ever sees a draft. They are not
 * prompt suggestions. A model that ignores an instruction 1% of the time is a
 * compliance incident 1% of the time, and prompts have no failure mode we can
 * assert on.
 */

export interface BriefConstraints {
  neverSay: readonly string[];
  complianceFlags: readonly string[];
}

export interface Violation {
  term: string;
  index: number;
  excerpt: string;
}

export interface ConstraintResult {
  ok: boolean;
  violations: Violation[];
}

/**
 * Word-boundary matching, case-insensitive. Substring matching would flag "ROI"
 * inside "Royal" and train users to ignore the filter.
 */
function findTerm(haystack: string, term: string): Violation[] {
  const trimmed = term.trim();
  if (!trimmed) return [];

  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Only apply \b where the term's own edge is a word character — otherwise a
  // term like "#growth" or "(guaranteed)" would never match.
  const leading = /^\w/.test(trimmed) ? "\\b" : "";
  const trailing = /\w$/.test(trimmed) ? "\\b" : "";
  const re = new RegExp(`${leading}${escaped}${trailing}`, "gi");

  const out: Violation[] = [];
  for (const m of haystack.matchAll(re)) {
    const index = m.index ?? 0;
    out.push({
      term: trimmed,
      index,
      excerpt: haystack.slice(Math.max(0, index - 40), index + trimmed.length + 40),
    });
  }
  return out;
}

export function checkConstraints(
  text: string,
  constraints: BriefConstraints,
): ConstraintResult {
  const violations = [
    ...constraints.neverSay,
    ...constraints.complianceFlags,
  ].flatMap((term) => findTerm(text, term));

  return { ok: violations.length === 0, violations };
}

export class ConstraintViolationError extends Error {
  constructor(readonly violations: Violation[]) {
    super(
      `Generated output violates brief constraints: ${violations
        .map((v) => `"${v.term}"`)
        .join(", ")}`,
    );
    this.name = "ConstraintViolationError";
  }
}

/** Throwing gate for the generation pipeline. */
export function assertConstraints(text: string, constraints: BriefConstraints): void {
  const result = checkConstraints(text, constraints);
  if (!result.ok) throw new ConstraintViolationError(result.violations);
}
