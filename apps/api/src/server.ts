import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { GuruLlm, prismaGenerationSink } from "@guru/llm";
import { loadEnv } from "./env.js";
import { linkedinAuthRoutes } from "./routes/linkedin-auth.js";
import { authRoutes } from "./routes/auth.js";
import { archiveRoutes } from "./routes/archive.js";
import { intakeRoutes } from "./routes/intake.js";
import { strategyRoutes } from "./routes/strategy.js";
import { engagementRoutes } from "./routes/engagement.js";
import { feedbackRoutes } from "./routes/feedback.js";
import { autonomyRoutes } from "./routes/autonomy.js";
import { schedulerStatus, startScheduler, tick } from "./services/scheduler.js";
import { registerAuth, requireUser } from "./auth.js";

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

  /**
   * Treat an empty JSON body as `{}` rather than a 400.
   *
   * Fastify's default parser rejects `Content-Type: application/json` with no
   * body — "Body cannot be empty when content-type is set to 'application/json'"
   * — before the route runs. Several routes legitimately take no body now that
   * the user comes from the session, and a browser `fetch` that still declares
   * JSON is a completely reasonable thing for a client to send. Failing at the
   * parser makes it look like the endpoint does not exist.
   */
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_request, body, done) => {
      const text = (body as string).trim();
      if (text === "") return done(null, {});
      try {
        done(null, JSON.parse(text));
      } catch {
        const err = new Error("Body is not valid JSON.") as Error & { statusCode?: number };
        err.statusCode = 400;
        done(err, undefined);
      }
    },
  );

  // Resolves the session cookie on every request and installs the 401/404
  // handling for UnauthorizedError / ForbiddenError. Registered before any
  // route so a route added later is anonymous until it calls requireUser.
  await registerAuth(app);

  app.get("/health", async () => ({ ok: true }));

  await authRoutes(app, env);
  await linkedinAuthRoutes(app, env);
  await archiveRoutes(app, env);
  await intakeRoutes(app, llm);
  await strategyRoutes(app, env, llm);
  await engagementRoutes(app, env, llm);
  await feedbackRoutes(app, llm);
  await autonomyRoutes(app, env, llm);

  // Scheduler status and a manual trigger. The trigger exists because "wait
  // fifteen minutes to see if the watcher works" is a bad debugging loop.
  app.get("/scheduler", async (request, reply) =>
    reply.send(await schedulerStatus(requireUser(request))),
  );
  // Runs the whole sweep, so it stays signed-in-only rather than an open
  // endpoint anyone can use to make the server do work.
  app.post("/scheduler/tick", async (request, reply) => {
    const userId = requireUser(request);
    await tick(env, llm);
    return reply.send(await schedulerStatus(userId));
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
