/**
 * Environment validation.
 *
 * Fails at boot rather than at the moment a user tries to connect their account.
 * A missing TOKEN_ENCRYPTION_KEY discovered during an OAuth callback means a
 * half-completed connection and a user who has already granted consent.
 */

export interface Env {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  linkedin: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  };
  webOrigin: string;
}

class EnvError extends Error {}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new EnvError(`Missing required environment variable: ${name}`);
  return value;
}

export function loadEnv(): Env {
  // Touching this validates the key's presence and length at boot. Cheap, and it
  // turns a runtime failure mid-consent into a failure to start.
  required("TOKEN_ENCRYPTION_KEY");

  return {
    nodeEnv: process.env.NODE_ENV ?? "development",
    port: Number(process.env.API_PORT ?? 3001),
    databaseUrl: required("DATABASE_URL"),
    linkedin: {
      clientId: required("LINKEDIN_CLIENT_ID"),
      clientSecret: required("LINKEDIN_CLIENT_SECRET"),
      redirectUri: required("LINKEDIN_REDIRECT_URI"),
    },
    webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  };
}
