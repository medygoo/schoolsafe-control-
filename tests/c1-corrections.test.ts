import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildApp } from "../src/app.js";
import { SqliteDatabase } from "../src/db/sqlite.js";
import { signRequest } from "../src/auth/hmac.js";

const ADMIN_TOKEN = "test-admin-token-32-chars-long";

async function makeDb(): Promise<SqliteDatabase> {
  const db = new SqliteDatabase(":memory:");
  await db.init();
  return db;
}

async function makeApp(db: SqliteDatabase) {
  return buildApp({ db, adminToken: ADMIN_TOKEN, testRoutes: true });
}

function hmacHeaders(instanceId: string, secret: string, method: string, path: string, body: unknown, timestampOffset = 0) {
  const timestamp = Math.floor(Date.now() / 1000) + timestampOffset;
  const bodyStr = JSON.stringify(body ?? {});
  const signature = signRequest({ method, path, body: bodyStr, timestamp, secret });
  return {
    "x-schoolsafe-instance": instanceId,
    "x-schoolsafe-timestamp": String(timestamp),
    "x-schoolsafe-signature": signature,
    "content-type": "application/json"
  };
}

describe("C1 Corrections", () => {
  let db: SqliteDatabase;

  beforeEach(async () => {
    db = await makeDb();
  });

  afterEach(async () => {
    await db.close();
  });

  describe("HMAC order and state disclosure", () => {
    it("returns 401 AUTH_INVALID for invalid signature on blocked instance", async () => {
      const app = await makeApp(db);
      const instance = await db.createInstance({
        school_name: "Blocked School",
        school_slug: "blocked-hmac",
        domain: "blocked.schoolsafe.cd",
        api_base: "https://blocked.schoolsafe.cd/api",
        supabase_url: "https://abc.supabase.co",
        status: "active",
        setup_token: null,
        hmac_secret: "secret-blocked",
        is_blocked: true,
        blocked_at: new Date().toISOString(),
        trial_started_at: null,
        grace_ends_at: null,
        activated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      const headers = hmacHeaders(instance.id, "wrong-secret", "POST", "/card-print-batches", {});
      const res = await app.inject({
        method: "POST",
        url: "/card-print-batches",
        headers,
        payload: JSON.stringify({})
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe("AUTH_INVALID");
    });

    it("returns 403 INSTANCE_BLOCKED for valid signature on blocked instance", async () => {
      const app = await makeApp(db);
      const instance = await db.createInstance({
        school_name: "Blocked Valid",
        school_slug: "blocked-valid",
        domain: "blockedvalid.schoolsafe.cd",
        api_base: "https://bv.schoolsafe.cd/api",
        supabase_url: "https://abc.supabase.co",
        status: "active",
        setup_token: null,
        hmac_secret: "secret-valid-blocked",
        is_blocked: true,
        blocked_at: new Date().toISOString(),
        trial_started_at: null,
        grace_ends_at: null,
        activated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      const headers = hmacHeaders(instance.id, "secret-valid-blocked", "POST", "/card-print-batches", {});
      const res = await app.inject({
        method: "POST",
        url: "/card-print-batches",
        headers,
        payload: JSON.stringify({})
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe("INSTANCE_BLOCKED");
    });
  });

  describe("Suspended instance access", () => {
    async function createSuspendedInstance() {
      return db.createInstance({
        school_name: "Suspended School",
        school_slug: "suspended-c1",
        domain: "suspended.schoolsafe.cd",
        api_base: "https://suspended.schoolsafe.cd/api",
        supabase_url: "https://abc.supabase.co",
        status: "suspended",
        setup_token: null,
        hmac_secret: "secret-suspended",
        is_blocked: false,
        blocked_at: null,
        trial_started_at: null,
        grace_ends_at: null,
        activated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    }

    it("rejects mutation with INSTANCE_SUSPENDED", async () => {
      const app = await makeApp(db);
      const instance = await createSuspendedInstance();
      await db.bindInstanceSchool(instance.id, "11111111-1111-1111-1111-111111111111");

      const headers = hmacHeaders(instance.id, "secret-suspended", "POST", "/card-print-batches", {
        batch_id: "b1",
        version: 1,
        card_count: 1,
        r2_key: "k",
        zip_signed_url: "https://x/y.zip",
        signed_url_expires_at: new Date(Date.now() + 60000).toISOString(),
        zip_sha256: "a".repeat(64),
        school_id: "11111111-1111-1111-1111-111111111111"
      });

      const res = await app.inject({
        method: "POST",
        url: "/card-print-batches",
        headers,
        payload: JSON.stringify({
          batch_id: "b1",
          version: 1,
          card_count: 1,
          r2_key: "k",
          zip_signed_url: "https://x/y.zip",
          signed_url_expires_at: new Date(Date.now() + 60000).toISOString(),
          zip_sha256: "a".repeat(64),
          school_id: "11111111-1111-1111-1111-111111111111"
        })
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe("INSTANCE_SUSPENDED");
    });

    it("allows license read when suspended", async () => {
      const app = await makeApp(db);
      const instance = await createSuspendedInstance();
      const schoolId = "22222222-2222-2222-2222-222222222222";
      await db.bindInstanceSchool(instance.id, schoolId);
      await db.upsertLicense({
        instance_id: instance.id,
        school_id: schoolId,
        license_id: "lic-suspended",
        status: "active",
        issued_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        grace_days: 0,
        metadata: {}
      });

      const headers = hmacHeaders(instance.id, "secret-suspended", "GET", `/api/license/state?school_id=${schoolId}`, {});
      const res = await app.inject({
        method: "GET",
        url: `/api/license/state?school_id=${schoolId}`,
        headers
      });

      // License route requires privateKey for signing; without it we expect 503 DEPENDENCY_UNAVAILABLE,
      // but crucially NOT 403 INSTANCE_SUSPENDED or PERMISSION_DENIED.
      expect([200, 503]).toContain(res.statusCode);
      if (res.statusCode === 503) {
        expect(res.json().code).toBe("DEPENDENCY_UNAVAILABLE");
      } else {
        expect(res.json().signed_token).toBeTruthy();
      }
    });
  });

  describe("License multi-school resolver", () => {
    async function createActiveInstanceWithSchools(schoolIds: string[]) {
      const instance = await db.createInstance({
        school_name: "Multi School",
        school_slug: "multi-license-c1",
        domain: "multi.schoolsafe.cd",
        api_base: "https://multi.schoolsafe.cd/api",
        supabase_url: "https://abc.supabase.co",
        status: "active",
        setup_token: null,
        hmac_secret: "secret-multi",
        is_blocked: false,
        blocked_at: null,
        trial_started_at: null,
        grace_ends_at: null,
        activated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      for (const sid of schoolIds) {
        await db.bindInstanceSchool(instance.id, sid);
        await db.upsertLicense({
          instance_id: instance.id,
          school_id: sid,
          license_id: `lic-${sid.slice(0, 8)}`,
          status: "active",
          issued_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 86400000).toISOString(),
          grace_days: 0,
          metadata: {}
        });
      }
      return instance;
    }

    it("accepts explicit authorized school_id in multi-school context", async () => {
      const app = await makeApp(db);
      const s1 = "33333333-3333-3333-3333-333333333333";
      const s2 = "44444444-4444-4444-4444-444444444444";
      const instance = await createActiveInstanceWithSchools([s1, s2]);

      const headers = hmacHeaders(instance.id, "secret-multi", "GET", `/api/license/state?school_id=${s2}`, {});
      const res = await app.inject({
        method: "GET",
        url: `/api/license/state?school_id=${s2}`,
        headers
      });

      // Without privateKey → 503, but authorization passed (not 403)
      expect([200, 503]).toContain(res.statusCode);
      if (res.statusCode === 503) {
        expect(res.json().code).toBe("DEPENDENCY_UNAVAILABLE");
      }
    });

    it("rejects multi-school request without school_id", async () => {
      const app = await makeApp(db);
      const s1 = "55555555-5555-5555-5555-555555555555";
      const s2 = "66666666-6666-6666-6666-666666666666";
      const instance = await createActiveInstanceWithSchools([s1, s2]);

      const headers = hmacHeaders(instance.id, "secret-multi", "GET", "/api/license/state", {});
      const res = await app.inject({
        method: "GET",
        url: "/api/license/state",
        headers
      });

      expect(res.statusCode).toBe(403);
      // capabilities.ts throws PERMISSION_DENIED for missing school_id in multi-school
      expect(["PERMISSION_DENIED", "VALIDATION_INVALID"]).toContain(res.json().code);
    });
  });

  describe("Setup token J18 stale trial rejection", () => {
    it("refuses consumeSetupToken for stale trial (grace_ends_at expired)", async () => {
      const app = await makeApp(db);
      const instance = await db.createInstance({
        school_name: "Stale Trial",
        school_slug: "stale-trial-c1",
        domain: "stale.schoolsafe.cd",
        api_base: "https://stale.schoolsafe.cd/api",
        supabase_url: "https://abc.supabase.co",
        status: "trial",
        setup_token: "stale-token-consume",
        hmac_secret: "secret-stale",
        is_blocked: false,
        blocked_at: null,
        trial_started_at: new Date(Date.now() - 20 * 86400000).toISOString(),
        grace_ends_at: new Date(Date.now() - 86400000).toISOString(), // expired yesterday
        activated_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      const res = await app.inject({
        method: "POST",
        url: "/instances/validate-setup-token",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ setup_token: "stale-token-consume" })
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe("NOT_FOUND");

      // Token must NOT have been consumed
      const stored = await db.getInstanceById(instance.id);
      expect(stored?.setup_token).toBe("stale-token-consume");
    });

    it("refuses regenerateSetupToken for stale trial (grace_ends_at expired)", async () => {
      const app = await makeApp(db);
      const instance = await db.createInstance({
        school_name: "Stale Regen",
        school_slug: "stale-regen-c1",
        domain: "staleregen.schoolsafe.cd",
        api_base: "https://staleregen.schoolsafe.cd/api",
        supabase_url: "https://abc.supabase.co",
        status: "trial",
        setup_token: "stale-token-regen",
        hmac_secret: "secret-stale-regen",
        is_blocked: false,
        blocked_at: null,
        trial_started_at: new Date(Date.now() - 20 * 86400000).toISOString(),
        grace_ends_at: new Date(Date.now() - 86400000).toISOString(), // expired yesterday
        activated_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      const res = await app.inject({
        method: "POST",
        url: `/instances/${instance.id}/token`,
        headers: { "x-admin-token": ADMIN_TOKEN }
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("INVALID_STATE");

      // Token must NOT have been regenerated
      const stored = await db.getInstanceById(instance.id);
      expect(stored?.setup_token).toBe("stale-token-regen");
    });
  });
});