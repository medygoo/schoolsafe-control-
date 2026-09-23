import type { FastifyRequest } from "fastify";
import { ControlAppError } from "../http/errors.js";
import type { ControlDatabase, Instance } from "../db/types.js";
import { InstanceStateService } from "../domain/instance-state.js";

export type Capability = 
  | "cards:create"
  | "batches:create"
  | "devices:register"
  | "license:read";

export interface AuthContext {
  instance: Instance;
  schoolId: string;
}

const ALLOWED_CAPABILITIES: Record<Instance["status"], Capability[]> = {
  trial: ["cards:create", "batches:create", "devices:register", "license:read"],
  grace: ["cards:create", "batches:create", "devices:register", "license:read"],
  active: ["cards:create", "batches:create", "devices:register", "license:read"],
  suspended: ["license:read"]
};

export async function resolveSchoolAndAuthorize(
  request: FastifyRequest,
  db: ControlDatabase,
  requiredCapability: Capability
): Promise<AuthContext> {
  const instanceId = request.headers["x-schoolsafe-instance"] as string;
  // Support both body (POST) and query (GET) for school_id resolution
  const requestedSchoolId = ((request.body as any)?.school_id ?? (request.query as any)?.school_id) as string | undefined;

  if (!instanceId) {
    throw new ControlAppError(401, "AUTH_REQUIRED", "En-tête x-schoolsafe-instance manquant", false);
  }

  const instance = await db.getInstanceById(instanceId);
  if (!instance) {
    throw new ControlAppError(401, "AUTH_INVALID", "Instance inconnue", false);
  }

  // Refresh lifecycle before checking capabilities
  const stateService = new InstanceStateService(db);
  await stateService.refreshDueLifecycle();
  
  // Re-fetch to get updated status if it changed
  const freshInstance = await db.getInstanceById(instanceId);
  if (!freshInstance) throw new ControlAppError(500, "INTERNAL_ERROR", "Instance disappeared after refresh", false);

  if (freshInstance.is_blocked) {
    throw new ControlAppError(403, "INSTANCE_BLOCKED", "Cette instance est bloquée administrativement", false);
  }

  const allowedCaps = ALLOWED_CAPABILITIES[freshInstance.status];
  if (!allowedCaps.includes(requiredCapability)) {
    if (freshInstance.status === "suspended") {
      throw new ControlAppError(403, "INSTANCE_SUSPENDED", "Cette instance est suspendue commercialement", false);
    }
    throw new ControlAppError(403, "PERMISSION_DENIED", `Capabilité ${requiredCapability} non autorisée pour le statut ${freshInstance.status}`, false);
  }

  const authorizedSchools = await db.getAuthorizedSchoolIds(instanceId);
  
  let schoolId: string;
  if (authorizedSchools.length === 0) {
    throw new ControlAppError(403, "PERMISSION_DENIED", "Aucune école associée à cette instance", false);
  }
  
  if (authorizedSchools.length === 1) {
    schoolId = authorizedSchools[0];
    if (requestedSchoolId && requestedSchoolId !== schoolId) {
      throw new ControlAppError(403, "PERMISSION_DENIED", "École non autorisée pour cette instance", false);
    }
  } else {
    // Multi-school scenario
    if (!requestedSchoolId) {
      throw new ControlAppError(403, "PERMISSION_DENIED", "school_id requis pour les instances multi-écoles", false);
    }
    if (!authorizedSchools.includes(requestedSchoolId)) {
      throw new ControlAppError(403, "PERMISSION_DENIED", "École non autorisée pour cette instance", false);
    }
    schoolId = requestedSchoolId;
  }

  return { instance: freshInstance, schoolId };
}