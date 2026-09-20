import { createPrivateKey, sign } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { ControlDatabase } from "../db/index.js";
import { authenticateHmac } from "../auth/hmac.js";
import { requireAdminToken } from "../auth/admin.js";
import { ControlAppError } from "../http/errors.js";

function b64url(value: string|Buffer): string { return Buffer.from(value).toString("base64url"); }
function resolveSchool(ids:string[], requested?:string): string { if (requested && !ids.includes(requested)) throw new ControlAppError(403,"PERMISSION_DENIED","�cole non autoris�e",false); if (ids.length !== 1) throw new ControlAppError(403,"VALIDATION_INVALID","�cole non d�terministe",false); return ids[0]; }

export function registerLicenseRoutes(app: FastifyInstance, db: ControlDatabase, adminToken: string, privateKey?: string): void {
 app.get("/api/license/state",{preHandler:async (req:FastifyRequest,reply:FastifyReply)=>authenticateHmac(req,reply,db)},async(req)=>{
   const instanceId=String(req.headers["x-schoolsafe-instance"]); const q=req.query as {school_id?:string}; const schoolId=resolveSchool(await db.getAuthorizedSchoolIds(instanceId),q.school_id);
   const license=await db.getLicense(instanceId,schoolId); if(!license) throw new ControlAppError(404,"NOT_FOUND","Licence indisponible",false);
   if(!privateKey) throw new ControlAppError(503,"DEPENDENCY_UNAVAILABLE","Signature de licence indisponible",true);
   const payload={license_id:license.license_id,instance_id:instanceId,school_id:schoolId,status:license.status,issued_at:license.issued_at,expires_at:license.expires_at,grace_days:license.grace_days,metadata:license.metadata};
   const segment=b64url(JSON.stringify(payload)); const sig=sign(null,Buffer.from(segment),createPrivateKey(privateKey));
   return {signed_token:segment+"."+b64url(sig)};
 });
 app.post("/instances/:id/school",async(req)=>{requireAdminToken(req,adminToken);const id=String((req.params as any).id);const body=z.object({school_id:z.string().min(1)}).parse(req.body);await db.bindInstanceSchool(id,body.school_id);return {ok:true};});
 app.put("/instances/:id/license",async(req)=>{requireAdminToken(req,adminToken);const id=String((req.params as any).id);const b=z.object({school_id:z.string().min(1),license_id:z.string().min(1),status:z.enum(["active","suspended","revoked"]),issued_at:z.string(),expires_at:z.string().nullable().optional(),grace_days:z.number().int().min(0).max(365).default(0),metadata:z.record(z.unknown()).default({})}).parse(req.body);await db.bindInstanceSchool(id,b.school_id);return {data:await db.upsertLicense({instance_id:id,...b,expires_at:b.expires_at??null})};});
}
