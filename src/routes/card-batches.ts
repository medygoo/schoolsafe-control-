import { z } from "zod";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ControlAppError } from "../http/errors.js";
import { authenticateHmac } from "../auth/hmac.js";
import { requireAdminToken } from "../auth/admin.js";
import type { ControlDatabase } from "../db/index.js";

const createBatchSchema = z.object({
  school_id: z.string().min(1).optional(),
  batch_id: z.string().min(1).max(128),
  version: z.number().int().min(1),
  card_count: z.number().int().min(1),
  r2_key: z.string().min(1),
  zip_signed_url: z.string().url(),
  signed_url_expires_at: z.string().datetime(),
  zip_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  metadata: z.record(z.unknown()).default({})
});

export function registerCardBatchRoutes(app: FastifyInstance, db: ControlDatabase, adminToken: string): void {
  // Réception d'un lot ZIP depuis un VPS école (authentifiée HMAC)
  app.post("/card-print-batches", {
    preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
      await authenticateHmac(request, reply, db);
    }
  }, async (request) => {
    const instanceId = request.headers["x-schoolsafe-instance"] as string;
    const body = createBatchSchema.parse(request.body);
    const ids = await db.getAuthorizedSchoolIds(instanceId); const schoolId=ids[0];
    if (ids.length!==1 || !schoolId || (body.school_id && body.school_id!==schoolId)) throw new ControlAppError(403,"PERMISSION_DENIED","Ecole non autorisee",false);
    try {
      const batch = await db.createCardPrintBatch({ instance_id: instanceId, ...body, school_id: schoolId, status:"pending" });
      return { data: batch };
    } catch (err) {
      // Un lot (instance, batch_id, version) rejoué est refusé proprement.
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("duplicate key") || message.includes("UNIQUE constraint")) {
        throw new ControlAppError(409, "VALIDATION_INVALID", "Ce lot a déjà été reçu (même batch_id/version)", false);
      }
      throw err;
    }
  });

  // Liste admin des lots
  app.get("/card-print-batches", async (request) => {
    requireAdminToken(request, adminToken);
    const { status, instance_id } = request.query as { status?: string; instance_id?: string };
    return { data: await db.getCardPrintBatches({ status, instance_id }) };
  });

  // Marquer comme imprimé
  app.post("/card-print-batches/:id/print", async (request) => {
    requireAdminToken(request, adminToken);
    const { id } = request.params as { id: string };
    const updated = await db.updateCardPrintBatch(id, { status: "printed" });
    if (!updated) throw new ControlAppError(404, "NOT_FOUND", "Lot non trouvé", false);
    return { data: updated };
  });

  // Marquer comme échoué
  app.post("/card-print-batches/:id/fail", async (request) => {
    requireAdminToken(request, adminToken);
    const { id } = request.params as { id: string };
    const updated = await db.updateCardPrintBatch(id, { status: "failed" });
    if (!updated) throw new ControlAppError(404, "NOT_FOUND", "Lot non trouvé", false);
    return { data: updated };
  });
}