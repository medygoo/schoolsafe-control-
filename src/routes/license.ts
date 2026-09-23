import { createPrivateKey, sign } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { ControlDatabase } from "../db/index.js";
import { authenticateHmac } from "../auth/hmac.js";
import { requireAdminToken } from "../auth/admin.js";
import { resolveSchoolAndAuthorize } from "../auth/capabilities.js";

function b64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

export function registerLicenseRoutes(
  app: FastifyInstance,
  db: ControlDatabase,
  adminToken: string,
  privateKey?: string
): void {
  app.get(
    "/api/license/state",
    {
      preHandler: async (req: FastifyRequest, reply: FastifyReply) =>
        authenticateHmac(req, reply, db)
    },
    async (req) => {
      const { instance, schoolId } = await resolveSchoolAndAuthorize(
        req,
        db,
        "license:read"
      );

      const license = await db.getLicense(instance.id, schoolId);
      if (!license) {
        throw new (await import("../http/errors.js")).ControlAppError(
          404,
          "NOT_FOUND",
          "Licence indisponible",
          false
        );
      }

      if (!privateKey) {
        throw new (await import("../http/errors.js")).ControlAppError(
          503,
          "DEPENDENCY_UNAVAILABLE",
          "Signature de licence indisponible",
          true
        );
      }

      const payload = {
        license_id: license.license_id,
        instance_id: instance.id,
        school_id: schoolId,
        status: license.status,
        issued_at: license.issued_at,
        expires_at: license.expires_at,
        grace_days: license.grace_days,
        metadata: license.metadata,
        instance_lifecycle_status: instance.status
      };

      const segment = b64url(JSON.stringify(payload));
      const sig = sign(null, Buffer.from(segment), createPrivateKey(privateKey));
      return { signed_token: segment + "." + b64url(sig) };
    }
  );

  app.post("/instances/:id/school", async (req) => {
    requireAdminToken(req, adminToken);
    const id = String((req.params as any).id);
    const parsed = z.object({ school_id: z.string().uuid() }).safeParse(req.body);
    if (!parsed.success) {
      throw new (await import("../http/errors.js")).ControlAppError(
        400,
        "VALIDATION_INVALID",
        "Donnee invalide",
        false
      );
    }
    await db.bindInstanceSchool(id, parsed.data.school_id);
    return { ok: true };
  });

  app.put("/instances/:id/license", async (req) => {
    requireAdminToken(req, adminToken);
    const id = String((req.params as any).id);
    const parsed = z
      .object({
        school_id: z.string().uuid(),
        license_id: z.string().min(1),
        status: z.enum(["active", "suspended", "revoked"]),
        issued_at: z.string().datetime({ offset: true }),
        expires_at: z.string().datetime({ offset: true }),
        grace_days: z.number().int().min(0).max(90),
        metadata: z.record(z.unknown()).default({})
      })
      .safeParse(req.body);
    if (!parsed.success) {
      throw new (await import("../http/errors.js")).ControlAppError(
        400,
        "VALIDATION_INVALID",
        "Donnee invalide",
        false
      );
    }
    const b = parsed.data;
    await db.bindInstanceSchool(id, b.school_id);
    return {
      data: await db.upsertLicense({
        instance_id: id,
        ...b,
        expires_at: b.expires_at
      })
    };
  });
}