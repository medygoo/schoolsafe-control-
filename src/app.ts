import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import { ControlAppError, type ApiErrorBody } from "./http/errors.js";
import { newRequestId } from "./http/request-id.js";
import { registerInstanceRoutes } from "./routes/instances.js";
import { registerCardRequestRoutes } from "./routes/card-requests.js";
import type { JsonStore } from "./store.js";

export type BuildAppOptions = {
  store: JsonStore;
  adminToken: string;
  testRoutes?: boolean;
};

export function buildApp(options: BuildAppOptions): FastifyInstance {
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

  registerInstanceRoutes(app, options.store, options.adminToken);
  registerCardRequestRoutes(app, options.store, options.adminToken);

  if (options.testRoutes) {
    app.get("/__test/error", async () => {
      throw new ControlAppError(400, "VALIDATION_INVALID", "Donnée invalide", false);
    });
  }

  return app;
}
