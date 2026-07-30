import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Loads .env before any test module imports Prisma.
 *
 * This runs as a vitest `setupFiles` entry rather than a `beforeAll` hook: the
 * Prisma client resolves DATABASE_URL on its first query, and a hook that runs
 * after module evaluation is a race that fails confusingly.
 *
 * It fails loudly. A silently-skipped env load produces fifteen identical
 * "environment variable not found" errors that look like a database problem.
 */

function findEnvFile(start: string): string | null {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, ".env");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const envPath = findEnvFile(process.cwd());

if (envPath) {
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    // Real environment wins, so CI can override without editing the file.
    if (process.env[key!] !== undefined) continue;
    process.env[key!] = value!.trim().replace(/^["']|["']$/g, "");
  }
}

if (!process.env.DATABASE_URL) {
  throw new Error(
    "Integration tests need DATABASE_URL. Start the database with `pnpm db:up` and create .env from .env.example.",
  );
}

if (!process.env.TOKEN_ENCRYPTION_KEY) {
  throw new Error("Integration tests need TOKEN_ENCRYPTION_KEY (openssl rand -base64 32).");
}
