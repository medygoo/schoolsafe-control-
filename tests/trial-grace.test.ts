import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildApp } from "../src/app.js";
import { SqliteDatabase } from "../src/db/sqlite.js";

const ADMIN_TOKEN = "test-admin-token-32-chars-long";

async function makeDb(): Promise<SqliteDatabase> {
  const db = new SqliteDatabase(":memory:");
  await db.init();
  return db;
}

async function makeApp(db: SqliteDatabase) {
  return buildApp({ db, adminToken: ADMIN_TOKEN, testRoutes: true });
}

describe("Trial / Grace Cycle", () => {
  let db: SqliteDatabase;

  beforeEach(async () => {
    db = await makeDb();
  });

  afterEach(async () => {
    await db.close();
  });

  describe("Instance creation with trial", () => {
    it("creates an instance in trial status with dates", async () => {
      const app = await makeApp(db);
      const create = await app.inject({
        method: "POST",
        url: "/instances",
        headers: { "x-admin-token": ADMIN_TOKEN, "content-type": "application/json" },
        payload: JSON.stringify({
          school_name: "École Test",
          school_slug: "test-school",
          domain: "test.schoolsafe.cd",
          api_base: "https://test.schoolsafe.cd/api",
          supabase_url: "https://abc123.supabase.co"
        })
      });

      expect(create.statusCode).toBe(200);
      const instance = create.json().data;

      expect(instance.status).toBe("trial");
      expect(instance.setup_token).toHaveLength(64);
      expect(instance.trial_started_at).toBeTruthy();
      expect(instance.grace_ends_at).toBeTruthy();
      expect(instance.activated_at).toBeNull();
      expect(instance.is_blocked).toBe(false);
      expect(instance.blocked_at).toBeNull();

      // Verify grace_ends_at is 17 days after trial_started_at (14 days trial + 3 days grace)
      const trialStart = new Date(instance.trial_started_at);
      const graceEnds = new Date(instance.grace_ends_at);
      const diffDays = (graceEnds.getTime() - trialStart.getTime()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeCloseTo(17, 0);
    });
  });

  describe("Setup token validation", () => {
    async function createTrialInstance(app: Awaited<ReturnType<typeof makeApp>>) {
      const res = await app.inject({
        method: "POST",
        url: "/instances",
        headers: { "x-admin-token": ADMIN_TOKEN, "content-type": "application/json" },
        payload: JSON.stringify({
          school_name: "École Test",
          school_slug: "test-school",
          domain: "test.schoolsafe.cd",
          api_base: "https://test.schoolsafe.cd/api",
          supabase_url: "https://abc123.supabase.co"
        })
      });
      return res.json().data;
    }

    it("validates setup token and consumes it without activating", async () => {
      const app = await makeApp(db);
      const instance = await createTrialInstance(app);

      const validate = await app.inject({
        method: "POST",
        url: "/instances/validate-setup-token",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ setup_token: instance.setup_token })
      });

      expect(validate.statusCode).toBe(200);
      const result = validate.json().data;

      expect(result.instance_id).toBe(instance.id);
      expect(result.hmac_secret).toBe(instance.hmac_secret);
      expect(result.status).toBe("trial");
      expect(result.trial_started_at).toBeTruthy();
      expect(result.grace_ends_at).toBeTruthy();

      // Verify instance is still in trial but token is consumed
      const updated = await db.getInstanceById(instance.id);
      expect(updated?.status).toBe("trial");
      expect(updated?.setup_token).toBeNull();
      expect(updated?.activated_at).toBeNull();
    });

    it("rejects invalid setup token", async () => {
      const app = await makeApp(db);

      const validate = await app.inject({
        method: "POST",
        url: "/instances/validate-setup-token",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ setup_token: "invalid-token" })
      });

      expect(validate.statusCode).toBe(404);
      expect(validate.json().code).toBe("NOT_FOUND");
    });

    it("rejects missing setup token", async () => {
      const app = await makeApp(db);

      const validate = await app.inject({
        method: "POST",
        url: "/instances/validate-setup-token",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({})
      });

      expect(validate.statusCode).toBe(400);
      expect(validate.json().code).toBe("VALIDATION_INVALID");
    });

    it("rejects already consumed token", async () => {
      const app = await makeApp(db);
      const instance = await createTrialInstance(app);

      // First validation succeeds
      await app.inject({
        method: "POST",
        url: "/instances/validate-setup-token",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ setup_token: instance.setup_token })
      });

      // Second validation should fail
      const validate2 = await app.inject({
        method: "POST",
        url: "/instances/validate-setup-token",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ setup_token: instance.setup_token })
      });

      expect(validate2.statusCode).toBe(404);
    });

    it("prevents double consumption of the same setup token (atomicity)", async () => {
      const app = await makeApp(db);
      const instance = await createTrialInstance(app);

      // First consumption should succeed
      const first = await app.inject({
        method: "POST",
        url: "/instances/validate-setup-token",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ setup_token: instance.setup_token })
      });
      expect(first.statusCode).toBe(200);

      // Second consumption with the same token must fail
      const second = await app.inject({
        method: "POST",
        url: "/instances/validate-setup-token",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ setup_token: instance.setup_token })
      });
      expect(second.statusCode).toBe(404);
      expect(second.json().code).toBe("NOT_FOUND");

      // Verify token is null in DB
      const updated = await db.getInstanceById(instance.id);
      expect(updated?.setup_token).toBeNull();
    });

    it("rejects setup token on active instance", async () => {
      const app = await makeApp(db);
      const instance = await createTrialInstance(app);

      // Consume the original token first
      await app.inject({
        method: "POST",
        url: "/instances/validate-setup-token",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ setup_token: instance.setup_token })
      });

      // Manually set a new token and change status to active
      await db.updateInstance(instance.id, { setup_token: "new-token", status: "active" });

      const validate = await app.inject({
        method: "POST",
        url: "/instances/validate-setup-token",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ setup_token: "new-token" })
      });

      // Atomic consumption must reject tokens on active instances
      expect(validate.statusCode).toBe(404);
      expect(validate.json().code).toBe("NOT_FOUND");

      // Verify token is still present because consumption was refused
      const updated = await db.getInstanceById(instance.id);
      expect(updated?.setup_token).toBe("new-token");
    });
  });

  describe("Trial expiration and suspension", () => {
    it("checks and expires trials", async () => {
      const app = await makeApp(db);
      const instance = await db.createInstance({
        school_name: "École Expirée",
        school_slug: "expired-school",
        domain: "expired.schoolsafe.cd",
        api_base: "https://expired.schoolsafe.cd/api",
        supabase_url: "https://abc123.supabase.co",
        status: "trial",
        setup_token: "test-token",
        hmac_secret: "test-secret",
        is_blocked: false,
        blocked_at: null,
        trial_started_at: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(), // 15 days ago
        grace_ends_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days ago (already in grace and expired)
        activated_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      await db.checkAndExpireTrials();

      const updated = await db.getInstanceById(instance.id);
      expect(updated?.status).toBe("suspended");
    });

    it("moves trial to grace when 14 days pass", async () => {
      const app = await makeApp(db);
      const instance = await db.createInstance({
        school_name: "École En Grâce",
        school_slug: "grace-school",
        domain: "grace.schoolsafe.cd",
        api_base: "https://grace.schoolsafe.cd/api",
        supabase_url: "https://abc123.supabase.co",
        status: "trial",
        setup_token: "test-token",
        hmac_secret: "test-secret",
        is_blocked: false,
        blocked_at: null,
        trial_started_at: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(), // 15 days ago
        grace_ends_at: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days from now
        activated_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      await db.checkAndExpireTrials();

      const updated = await db.getInstanceById(instance.id);
      expect(updated?.status).toBe("grace");
    });

    it("suspends instance via admin endpoint", async () => {
      const app = await makeApp(db);
      const instance = await db.createInstance({
        school_name: "École à Suspendre",
        school_slug: "suspend-school",
        domain: "suspend.schoolsafe.cd",
        api_base: "https://suspend.schoolsafe.cd/api",
        supabase_url: "https://abc123.supabase.co",
        status: "active",
        setup_token: null,
        hmac_secret: "test-secret",
        is_blocked: false,
        blocked_at: null,
        trial_started_at: new Date().toISOString(),
        grace_ends_at: null,
        activated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      const suspend = await app.inject({
        method: "POST",
        url: `/instances/${instance.id}/suspend`,
        headers: { "x-admin-token": ADMIN_TOKEN }
      });

      expect(suspend.statusCode).toBe(200);
      expect(suspend.json().data.status).toBe("suspended");
    });

    it("activates suspended instance via admin endpoint", async () => {
      const app = await makeApp(db);
      const instance = await db.createInstance({
        school_name: "École Suspendue",
        school_slug: "suspended-school",
        domain: "suspended.schoolsafe.cd",
        api_base: "https://suspended.schoolsafe.cd/api",
        supabase_url: "https://abc123.supabase.co",
        status: "suspended",
        setup_token: null,
        hmac_secret: "test-secret",
        is_blocked: false,
        blocked_at: null,
        trial_started_at: new Date().toISOString(),
        grace_ends_at: null,
        activated_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      const activate = await app.inject({
        method: "POST",
        url: `/instances/${instance.id}/activate`,
        headers: { "x-admin-token": ADMIN_TOKEN }
      });

      expect(activate.statusCode).toBe(200);
      expect(activate.json().data.status).toBe("active");
      expect(activate.json().data.activated_at).toBeTruthy();
      expect(activate.json().data.setup_token).toBeNull();
    });

    it("rejects activation of non-suspended instance", async () => {
      const app = await makeApp(db);
      const instance = await db.createInstance({
        school_name: "École Active",
        school_slug: "active-school",
        domain: "active.schoolsafe.cd",
        api_base: "https://active.schoolsafe.cd/api",
        supabase_url: "https://abc123.supabase.co",
        status: "active",
        setup_token: null,
        hmac_secret: "test-secret",
        is_blocked: false,
        blocked_at: null,
        trial_started_at: new Date().toISOString(),
        grace_ends_at: null,
        activated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      const activate = await app.inject({
        method: "POST",
        url: `/instances/${instance.id}/activate`,
        headers: { "x-admin-token": ADMIN_TOKEN }
      });

      expect(activate.statusCode).toBe(400);
      expect(activate.json().code).toBe("INVALID_STATE");
    });
  });

  describe("Check expired trials endpoint", () => {
    it("checks expired trials via admin endpoint", async () => {
      const app = await makeApp(db);

      const check = await app.inject({
        method: "POST",
        url: "/instances/check-expired-trials",
        headers: { "x-admin-token": ADMIN_TOKEN }
      });

      expect(check.statusCode).toBe(200);
      expect(check.json().message).toBe("Vérification des trials expirés effectuée");
    });
  });
});