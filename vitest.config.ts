import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
    // Integration tests need a live database, so they are a separate command
    // (`pnpm test:integration`) rather than part of the default run.
    exclude: ["**/node_modules/**", "**/*.integration.test.ts"],
    environment: "node",
  },
});
