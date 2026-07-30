import type { IntelConfig, IntelProvider, IntelResult, SearchQuery } from "./types.js";

/**
 * Tier 1 search-index provider — roadmap §0.5.
 *
 * Public LinkedIn posts are indexed by search engines. Hitting a search API with
 * site-restricted queries returns peer content without ever touching LinkedIn
 * infrastructure or authenticating an account.
 */

const LINKEDIN_POST_SITES = ["linkedin.com/posts", "linkedin.com/pulse"];

export class ExaProvider implements IntelProvider {
  readonly name = "exa";
  readonly tier = "SEARCH_INDEX" as const;

  constructor(private readonly apiKey: string) {}

  async search(query: SearchQuery): Promise<IntelResult[]> {
    const res = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": this.apiKey },
      body: JSON.stringify({
        query: query.terms.join(" "),
        numResults: query.limit ?? 20,
        includeDomains: (query.sites ?? LINKEDIN_POST_SITES).map(toDomain),
        startPublishedDate: query.since?.toISOString(),
        contents: { text: true },
      }),
    });

    if (!res.ok) {
      throw new IntelSearchError(
        `Exa search failed with ${res.status}.`,
        res.status,
        await res.text(),
      );
    }

    const body = (await res.json()) as { results?: RawExaResult[] };
    return (body.results ?? []).map((r) => ({
      tier: this.tier,
      url: r.url ?? null,
      title: r.title ?? null,
      content: r.text ?? null,
      author: r.author ?? null,
      publishedAt: r.publishedDate ? new Date(r.publishedDate) : null,
      // Search indexes don't expose engagement counts. Null rather than 0 —
      // "unknown" and "nobody engaged" are different facts.
      reactionCount: null,
      commentCount: null,
      provider: this.name,
    }));
  }
}

interface RawExaResult {
  url?: string;
  title?: string;
  text?: string;
  author?: string;
  publishedDate?: string;
}

export class IntelSearchError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = "IntelSearchError";
  }
}

export class Tier3DisabledError extends Error {
  constructor() {
    super(
      "Tier 3 public scraping is disabled. Set INTEL_TIER3_SCRAPING_ENABLED=true to enable it — " +
        "this runs against LinkedIn's User Agreement and is a business decision, not a technical one.",
    );
    this.name = "Tier3DisabledError";
  }
}

function toDomain(site: string): string {
  return site.split("/")[0] ?? site;
}

export function createProvider(config: IntelConfig): IntelProvider {
  switch (config.provider) {
    case "exa":
      return new ExaProvider(config.apiKey);
    case "brave":
    case "serpapi":
      throw new IntelSearchError(
        `Provider "${config.provider}" is configured but not yet implemented. Use "exa".`,
      );
  }
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): IntelConfig {
  const provider = (env.INTEL_SEARCH_PROVIDER ?? "exa") as IntelConfig["provider"];
  const apiKey = env.INTEL_SEARCH_API_KEY;
  if (!apiKey) {
    throw new IntelSearchError("INTEL_SEARCH_API_KEY is not set.");
  }
  return {
    provider,
    apiKey,
    tier3ScrapingEnabled: env.INTEL_TIER3_SCRAPING_ENABLED === "true",
  };
}
