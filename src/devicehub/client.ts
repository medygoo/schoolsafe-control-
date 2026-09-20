import { signRequest } from "../auth/hmac.js";

export type DeviceHubEvent = {
  instance_id: string;
  device_id: string;
  raw_provider_event_id: string;
  external_person_id?: string;
  credential_type: "fingerprint" | "pin" | "card" | "qr";
  event_type: "check_in" | "check_out" | "authentication" | "access" | "unknown";
  occurred_at: string;
  metadata?: Record<string, unknown>;
};

export async function forwardDeviceHubEvent(target: string, event: DeviceHubEvent, secret: string, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const url = new URL("/machine/devicehub/events", target);
  if (url.protocol !== "https:") throw new Error("HTTPS_REQUIRED");
  const { instance_id, ...bodyValue } = event;
  const body = JSON.stringify(bodyValue);
  const timestamp = Math.floor(Date.now() / 1000);
  const path = url.pathname + url.search;
  const signature = signRequest({ method: "POST", path, body, timestamp, secret });
  return fetchImpl(url, { method: "POST", headers: { "content-type": "application/json", "x-schoolsafe-instance": instance_id, "x-schoolsafe-timestamp": String(timestamp), "x-schoolsafe-signature": signature }, body });
}
