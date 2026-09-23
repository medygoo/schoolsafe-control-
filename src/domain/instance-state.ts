import { randomBytes } from "node:crypto";
import type { ControlDatabase, Instance, InstanceStatus } from "../db/types.js";

export type LifecycleStatus = "trial" | "grace" | "active" | "suspended";

export interface CreateTrialInput {
school_name: string;
school_slug: string;
domain: string;
api_base: string;
supabase_url: string;
}

export class InstanceStateService {
constructor(private db: ControlDatabase) {}

private generateToken(): string {
return randomBytes(32).toString("hex");
}

async createTrial(input: CreateTrialInput): Promise<Instance> {
const now = new Date();
const trialStart = new Date(now);
const graceEnds = new Date(trialStart.getTime() + 17 * 24 * 60 * 60 * 1000); // 14 days trial + 3 days grace
return this.db.createInstance({
...input,
status: "trial",
setup_token: this.generateToken(),
hmac_secret: this.generateToken(),
is_blocked: false,
blocked_at: null,
trial_started_at: trialStart.toISOString(),
grace_ends_at: graceEnds.toISOString(),
activated_at: null,
created_at: now.toISOString(),
updated_at: now.toISOString()
});
}

async activateCommercially(instanceId: string): Promise<Instance> {
const instance = await this.db.getInstanceById(instanceId);
if (!instance) throw new Error("INSTANCE_NOT_FOUND");
if (instance.status === "active") throw new Error("INVALID_STATE: already active");
if (!["trial", "grace", "suspended"].includes(instance.status)) {
throw new Error(`INVALID_STATE: cannot activate from ${instance.status}`);
}
const now = new Date().toISOString();
const updated = await this.db.updateInstance(instanceId, {
status: "active",
activated_at: now,
setup_token: null,
updated_at: now
});
if (!updated) throw new Error("UPDATE_FAILED");
return updated;
}

async suspendCommercially(instanceId: string): Promise<Instance> {
const instance = await this.db.getInstanceById(instanceId);
if (!instance) throw new Error("INSTANCE_NOT_FOUND");
if (instance.status !== "active") {
throw new Error(`INVALID_STATE: can only suspend from active, current is ${instance.status}`);
}
const now = new Date().toISOString();
const updated = await this.db.updateInstance(instanceId, {
status: "suspended",
updated_at: now
});
if (!updated) throw new Error("UPDATE_FAILED");
return updated;
}

async setAdministrativeBlock(instanceId: string): Promise<Instance> {
const instance = await this.db.getInstanceById(instanceId);
if (!instance) throw new Error("INSTANCE_NOT_FOUND");
if (instance.is_blocked) return instance; // Idempotent
const now = new Date().toISOString();
const updated = await this.db.updateInstance(instanceId, {
is_blocked: true,
blocked_at: instance.blocked_at || now,
updated_at: now
});
if (!updated) throw new Error("UPDATE_FAILED");
return updated;
}

async clearAdministrativeBlock(instanceId: string): Promise<Instance> {
const instance = await this.db.getInstanceById(instanceId);
if (!instance) throw new Error("INSTANCE_NOT_FOUND");
if (!instance.is_blocked) return instance; // Idempotent
const now = new Date().toISOString();
const updated = await this.db.updateInstance(instanceId, {
is_blocked: false,
blocked_at: null,
updated_at: now
});
if (!updated) throw new Error("UPDATE_FAILED");
return updated;
}

async rotateHmacSecret(instanceId: string): Promise<Instance> {
const instance = await this.db.getInstanceById(instanceId);
if (!instance) throw new Error("INSTANCE_NOT_FOUND");
const now = new Date().toISOString();
const updated = await this.db.updateInstance(instanceId, {
hmac_secret: this.generateToken(),
updated_at: now
});
if (!updated) throw new Error("UPDATE_FAILED");
return updated;
}

async refreshDueLifecycle(): Promise<void> {
await this.db.checkAndExpireTrials();
}

async consumeSetupToken(token: string): Promise<Instance> {
const instance = await this.db.consumeSetupToken(token);
if (!instance) throw new Error("TOKEN_INVALID_OR_CONSUMED");
// Additional check for expired grace if needed, though DB layer should handle it
return instance;
}

async regenerateSetupToken(instanceId: string): Promise<Instance> {
const instance = await this.db.getInstanceById(instanceId);
if (!instance) throw new Error("INSTANCE_NOT_FOUND");
if (instance.status !== "trial" && instance.status !== "grace") {
throw new Error("INVALID_STATE: token regeneration only allowed in trial/grace");
}
// J18: grace_ends_at doit être défini et non expiré pour toute régénération (trial inclus)
if (!instance.grace_ends_at || new Date() > new Date(instance.grace_ends_at)) {
throw new Error("TRIAL_EXPIRED");
}
const now = new Date().toISOString();
const updated = await this.db.updateInstance(instanceId, {
setup_token: this.generateToken(),
updated_at: now
});
if (!updated) throw new Error("UPDATE_FAILED");
return updated;
}
}