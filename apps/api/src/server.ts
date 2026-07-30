import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import { loadEnv } from "./env.js";
import { linkedinAuthRoutes } from "./routes/linkedin-auth.js";

export async function buildServer() {
  const env = loadEnv();

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
        "*.body",
      ],
    },
  });

  await app.register(cors, { origin: env.webOrigin, credentials: true });
  await app.register(cookie);

  app.get("/health", async () => ({ ok: true }));

  await linkedinAuthRoutes(app, env);

  return { app, env };
}

const isEntrypoint = process.argv[1]?.endsWith("server.ts") || process.argv[1]?.endsWith("server.js");

if (isEntrypoint) {
  buildServer()
    .then(({ app, env }) => app.listen({ port: env.port, host: "0.0.0.0" }))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
