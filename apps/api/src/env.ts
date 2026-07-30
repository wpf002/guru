/**
 * Environment validation.
 *
 * Fails at boot rather than at the moment a user tries to connect their account.
 * A missing TOKEN_ENCRYPTION_KEY discovered during an OAuth callback means a
 * half-completed connection and a user who has already granted consent.
 *
 * Google and the intel layer are optional: declining Gmail costs the user a
 * manual archive download, not the product, so a deployment without those
 * credentials must still start.
 */

export interface Env {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  /**
   * Null when LinkedIn is not configured. Publishing is then unavailable and
   * everything else still works — the archive is a ZIP upload, and intake,
   * brief, roadmap and drafting are all local. Requiring credentials at boot
   * made a Developer Portal app an accidental prerequisite for the whole
   * product; it never was one.
   */
  linkedin: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    /**
     * Set only once the Community Management API shows Approved in the
     * Developer Portal. Requesting `w_member_social_feed` before then makes
     * LinkedIn reject the whole authorization request, so this defaults off and
     * the product ships with publishing working and engagement gated.
     */
    feedScopesApproved: boolean;
  } | null;
  google: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  } | null;
  intel: {
    provider: "exa" | "brave" | "serpapi";
    apiKey: string;
    tier3ScrapingEnabled: boolean;
  } | null;
  webOrigin: string;
}

class EnvError extends Error {}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new EnvError(`Missing required environment variable: ${name}`);
  return value;
}

function optionalGroup<T>(names: string[], build: () => T): T | null {
  const present = names.filter((n) => Boolean(process.env[n]));
  if (present.length === 0) return null;
  if (present.length !== names.length) {
    // A half-configured integration fails at first use, which is a confusing
    // place to learn about a typo'd variable name.
    throw new EnvError(
      `Partially configured integration. Set all of [${names.join(", ")}] or none.`,
    );
  }
  return build();
}

export function loadEnv(): Env {
  // Touching this validates the key's presence and length at boot. Cheap, and it
  // turns a runtime failure mid-consent into a failure to start.
  required("TOKEN_ENCRYPTION_KEY");

  return {
    nodeEnv: process.env.NODE_ENV ?? "development",
    port: Number(process.env.API_PORT ?? 3001),
    databaseUrl: required("DATABASE_URL"),
    linkedin: optionalGroup(
      ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET", "LINKEDIN_REDIRECT_URI"],
      () => ({
        clientId: process.env.LINKEDIN_CLIENT_ID!,
        clientSecret: process.env.LINKEDIN_CLIENT_SECRET!,
        redirectUri: process.env.LINKEDIN_REDIRECT_URI!,
        feedScopesApproved: process.env.LINKEDIN_FEED_SCOPES_APPROVED === "true",
      }),
    ),
    google: optionalGroup(
      ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"],
      () => ({
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        redirectUri: process.env.GOOGLE_REDIRECT_URI!,
      }),
    ),
    intel: optionalGroup(["INTEL_SEARCH_API_KEY"], () => ({
      provider: (process.env.INTEL_SEARCH_PROVIDER ?? "exa") as "exa" | "brave" | "serpapi",
      apiKey: process.env.INTEL_SEARCH_API_KEY!,
      // Off unless explicitly enabled. A business decision, not a technical one.
      tier3ScrapingEnabled: process.env.INTEL_TIER3_SCRAPING_ENABLED === "true",
    })),
    webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  };
}
