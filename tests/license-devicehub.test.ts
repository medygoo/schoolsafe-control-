import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { buildApp } from "../src/app.js";
import { SqliteDatabase } from "../src/db/sqlite.js";
import { signRequest } from "../src/auth/hmac.js";
import { verifyLicenseToken } from "./fixtures/schoolsafe-license-verifier.js";
const SCHOOL = "33333333-3333-4333-8333-333333333333";
describe("SchoolSafe license cross-repo contract SHA 16a3bc665ebc6b6f0784b6e853004a4d6667ea79", () => {
it("emits accepted token and rejects invalid inputs", async () => {
const db = new SqliteDatabase(":memory:");
await db.init();
const now = new Date().toISOString();
const inst = await db.createInstance({
school_name: "A",
school_slug: "a",
domain: "a",
api_base: "https://school",
supabase_url: "https://supabase",
status: "active",
setup_token: null,
hmac_secret: "h".repeat(32),
is_blocked: false,
blocked_at: null,
trial_started_at: now,
grace_ends_at: null,
activated_at: now,
created_at: now,
updated_at: now
});
await db.bindInstanceSchool(inst.id, SCHOOL);
const kp = generateKeyPairSync("ed25519");
await db.upsertLicense({
instance_id: inst.id,
school_id: SCHOOL,
license_id: "lic-1",
status: "active",
issued_at: "2026-01-01T00:00:00+00:00",
expires_at: "2027-01-01T00:00:00+00:00",
grace_days: 90,
metadata: {}
});
const app = await buildApp({
db,
adminToken: "admin",
licensePrivateKey: kp.privateKey.export({ format: "pem", type: "pkcs8" }).toString()
});
const path = "/api/license/state?school_id=" + SCHOOL;
const ts = Math.floor(Date.now() / 1000);
const headers = {
"x-schoolsafe-instance": inst.id,
"x-schoolsafe-timestamp": String(ts),
"x-schoolsafe-signature": signRequest({
method: "GET",
path,
body: "{}",
timestamp: ts,
secret: inst.hmac_secret
})
};
const ok = await app.inject({ method: "GET", url: path, headers });
expect(ok.statusCode).toBe(200);
expect(verifyLicenseToken(ok.json().signed_token, kp.publicKey.export({ format: "pem", type: "spki" }).toString())?.school_id).toBe(SCHOOL);
for (const bad of [
{ school_id: "not-uuid", license_id: "x", status: "active", issued_at: "2026-01-01T00:00:00+00:00", expires_at: "2027-01-01T00:00:00+00:00", grace_days: 0 },
{ school_id: SCHOOL, license_id: "x", status: "active", issued_at: "2026-01-01T00:00:00+00:00", expires_at: null, grace_days: 0 },
{ school_id: SCHOOL, license_id: "x", status: "active", issued_at: "bad", expires_at: "2027-01-01T00:00:00+00:00", grace_days: 91 }
]) {
const res = await app.inject({
method: "PUT",
url: "/instances/" + inst.id + "/license",
headers: { "x-admin-token": "admin", "content-type": "application/json" },
payload: bad
});
expect(res.statusCode).toBe(400);
}
const tokenRes = await app.inject({ method: "GET", url: path, headers });
expect(tokenRes.statusCode).toBe(200);
await db.close();
});
});