import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyRequest, FastifyReply } from "fastify";
import { ControlAppError } from "../http/errors.js";
import type { JsonStore } from "../store.js";

export function signRequest(payload: {
  method: string;
  path: string;
  body: string;
  timestamp: number;
  secret: string;
}): string {
  const data = `${payload.method.toUpperCase()}\n${payload.path}\n${payload.timestamp}\n${payload.body}`;
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
  store: JsonStore
): Promise<void> {
  const instanceId = request.headers["x-schoolsafe-instance"] as string | undefined;
  const timestamp = request.headers["x-schoolsafe-timestamp"] as string | undefined;
  const signature = request.headers["x-schoolsafe-signature"] as string | undefined;

  if (!instanceId || !timestamp || !signature) {
    throw new ControlAppError(401, "AUTH_REQUIRED", "En-têtes d'authentification HMAC manquants", false);
  }

  const instance = store.getInstanceById(instanceId);
  if (!instance) {
    throw new ControlAppError(401, "AUTH_INVALID", "Instance inconnue", false);
  }

  if (instance.status === "blocked") {
    throw new ControlAppError(403, "INSTANCE_BLOCKED", "Cette instance est bloquée", false);
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
