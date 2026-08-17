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

describe("Control App", () => {
  let db: SqliteDatabase;

  beforeEach(async () => {
    db = await makeDb();
  });

  afterEach(async () => {
    await db.close();
  });

  describe("Health", () => {
    it("returns ok", async () => {
      const app = await makeApp(db);
      const res = await app.inject({ method: "GET", url: "/health" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: "ok" });
    });

    it("returns ready", async () => {
      const app = await makeApp(db);
      const res = await app.inject({ method: "GET", url: "/ready" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: "ready" });
    });
  });

  describe("Instances", () => {
    it("rejects requests without admin token", async () => {
      const app = await makeApp(db);
      const res = await app.inject({ method: "GET", url: "/instances" });
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe("AUTH_REQUIRED");
    });

    it("creates and lists an instance", async () => {
      const app = await makeApp(db);
      const create = await app.inject({
        method: "POST",
        url: "/instances",
        headers: { "x-admin-token": ADMIN_TOKEN, "content-type": "application/json" },
        payload: JSON.stringify({
          school_name: "École du Sage",
          school_slug: "sage",
          domain: "sage.schoolsafe.cd",
          api_base: "https://sage.schoolsafe.cd/api",
          supabase_url: "https://abc123.supabase.co"
        })
      });
      expect(create.statusCode).toBe(200);
      const instance = create.json().data;
      expect(instance.school_name).toBe("École du Sage");
      expect(instance.status).toBe("active");
      expect(instance.setup_token).toHaveLength(64);
      expect(instance.hmac_secret).toHaveLength(64);

      const list = await app.inject({
        method: "GET",
        url: "/instances",
        headers: { "x-admin-token": ADMIN_TOKEN }
      });
      expect(list.statusCode).toBe(200);
      expect(list.json().data).toHaveLength(1);
    });

    it("blocks and unblocks an instance", async () => {
      const app = await makeApp(db);
      const create = await app.inject({
        method: "POST",
        url: "/instances",
        headers: { "x-admin-token": ADMIN_TOKEN, "content-type": "application/json" },
        payload: JSON.stringify({
          school_name: "École du Sage",
          school_slug: "sage",
          domain: "sage.schoolsafe.cd",
          api_base: "https://sage.schoolsafe.cd/api",
          supabase_url: "https://abc123.supabase.co"
        })
      });
      const id = create.json().data.id;

      const block = await app.inject({
        method: "POST",
        url: `/instances/${id}/block`,
        headers: { "x-admin-token": ADMIN_TOKEN }
      });
      expect(block.statusCode).toBe(200);
      expect(block.json().data.status).toBe("blocked");

      const unblock = await app.inject({
        method: "POST",
        url: `/instances/${id}/unblock`,
        headers: { "x-admin-token": ADMIN_TOKEN }
      });
      expect(unblock.statusCode).toBe(200);
      expect(unblock.json().data.status).toBe("active");
    });
  });

  describe("Card print requests", () => {
    async function createInstance(app: Awaited<ReturnType<typeof makeApp>>) {
      const res = await app.inject({
        method: "POST",
        url: "/instances",
        headers: { "x-admin-token": ADMIN_TOKEN, "content-type": "application/json" },
        payload: JSON.stringify({
          school_name: "École du Sage",
          school_slug: "sage",
          domain: "sage.schoolsafe.cd",
          api_base: "https://sage.schoolsafe.cd/api",
          supabase_url: "https://abc123.supabase.co"
        })
      });
      return res.json().data;
    }

    function sign(instance: { id: string; hmac_secret: string }, payload: object) {
      const body = JSON.stringify(payload);
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = signRequest({
        method: "POST",
        path: "/card-print-requests",
        body,
        timestamp,
        secret: instance.hmac_secret
      });
      return { body, timestamp, signature };
    }

    it("accepts a request with valid HMAC", async () => {
      const app = await makeApp(db);
      const instance = await createInstance(app);
      const payload = {
        school_id: "sch-1",
        student_id: "stu-1",
        student_name: "Kabongo Lukusa Daniel",
        class_name: "3ᵉ Primaire",
        academic_year: "2025-2026",
        front_key: "cards/sage/2025-2026/LS-0042/front.png",
        back_key: "cards/sage/2025-2026/LS-0042/back.png",
        front_signed_url: "https://r2.example.com/front.png?sig=abc",
        back_signed_url: "https://r2.example.com/back.png?sig=def",
        signed_url_expires_at: "2026-08-20T00:00:00Z",
        format: "badge"
      };
      const { body, timestamp, signature } = sign(instance, payload);

      const res = await app.inject({
        method: "POST",
        url: "/card-print-requests",
        headers: {
          "x-schoolsafe-instance": instance.id,
          "x-schoolsafe-timestamp": String(timestamp),
          "x-schoolsafe-signature": signature,
          "content-type": "application/json"
        },
        payload: body
      });

      expect(res.statusCode).toBe(200);
      const record = res.json().data;
      expect(record.status).toBe("pending");
      expect(record.instance_id).toBe(instance.id);
    });

    it("rejects a request with invalid HMAC", async () => {
      const app = await makeApp(db);
      const instance = await createInstance(app);
      const payload = {
        school_id: "sch-1",
        student_id: "stu-1",
        student_name: "Kabongo Lukusa Daniel",
        class_name: "3ᵉ Primaire",
        academic_year: "2025-2026",
        front_key: "cards/sage/2025-2026/LS-0042/front.png",
        back_key: "cards/sage/2025-2026/LS-0042/back.png",
        front_signed_url: "https://r2.example.com/front.png?sig=abc",
        back_signed_url: "https://r2.example.com/back.png?sig=def",
        signed_url_expires_at: "2026-08-20T00:00:00Z",
        format: "badge"
      };
      const body = JSON.stringify(payload);

      const res = await app.inject({
        method: "POST",
        url: "/card-print-requests",
        headers: {
          "x-schoolsafe-instance": instance.id,
          "x-schoolsafe-timestamp": String(Math.floor(Date.now() / 1000)),
          "x-schoolsafe-signature": "bad-signature",
          "content-type": "application/json"
        },
        payload: body
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe("AUTH_INVALID");
    });

    it("lists and marks requests as printed", async () => {
      const app = await makeApp(db);
      const instance = await createInstance(app);
      const payload = {
        school_id: "sch-1",
        student_id: "stu-1",
        student_name: "Kabongo Lukusa Daniel",
        class_name: "3ᵉ Primaire",
        academic_year: "2025-2026",
        front_key: "cards/sage/2025-2026/LS-0042/front.png",
        back_key: "cards/sage/2025-2026/LS-0042/back.png",
        front_signed_url: "https://r2.example.com/front.png?sig=abc",
        back_signed_url: "https://r2.example.com/back.png?sig=def",
        signed_url_expires_at: "2026-08-20T00:00:00Z",
        format: "badge"
      };
      const { body, timestamp, signature } = sign(instance, payload);

      const created = await app.inject({
        method: "POST",
        url: "/card-print-requests",
        headers: {
          "x-schoolsafe-instance": instance.id,
          "x-schoolsafe-timestamp": String(timestamp),
          "x-schoolsafe-signature": signature,
          "content-type": "application/json"
        },
        payload: body
      });
      const id = created.json().data.id;

      const list = await app.inject({
        method: "GET",
        url: "/card-print-requests",
        headers: { "x-admin-token": ADMIN_TOKEN }
      });
      expect(list.statusCode).toBe(200);
      expect(list.json().data).toHaveLength(1);

      const printed = await app.inject({
        method: "POST",
        url: `/card-print-requests/${id}/print`,
        headers: { "x-admin-token": ADMIN_TOKEN }
      });
      expect(printed.statusCode).toBe(200);
      expect(printed.json().data.status).toBe("printed");
      expect(printed.json().data.printed_at).toBeTruthy();
    });
  });
});
