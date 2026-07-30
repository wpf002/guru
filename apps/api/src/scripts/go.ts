/**
 * `pnpm go` — everything between "I have an Anthropic key" and "I'm using Guru".
 *
 * Checks the key, checks the database, creates a local user, prints one URL.
 * Exists because the alternative was a numbered list the user had to execute by
 * hand, and each hand-executed step is a place to get lost.
 */

import { prisma } from "@guru/db";

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      "\n  Missing ANTHROPIC_API_KEY.\n\n" +
        "  1. Get a key at console.anthropic.com → API keys → Create key\n" +
        "  2. Add this line to .env:\n\n" +
        '     ANTHROPIC_API_KEY="sk-ant-..."\n\n' +
        "  Then run `pnpm go` again.\n",
    );
    process.exit(1);
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    console.error("\n  Database is not reachable. Run `pnpm db:up`, then `pnpm go` again.\n");
    process.exit(1);
  }

  const user = await prisma.user.upsert({
    where: { email: "local@guru.local" },
    update: {},
    create: { email: "local@guru.local", name: "Me" },
  });

  const hasArchive = await prisma.archiveSnapshot.count({
    where: { userId: user.id, status: { in: ["FIRST_INSTALLMENT_INGESTED", "COMPLETE"] } },
  });

  console.log(`
  Ready.

  Start the app:     pnpm dev
  Then open:         http://localhost:3000/intake?userId=${user.id}
${
  hasArchive
    ? ""
    : `
  Optional, better results: upload your LinkedIn archive first at
                     http://localhost:3000/archive?userId=${user.id}
  (LinkedIn → Settings → Data privacy → Get a copy of your data → larger archive)
`
}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
