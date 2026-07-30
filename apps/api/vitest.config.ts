import { defineConfig } from "vitest/config";

/**
 * Integration tests run against a real Postgres. They share one database, so
 * they run in a single thread — parallel workers truncating each other's tables
 * would produce failures that look like logic bugs.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    // Must load before any module imports Prisma.
    setupFiles: ["src/__tests__/setup.ts"],
    environment: "node",
    pool: "threads",
    poolOptions: { threads: { singleThread: true } },
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
