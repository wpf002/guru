import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { GuruLlm, prismaGenerationSink } from "@guru/llm";
import { loadEnv } from "./env.js";
import { bootstrapRoutes } from "./routes/bootstrap.js";
import { linkedinAuthRoutes } from "./routes/linkedin-auth.js";
import { archiveRoutes } from "./routes/archive.js";
import { intakeRoutes } from "./routes/intake.js";
import { strategyRoutes } from "./routes/strategy.js";
import { engagementRoutes } from "./routes/engagement.js";
import { feedbackRoutes } from "./routes/feedback.js";
import { autonomyRoutes } from "./routes/autonomy.js";
import { schedulerStatus, startScheduler, tick } from "./services/scheduler.js";

export async function buildServer() {
  const env = loadEnv();
  const llm = new GuruLlm(prismaGenerationSink);

  const app = Fastify({
    logger: {
      level: env.nodeEnv === "production" ? "info" : "debug",
      // Token material must never reach a log line, including via an error
      // object that happens to carry a request body.
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "*.accessToken",
        "*.refreshToken",
        "*.accessTokenCipher",
        "*.refreshTokenCipher",
        "*.client_secret",
        "*.authorization_token",
        "*.body",
      ],
    },
    // Archives run to hundreds of megabytes.
    bodyLimit: 512 * 1024 * 1024,
  });

  await app.register(cors, { origin: env.webOrigin, credentials: true });
  await app.register(cookie);
  await app.register(multipart);

  app.get("/health", async () => ({ ok: true }));

  await bootstrapRoutes(app);
  await linkedinAuthRoutes(app, env);
  await archiveRoutes(app, env);
  await intakeRoutes(app, llm);
  await strategyRoutes(app, env, llm);
  await engagementRoutes(app, env, llm);
  await feedbackRoutes(app, llm);
  await autonomyRoutes(app, env, llm);

  // Scheduler status and a manual trigger. The trigger exists because "wait
  // fifteen minutes to see if the watcher works" is a bad debugging loop.
  app.get<{ Querystring: { userId?: string } }>("/scheduler", async (request, reply) =>
    reply.send(await schedulerStatus(request.query.userId)),
  );
  app.post("/scheduler/tick", async (_request, reply) => {
    await tick(env, llm);
    return reply.send(await schedulerStatus());
  });

  // Off in tests: an interval firing mid-suite would race the truncation.
  const scheduler = env.nodeEnv === "test" ? null : startScheduler(env, llm);

  return { app, env, scheduler };
}

const isEntrypoint =
  process.argv[1]?.endsWith("server.ts") || process.argv[1]?.endsWith("server.js");

if (isEntrypoint) {
  buildServer()
    .then(({ app, env }) => app.listen({ port: env.port, host: "0.0.0.0" }))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
