import { PrismaClient } from "@prisma/client";

export * from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __guruPrisma: PrismaClient | undefined;
}

/**
 * Single client per process. Next.js dev reloads the module graph on every edit,
 * which without this would open a new pool each time until Postgres refuses.
 */
export const prisma: PrismaClient =
  globalThis.__guruPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__guruPrisma = prisma;
}
