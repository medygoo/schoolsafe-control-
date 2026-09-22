import type { Instance } from "../db/types.js";

export interface SerializedInstance {
  id: string;
  school_name: string;
  school_slug: string;
  domain: string;
  api_base: string;
  supabase_url: string;
  lifecycle_status: "trial" | "grace" | "active" | "suspended";
  status: "trial" | "grace" | "active" | "suspended"; // Alias for backward compatibility
  setup_token: string | null;
  hmac_secret: string;
  is_blocked: boolean;
  blocked_at: string | null;
  trial_started_at: string | null;
  grace_ends_at: string | null;
  activated_at: string | null;
  created_at: string;
  updated_at: string;
}

export function serializeInstance(instance: Instance): SerializedInstance {
  return {
    id: instance.id,
    school_name: instance.school_name,
    school_slug: instance.school_slug,
    domain: instance.domain,
    api_base: instance.api_base,
    supabase_url: instance.supabase_url,
    lifecycle_status: instance.status,
    status: instance.status,
    setup_token: instance.setup_token,
    hmac_secret: instance.hmac_secret,
    is_blocked: instance.is_blocked,
    blocked_at: instance.blocked_at,
    trial_started_at: instance.trial_started_at,
    grace_ends_at: instance.grace_ends_at,
    activated_at: instance.activated_at,
    created_at: instance.created_at,
    updated_at: instance.updated_at
  };
}

export function serializeInstances(instances: Instance[]): SerializedInstance[] {
  return instances.map(serializeInstance);
}