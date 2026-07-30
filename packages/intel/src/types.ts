/**
 * Peer and trend intelligence — roadmap §0.5.
 *
 * No LinkedIn search API exists, so this layer is tiered by provenance and every
 * record carries the tier it came from. That is not bookkeeping: Tier 3 is a
 * business decision the user's organisation makes, and "which of our data came
 * from it" has to be answerable after the fact, not reconstructed from logs.
 *
 *   Tier 1 SEARCH_INDEX  — public posts via a search API (Exa/Brave/SerpAPI).
 *                          Querying a search index, not scraping a platform.
 *   Tier 2 USER_SEEDED   — peers named at intake, tracked across every channel
 *                          they publish on. Most operators repeat themselves.
 *   Tier 3 PUBLIC_SCRAPE — no-login vendor scraping. Off unless explicitly
 *                          enabled. No account authenticates, so the user's
 *                          LinkedIn account is not what is at risk — but it
 *                          still runs against the User Agreement.
 */

export type IntelTier = "SEARCH_INDEX" | "USER_SEEDED" | "PUBLIC_SCRAPE";

export interface IntelResult {
  tier: IntelTier;
  url: string | null;
  title: string | null;
  content: string | null;
  author: string | null;
  publishedAt: Date | null;
  /** Only tiers that expose these populate them. Tier 1 generally does not. */
  reactionCount: number | null;
  commentCount: number | null;
  provider: string;
}

export interface SearchQuery {
  /** Sub-niche specific, per §1.4 — not the broad industry. */
  terms: string[];
  /** Restrict to these domains. Defaults to LinkedIn public post paths. */
  sites?: string[];
  authors?: string[];
  since?: Date;
  limit?: number;
}

export interface IntelProvider {
  readonly name: string;
  readonly tier: IntelTier;
  search(query: SearchQuery): Promise<IntelResult[]>;
}

export interface IntelConfig {
  provider: "exa" | "brave" | "serpapi";
  apiKey: string;
  /**
   * Tier 3 gate. Defaults false and is read once at construction so flipping it
   * requires a deliberate restart, not a runtime toggle someone forgets about.
   */
  tier3ScrapingEnabled: boolean;
}
