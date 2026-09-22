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
is_blocked: false,
blocked_at: null,
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

// Endpoint pour SchoolSafe : valider le setup token (consommation atomique)
app.post("/instances/validate-setup-token", async (request) => {
const { setup_token } = request.body as { setup_token?: string };
if (!setup_token) {
throw new ControlAppError(400, "VALIDATION_INVALID", "setup_token requis", false);
}
// Consommation atomique : retourne l'instance si le token était valide et non consommé
const consumedInstance = await db.consumeSetupToken(setup_token);
if (!consumedInstance) {
throw new ControlAppError(404, "NOT_FOUND", "Token invalide ou déjà consommé", false);
}
// Vérifier si la période de grâce est expirée (si on est en grace)
if (consumedInstance.status === "grace" && consumedInstance.grace_ends_at) {
const graceEnds = new Date(consumedInstance.grace_ends_at);
if (new Date() > graceEnds) {
throw new ControlAppError(400, "TRIAL_EXPIRED", "La période de grâce est expirée", false);
}
}
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
});

// Endpoint pour activer une instance (admin/commercial)
app.post("/instances/:id/activate", async (request) => {
requireAdminToken(request, adminToken);
const { id } = request.params as { id: string };
const instance = await db.getInstanceById(id);
if (!instance) throw new ControlAppError(404, "NOT_FOUND", "Instance non trouvée", false);
if (instance.status !== "trial" && instance.status !== "grace" && instance.status !== "suspended") {
throw new ControlAppError(400, "INVALID_STATE", "L'instance n'est pas éligible à l'activation (doit être en trial, grace ou suspended)", false);
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