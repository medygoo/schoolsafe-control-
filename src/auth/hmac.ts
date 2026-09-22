import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyRequest, FastifyReply } from "fastify";
import { ControlAppError } from "../http/errors.js";
import type { ControlDatabase } from "../db/index.js";
import { InstanceStateService } from "../domain/instance-state.js";

export function signRequest(payload: {
  method: string;
  path: string;
  body: string;
  timestamp: number;
  secret: string;
}): string {
  const data = `${payload.method.toUpperCase()}
${payload.path}
${payload.timestamp}
${payload.body}`;
  return createHmac("sha256", payload.secret).update(data).digest("hex");
}

export function verifyRequest(payload: {
  method: string;
  path: string;
  body: string;
  timestamp: number;
  signature: string;
  secret: string;
  maxAgeSeconds?: number;
}): boolean {
  const maxAge = payload.maxAgeSeconds ?? 300;
  if (!/^\d+$/.test(String(payload.timestamp)) || !Number.isSafeInteger(payload.timestamp)) return false;
  if (!/^[a-f0-9]{64}$/.test(payload.signature)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - payload.timestamp) > maxAge) return false;

  const expected = signRequest({
    method: payload.method,
    path: payload.path,
    body: payload.body,
    timestamp: payload.timestamp,
    secret: payload.secret
  });

  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(payload.signature, "hex");
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}

export type HmacAuthHeaders = {
  "x-schoolsafe-instance": string;
  "x-schoolsafe-timestamp": string;
  "x-schoolsafe-signature": string;
};

export async function authenticateHmac(
  request: FastifyRequest,
  reply: FastifyReply,
  db: ControlDatabase
): Promise<void> {
  const instanceId = request.headers["x-schoolsafe-instance"] as string | undefined;
  const timestamp = request.headers["x-schoolsafe-timestamp"] as string | undefined;
  const signature = request.headers["x-schoolsafe-signature"] as string | undefined;

  if (!instanceId || !timestamp || !signature) {
    throw new ControlAppError(401, "AUTH_REQUIRED", "En-têtes d'authentification HMAC manquants", false);
  }

  // Refresh lifecycle before checking block status or signature
  const stateService = new InstanceStateService(db);
  await stateService.refreshDueLifecycle();

  const instance = await db.getInstanceById(instanceId);
  if (!instance) {
    throw new ControlAppError(401, "AUTH_INVALID", "Instance inconnue", false);
  }

  if (instance.is_blocked) {
    throw new ControlAppError(403, "INSTANCE_BLOCKED", "Cette instance est bloquée administrativement", false);
  }

  // Le client et le serveur signent le JSON compact du body parsé.
  // Cela évite de devoir intercepter le stream brut et reste déterministe.
  const body = JSON.stringify(request.body ?? {});
  const valid = verifyRequest({
    method: request.method,
    path: request.url,
    body,
    timestamp: Number(timestamp),
    signature,
    secret: instance.hmac_secret
  });

  if (!valid) {
    throw new ControlAppError(401, "AUTH_INVALID", "Signature HMAC invalide ou requête expirée", false);
  }
}