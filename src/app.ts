import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import fastifyStatic from "@fastify/static";
import { ControlAppError, type ApiErrorBody } from "./http/errors.js";
import { newRequestId } from "./http/request-id.js";
import { registerInstanceRoutes } from "./routes/instances.js";
import { registerCardRequestRoutes } from "./routes/card-requests.js";
import type { ControlDatabase } from "./db/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export type BuildAppOptions = {
  db: ControlDatabase;
  adminToken: string;
  testRoutes?: boolean;
};

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.setErrorHandler((error, _request, reply) => {
    const requestId = newRequestId();
    const known = error instanceof ControlAppError;
    if (!known) {
      console.error("[ERROR]", error);
    }
    const body: ApiErrorBody = {
      code: known ? error.code : "INTERNAL_ERROR",
      message: known ? error.publicMessage : "Erreur interne",
      request_id: requestId,
      retryable: known ? error.retryable : false
    };
    reply.status(known ? error.statusCode : 500).send(body);
  });

  app.get("/health", async () => ({ status: "ok" as const }));

  app.get("/ready", async () => ({ status: "ready" as const }));

  registerInstanceRoutes(app, options.db, options.adminToken);
  registerCardRequestRoutes(app, options.db, options.adminToken);

  await app.register(fastifyStatic, {
    root: join(__dirname, "../public"),
    prefix: "/"
  });

  if (options.testRoutes) {
    app.get("/__test/error", async () => {
      throw new ControlAppError(400, "VALIDATION_INVALID", "Donnée invalide", false);
    });
  }

  return app;
}
