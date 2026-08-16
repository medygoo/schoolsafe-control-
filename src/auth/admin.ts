import type { FastifyRequest } from "fastify";
import { ControlAppError } from "../http/errors.js";

export function requireAdminToken(request: FastifyRequest, adminToken: string): void {
  const header = request.headers["x-admin-token"] as string | undefined;
  if (!header || header !== adminToken) {
    throw new ControlAppError(401, "AUTH_REQUIRED", "Token administrateur invalide", false);
  }
}
