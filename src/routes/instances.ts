import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { ControlAppError } from "../http/errors.js";
import { requireAdminToken } from "../auth/admin.js";
import type { ControlDatabase } from "../db/index.js";
import { InstanceStateService } from "../domain/instance-state.js";
const createSchema = z.object({
school_name: z.string().min(1),
school_slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
domain: z.string().min(1),
api_base: z.string().url(),
supabase_url: z.string().url()
});
export function registerInstanceRoutes(app: FastifyInstance, db: ControlDatabase, adminToken: string): void {
const stateService = new InstanceStateService(db);
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
try {
const instance = await stateService.createTrial(body);
return { data: instance };
} catch (err) {
throw new ControlAppError(500, "INTERNAL_ERROR", "Échec de la création de l'instance", false);
}
});
app.post("/instances/:id/token", async (request) => {
requireAdminToken(request, adminToken);
const { id } = request.params as { id: string };
try {
const updated = await stateService.regenerateSetupToken(id);
return { data: updated };
} catch (err: any) {
if (err.message === "INSTANCE_NOT_FOUND") throw new ControlAppError(404, "NOT_FOUND", "Instance non trouvée", false);
if (err.message.includes("INVALID_STATE") || err.message === "TRIAL_EXPIRED") {
throw new ControlAppError(400, "INVALID_STATE", err.message, false);
}
throw new ControlAppError(500, "INTERNAL_ERROR", "Échec de la régénération du token", false);
}
});
app.post("/instances/:id/revoke-hmac", async (request) => {
requireAdminToken(request, adminToken);
const { id } = request.params as { id: string };
try {
const updated = await stateService.rotateHmacSecret(id);
return { data: updated };
} catch (err: any) {
if (err.message === "INSTANCE_NOT_FOUND") throw new ControlAppError(404, "NOT_FOUND", "Instance non trouvée", false);
throw new ControlAppError(500, "INTERNAL_ERROR", "Échec de la rotation HMAC", false);
}
});
// Endpoint pour SchoolSafe : valider le setup token (consommation atomique)
app.post("/instances/validate-setup-token", async (request) => {
const { setup_token } = request.body as { setup_token?: string };
if (!setup_token) {
throw new ControlAppError(400, "VALIDATION_INVALID", "setup_token requis", false);
}
try {
const consumedInstance = await stateService.consumeSetupToken(setup_token);
return {
data: {
instance_id: consumedInstance.id,
school_name: consumedInstance.school_name,
domain: consumedInstance.domain,
api_base: consumedInstance.api_base,
supabase_url: consumedInstance.supabase_url,
hmac_secret: consumedInstance.hmac_secret,
status: consumedInstance.status,
trial_started_at: consumedInstance.trial_started_at,
grace_ends_at: consumedInstance.grace_ends_at
}
};
} catch (err: any) {
if (err.message === "TOKEN_INVALID_OR_CONSUMED") {
throw new ControlAppError(404, "NOT_FOUND", "Token invalide ou déjà consommé", false);
}
throw new ControlAppError(500, "INTERNAL_ERROR", "Échec de la validation du token", false);
}
});
// Endpoint pour activer une instance (admin/commercial)
app.post("/instances/:id/activate", async (request) => {
requireAdminToken(request, adminToken);
const { id } = request.params as { id: string };
try {
const updated = await stateService.activateCommercially(id);
return { data: updated };
} catch (err: any) {
if (err.message === "INSTANCE_NOT_FOUND") throw new ControlAppError(404, "NOT_FOUND", "Instance non trouvée", false);
if (err.message.startsWith("INVALID_STATE")) {
throw new ControlAppError(400, "INVALID_STATE", err.message, false);
}
throw new ControlAppError(500, "INTERNAL_ERROR", "Échec de l'activation", false);
}
});
// Endpoint pour forcer la suspension d'une instance (admin)
app.post("/instances/:id/suspend", async (request) => {
requireAdminToken(request, adminToken);
const { id } = request.params as { id: string };
try {
const updated = await stateService.suspendCommercially(id);
return { data: updated };
} catch (err: any) {
if (err.message === "INSTANCE_NOT_FOUND") throw new ControlAppError(404, "NOT_FOUND", "Instance non trouvée", false);
if (err.message.startsWith("INVALID_STATE")) {
throw new ControlAppError(400, "INVALID_STATE", err.message, false);
}
throw new ControlAppError(500, "INTERNAL_ERROR", "Échec de la suspension", false);
}
});
// Endpoint pour vérifier et expirer les trials (peut être appelé par cron ou manuellement)
app.post("/instances/check-expired-trials", async (request) => {
requireAdminToken(request, adminToken);
await stateService.refreshDueLifecycle();
return { message: "Vérification des trials expirés effectuée" };
});
}