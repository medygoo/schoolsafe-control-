import { randomUUID, randomBytes } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { ControlAppError } from "../http/errors.js";
import { requireAdminToken } from "../auth/admin.js";
import type { ControlDatabase, Instance } from "../db/index.js";

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

export function registerInstanceRoutes(app: FastifyInstance, db: ControlDatabase, adminToken: string): void {
  app.get("/instances", async (request) => {
    requireAdminToken(request, adminToken);
    return { data: await db.getInstances() };
  });

  app.get("/instances/:id", async (request) => {
    requireAdminToken(request, adminToken);
    const { id } = request.params as { id: string };
    const instance = await db.getInstanceById(id);
    if (!instance) throw new ControlAppError(404, "NOT_FOUND", "Instance non trouvée", false);
    return { data: instance };
  });

  app.post("/instances", async (request) => {
    requireAdminToken(request, adminToken);
    const body = createSchema.parse(request.body);
    const existing = await db.getInstanceBySlug(body.school_slug);
    if (existing) {
      throw new ControlAppError(400, "VALIDATION_INVALID", "Ce slug d'école existe déjà", false);
    }
    const now = new Date().toISOString();
    const trialStart = new Date();
    const graceEnds = new Date(trialStart.getTime() + 17 * 24 * 60 * 60 * 1000); // 14 days trial + 3 days grace
    const instance = await db.createInstance({
      ...body,
      status: "trial",
      setup_token: generateToken(),
      hmac_secret: generateToken(),
      trial_started_at: trialStart.toISOString(),
      grace_ends_at: graceEnds.toISOString(),
      activated_at: null,
      created_at: now,
      updated_at: now
    });
    return { data: instance };
  });

  app.post("/instances/:id/token", async (request) => {
    requireAdminToken(request, adminToken);
    const { id } = request.params as { id: string };
    const instance = await db.getInstanceById(id);
    if (!instance) throw new ControlAppError(404, "NOT_FOUND", "Instance non trouvée", false);
    const updated = await db.updateInstance(id, { setup_token: generateToken() });
    return { data: updated };
  });

  app.post("/instances/:id/revoke-hmac", async (request) => {
    requireAdminToken(request, adminToken);
    const { id } = request.params as { id: string };
    const instance = await db.getInstanceById(id);
    if (!instance) throw new ControlAppError(404, "NOT_FOUND", "Instance non trouvée", false);
    const updated = await db.updateInstance(id, { hmac_secret: generateToken() });
    return { data: updated };
  });

  app.post("/instances/:id/block", async (request) => {
    requireAdminToken(request, adminToken);
    const { id } = request.params as { id: string };
    const instance = await db.getInstanceById(id);
    if (!instance) throw new ControlAppError(404, "NOT_FOUND", "Instance non trouvée", false);
    const updated = await db.updateInstance(id, { status: "blocked" });
    return { data: updated };
  });

  app.post("/instances/:id/unblock", async (request) => {
    requireAdminToken(request, adminToken);
    const { id } = request.params as { id: string };
    const instance = await db.getInstanceById(id);
    if (!instance) throw new ControlAppError(404, "NOT_FOUND", "Instance non trouvée", false);
    const updated = await db.updateInstance(id, { status: "active" });
    return { data: updated };
  });

  // Endpoint pour SchoolSafe : valider le setup token et activer l'instance
  app.post("/instances/validate-setup-token", async (request) => {
    const { setup_token } = request.body as { setup_token?: string };
    if (!setup_token) {
      throw new ControlAppError(400, "VALIDATION_INVALID", "setup_token requis", false);
    }
    const instance = await db.getInstanceBySetupToken(setup_token);
    if (!instance) {
      throw new ControlAppError(404, "NOT_FOUND", "Token invalide ou déjà consommé", false);
    }
    if (instance.status !== "trial" && instance.status !== "grace") {
      throw new ControlAppError(400, "INVALID_STATE", "L'instance n'est pas en période d'essai ou de grâce", false);
    }
    // Vérifier si la période de grâce est expirée
    if (instance.status === "grace" && instance.grace_ends_at) {
      const graceEnds = new Date(instance.grace_ends_at);
      if (new Date() > graceEnds) {
        throw new ControlAppError(400, "TRIAL_EXPIRED", "La période de grâce est expirée", false);
      }
    }
    // Consommer le token (le passer à null) sans changer le statut
    const consumed = await db.updateInstance(instance.id, { setup_token: null });
    if (!consumed) {
      throw new ControlAppError(500, "INTERNAL_ERROR", "Erreur lors de la consommation du token", false);
    }
    return {
      data: {
        instance_id: consumed.id,
        school_name: consumed.school_name,
        domain: consumed.domain,
        api_base: consumed.api_base,
        supabase_url: consumed.supabase_url,
        hmac_secret: consumed.hmac_secret,
        status: consumed.status,
        trial_started_at: consumed.trial_started_at,
        grace_ends_at: consumed.grace_ends_at
      }
    };
  });

  // Endpoint pour activer une instance suspendue (admin)
  app.post("/instances/:id/activate", async (request) => {
    requireAdminToken(request, adminToken);
    const { id } = request.params as { id: string };
    const instance = await db.getInstanceById(id);
    if (!instance) throw new ControlAppError(404, "NOT_FOUND", "Instance non trouvée", false);
    if (instance.status !== "suspended") {
      throw new ControlAppError(400, "INVALID_STATE", "L'instance n'est pas suspendue", false);
    }
    const updated = await db.activateInstance(id);
    return { data: updated };
  });

  // Endpoint pour forcer la suspension d'une instance (admin)
  app.post("/instances/:id/suspend", async (request) => {
    requireAdminToken(request, adminToken);
    const { id } = request.params as { id: string };
    const instance = await db.getInstanceById(id);
    if (!instance) throw new ControlAppError(404, "NOT_FOUND", "Instance non trouvée", false);
    const updated = await db.suspendInstance(id);
    return { data: updated };
  });

  // Endpoint pour vérifier et expirer les trials (peut être appelé par cron ou manuellement)
  app.post("/instances/check-expired-trials", async (request) => {
    requireAdminToken(request, adminToken);
    await db.checkAndExpireTrials();
    return { message: "Vérification des trials expirés effectuée" };
  });
}
