import { z } from "zod";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ControlAppError } from "../http/errors.js";
import { requireAdminToken } from "../auth/admin.js";
import { authenticateHmac } from "../auth/hmac.js";
import { resolveSchoolAndAuthorize } from "../auth/capabilities.js";
import type { ControlDatabase } from "../db/index.js";

const createRequestSchema = z.object({
  school_id: z.string().min(1).optional(),
  student_id: z.string().min(1),
  student_name: z.string().min(1),
  class_name: z.string().min(1),
  academic_year: z.string().min(1),
  front_key: z.string().min(1),
  back_key: z.string().min(1),
  front_signed_url: z.string().url(),
  back_signed_url: z.string().url(),
  signed_url_expires_at: z.string().datetime(),
  format: z.enum(["badge", "carte"]),
  metadata: z.record(z.unknown()).default({})
});

export function registerCardRequestRoutes(app: FastifyInstance, db: ControlDatabase, adminToken: string): void {
  // Réception d'une demande depuis un VPS école (authentifiée HMAC)
  app.post("/card-print-requests", {
    preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
      await authenticateHmac(request, reply, db);
    }
  }, async (request) => {
    const { schoolId } = await resolveSchoolAndAuthorize(request, db, "cards:create");
    const body = createRequestSchema.parse(request.body);
    if (body.school_id && body.school_id !== schoolId) {
      throw new ControlAppError(403, "PERMISSION_DENIED", "École non autorisée", false);
    }
    const now = new Date().toISOString();
    const requestRecord = await db.createCardPrintRequest({
      instance_id: (request.headers["x-schoolsafe-instance"] as string),
      ...body,
      school_id: schoolId,
      status: "pending",
      created_at: now,
      updated_at: now
    });
    return { data: requestRecord };
  });

  // Liste admin des demandes
  app.get("/card-print-requests", async (request) => {
    requireAdminToken(request, adminToken);
    const { status, instance_id } = request.query as { status?: string; instance_id?: string };
    const data = await db.getCardPrintRequests({ status, instance_id });
    return { data };
  });

  // Détail admin
  app.get("/card-print-requests/:id", async (request) => {
    requireAdminToken(request, adminToken);
    const { id } = request.params as { id: string };
    const record = await db.getCardPrintRequestById(id);
    if (!record) throw new ControlAppError(404, "NOT_FOUND", "Demande non trouvée", false);
    return { data: record };
  });

  // Marquer comme imprimée
  app.post("/card-print-requests/:id/print", async (request) => {
    requireAdminToken(request, adminToken);
    const { id } = request.params as { id: string };
    const record = await db.getCardPrintRequestById(id);
    if (!record) throw new ControlAppError(404, "NOT_FOUND", "Demande non trouvée", false);
    const now = new Date().toISOString();
    const updated = await db.updateCardPrintRequest(id, { status: "printed", printed_at: now });
    return { data: updated };
  });

  // Marquer comme échouée
  app.post("/card-print-requests/:id/fail", async (request) => {
    requireAdminToken(request, adminToken);
    const { id } = request.params as { id: string };
    const record = await db.getCardPrintRequestById(id);
    if (!record) throw new ControlAppError(404, "NOT_FOUND", "Demande non trouvée", false);
    const updated = await db.updateCardPrintRequest(id, { status: "failed" });
    return { data: updated };
  });
}