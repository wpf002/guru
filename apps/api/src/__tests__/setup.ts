import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Loads .env before any test module imports Prisma.
 *
 * This runs as a vitest `setupFiles` entry rather than a `beforeAll` hook: the
 * Prisma client resolves DATABASE_URL on its first query, and a hook that runs
 * after module evaluation is a race that fails confusingly.
 *
 * It fails loudly. A silently-skipped env load produces a screenful of
 * identical "environment variable not found" errors that look like a database
 * problem.
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

/**
 * Redirect to a dedicated test database.
 *
 * These tests TRUNCATE every table between cases. Pointed at the development
 * database that wipes real work — which is exactly what happened once: a test
 * run deleted the user someone was mid-intake with, and the app then failed on
 * a foreign key with no obvious connection to the cause.
 *
 * `TEST_DATABASE_URL` wins if set. Otherwise the configured database name gets
 * a `_test` suffix, so the default is safe without anyone having to know this
 * hazard exists.
 */
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
} else {
  const url = new URL(process.env.DATABASE_URL);
  const name = url.pathname.replace(/^\//, "");
  if (!name.endsWith("_test")) {
    url.pathname = `/${name}_test`;
    process.env.DATABASE_URL = url.toString();
  }
}

// Last line of defence: refuse to run destructive tests against a database that
// is not clearly a test database.
if (!/_test(\?|$)/.test(new URL(process.env.DATABASE_URL).pathname + "?")) {
  throw new Error(
    `Refusing to run integration tests against "${process.env.DATABASE_URL}" — ` +
      "these tests truncate every table. Point TEST_DATABASE_URL at a database whose name ends in _test.",
  );
}
