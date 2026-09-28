import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { SchoolAdminAccessError } from "../db/types.js";
export function requireBootstrapSecret(
  request: FastifyRequest,
  secret: string | undefined,
): void {
  if (!secret)
    throw new SchoolAdminAccessError(
      503,
      "DEPENDENCY_UNAVAILABLE",
      "Authentification bootstrap indisponible.",
    );
  const supplied = request.headers["x-schoolsafe-bootstrap-secret"];
  const digest = (text: string) =>
    createHash("sha256").update(text, "utf8").digest();
  if (
    typeof supplied !== "string" ||
    !timingSafeEqual(digest(supplied), digest(secret))
  ) {
    throw new SchoolAdminAccessError(
      401,
      "AUTH_INVALID",
      "Authentification invalide.",
    );
  }
}
