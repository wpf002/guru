import type { FastifyInstance } from "fastify";
import { prisma } from "@guru/db";

/**
 * Local bootstrap — create a user without LinkedIn.
 *
 * Everything in §1.1–§1.5 works without the LinkedIn API: the archive is a ZIP
 * upload, and intake, brief, roadmap, drafting and refinement are all local.
 * Only publishing needs a connected account.
 *
 * Until this route existed, the only way to get a User row was the OAuth
 * callback, which made a Developer Portal app an accidental prerequisite for
 * the entire product. It never was one — that was a build-order assumption, not
 * a real dependency.
 *
 * Connecting LinkedIn later attaches to the same user; nothing is re-done.
 */
export async function bootstrapRoutes(app: FastifyInstance) {
  /**
   * Idempotent on email, so re-running it during setup returns the same user
   * rather than accumulating duplicates.
   */
  app.post<{ Body: { email?: string; name?: string } }>(
    "/bootstrap/user",
    async (request, reply) => {
      const email = request.body?.email?.trim() || "local@guru.local";
      const name = request.body?.name?.trim() || null;

      const user = await prisma.user.upsert({
        where: { email },
        update: name ? { name } : {},
        create: { email, name },
      });

      return reply.send({
        user,
        next: {
          archive: `/archive?userId=${user.id}`,
          intake: `/intake?userId=${user.id}`,
          review: `/review?userId=${user.id}`,
        },
        note: "LinkedIn is only needed to publish. Everything up to that works now.",
      });
    },
  );

  /** Who exists locally — saves digging the id out of psql. */
  app.get("/bootstrap/users", async (_request, reply) => {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
        linkedinAccount: { select: { name: true, scopes: true, connectedAt: true } },
      },
    });
    return reply.send({ users });
  });
}
