import { z } from "zod";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ControlAppError } from "../http/errors.js";
import { authenticateHmac } from "../auth/hmac.js";
import { requireAdminToken } from "../auth/admin.js";
import type { ControlDatabase } from "../db/index.js";
import type { DeviceStatus } from "../db/types.js";

const registerSchema = z.object({
  school_id: z.string().min(1).optional(),
  device_code: z.string().min(2).max(64),
  vendor: z.string().min(1).max(64),
  model: z.string().min(1).max(64),
  serial_number: z.string().min(3).max(128),
  location: z.string().max(128).optional()
});

const patchSchema = z.object({
  status: z.enum(["registered", "testing", "online", "offline", "disabled", "revoked"])
});

export function registerDeviceRoutes(app: FastifyInstance, db: ControlDatabase, adminToken: string): void {
  // SchoolSafe déclare un appareil — authentifié HMAC (registre maître matériel)
  app.post("/device-registrations", {
    preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
      await authenticateHmac(request, reply, db);
    }
  }, async (request) => {
    const instanceId = request.headers["x-schoolsafe-instance"] as string;
    const body = registerSchema.parse(request.body);
    const authorized = await db.getAuthorizedSchoolIds(instanceId);
    const schoolId = authorized[0];
    if (authorized.length !== 1 || !schoolId || (body.school_id && body.school_id !== schoolId)) throw new ControlAppError(403, "PERMISSION_DENIED", "Ecole non autorisee", false);
    try {
      const device = await db.createDevice({ instance_id: instanceId, school_id: schoolId, device_code: body.device_code, vendor: body.vendor, model: body.model, serial_number: body.serial_number, location: body.location ?? null });
      return { data: device };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("duplicate key") || message.includes("UNIQUE constraint")) {
        throw new ControlAppError(409, "VALIDATION_INVALID", "Cet appareil (code ou série) est déjà enregistré", false);
      }
      throw err;
    }
  });

  // Liste admin des appareils
  app.get("/devices", async (request) => {
    requireAdminToken(request, adminToken);
    const { status, instance_id } = request.query as { status?: string; instance_id?: string };
    return { data: await db.getDevices({ status, instance_id }) };
  });

  // Changer le statut d'un appareil (activer, désactiver, révoquer…)
  app.post("/devices/:id/status", async (request) => {
    requireAdminToken(request, adminToken);
    const { id } = request.params as { id: string };
    const body = patchSchema.parse(request.body);
    const updated = await db.updateDevice(id, { status: body.status as DeviceStatus });
    if (!updated) throw new ControlAppError(404, "NOT_FOUND", "Appareil non trouvé", false);
    return { data: updated };
  });
}