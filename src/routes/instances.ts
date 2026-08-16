import { randomUUID, randomBytes } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { ControlAppError } from "../http/errors.js";
import { requireAdminToken } from "../auth/admin.js";
import type { JsonStore, Instance } from "../store.js";

const createSchema = z.object({
  school_name: z.string().min(1),
  school_slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
  domain: z.string().min(1),
  api_base: z.string().url(),
  supabase_url: z.string().url()
});

function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export function registerInstanceRoutes(app: FastifyInstance, store: JsonStore, adminToken: string): void {
  app.get("/instances", async (request) => {
    requireAdminToken(request, adminToken);
    return { data: store.getInstances() };
  });

  app.get("/instances/:id", async (request) => {
    requireAdminToken(request, adminToken);
    const { id } = request.params as { id: string };
    const instance = store.getInstanceById(id);
    if (!instance) throw new ControlAppError(404, "NOT_FOUND", "Instance non trouvée", false);
    return { data: instance };
  });

  app.post("/instances", async (request) => {
    requireAdminToken(request, adminToken);
    const body = createSchema.parse(request.body);
    if (store.getInstanceBySlug(body.school_slug)) {
      throw new ControlAppError(400, "VALIDATION_INVALID", "Ce slug d'école existe déjà", false);
    }
    const now = new Date().toISOString();
    const instance: Instance = {
      id: randomUUID(),
      ...body,
      status: "active",
      setup_token: generateToken(),
      hmac_secret: generateToken(),
      created_at: now,
      updated_at: now
    };
    store.createInstance(instance);
    return { data: instance };
  });

  app.post("/instances/:id/token", async (request) => {
    requireAdminToken(request, adminToken);
    const { id } = request.params as { id: string };
    const instance = store.getInstanceById(id);
    if (!instance) throw new ControlAppError(404, "NOT_FOUND", "Instance non trouvée", false);
    const updated = store.updateInstance(id, { setup_token: generateToken() });
    return { data: updated };
  });

  app.post("/instances/:id/revoke-hmac", async (request) => {
    requireAdminToken(request, adminToken);
    const { id } = request.params as { id: string };
    const instance = store.getInstanceById(id);
    if (!instance) throw new ControlAppError(404, "NOT_FOUND", "Instance non trouvée", false);
    const updated = store.updateInstance(id, { hmac_secret: generateToken() });
    return { data: updated };
  });

  app.post("/instances/:id/block", async (request) => {
    requireAdminToken(request, adminToken);
    const { id } = request.params as { id: string };
    const instance = store.getInstanceById(id);
    if (!instance) throw new ControlAppError(404, "NOT_FOUND", "Instance non trouvée", false);
    const updated = store.updateInstance(id, { status: "blocked" });
    return { data: updated };
  });

  app.post("/instances/:id/unblock", async (request) => {
    requireAdminToken(request, adminToken);
    const { id } = request.params as { id: string };
    const instance = store.getInstanceById(id);
    if (!instance) throw new ControlAppError(404, "NOT_FOUND", "Instance non trouvée", false);
    const updated = store.updateInstance(id, { status: "active" });
    return { data: updated };
  });
}
