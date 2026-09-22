import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { signRequest } from "../src/auth/hmac.js";
import { SqliteDatabase } from "../src/db/sqlite.js";
import type { Instance } from "../src/db/types.js";

const ADMIN_TOKEN = "validation-test-admin-token";

describe("Zod validation errors", () => {
  let db: SqliteDatabase;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let instance: Instance;

  beforeEach(async () => {
    db = new SqliteDatabase(":memory:");
    await db.init();
    app = await buildApp({ db, adminToken: ADMIN_TOKEN, testRoutes: true });
    const create = await app.inject({
      method: "POST",
      url: "/instances",
      headers: { "x-admin-token": ADMIN_TOKEN },
      payload: {
        school_name: "Validation School",
        school_slug: "validation-school",
        domain: "validation.example.test",
        api_base: "https://validation.example.test/api",
        supabase_url: "https://validation.supabase.test"
      }
    });
    instance = create.json().data as Instance;
    await db.bindInstanceSchool(instance.id, "validation-school-id");
  });

  afterEach(async () => {
    await app.close();
    await db.close();
  });

  function hmacHeaders(path: string, payload: unknown): Record<string, string> {
    const timestamp = Math.floor(Date.now() / 1000);
    const body = JSON.stringify(payload);
    return {
      "x-schoolsafe-instance": instance.id,
      "x-schoolsafe-timestamp": String(timestamp),
      "x-schoolsafe-signature": signRequest({
        method: "POST",
        path,
        body,
        timestamp,
        secret: instance.hmac_secret
      })
    };
  }

  function expectValidationError(response: Awaited<ReturnType<typeof app.inject>>): void {
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.code).toBe("VALIDATION_INVALID");
    expect(body.request_id).toEqual(expect.any(String));
    expect(body.retryable).toBe(false);
    expect(response.body).not.toContain("issues");
    expect(response.body).not.toContain("stack");
  }

  it("maps invalid instance input to 400", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/instances",
      headers: { "x-admin-token": ADMIN_TOKEN },
      payload: { school_name: "", school_slug: "INVALID SLUG" }
    });
    expectValidationError(response);
  });

  it("maps invalid card-request input to 400 after valid HMAC authentication", async () => {
    const payload = { student_id: "" };
    const response = await app.inject({
      method: "POST",
      url: "/card-print-requests",
      headers: hmacHeaders("/card-print-requests", payload),
      payload
    });
    expectValidationError(response);
  });

  it("maps invalid card-batch input to 400 after valid HMAC authentication", async () => {
    const payload = { batch_id: "", version: 0 };
    const response = await app.inject({
      method: "POST",
      url: "/card-print-batches",
      headers: hmacHeaders("/card-print-batches", payload),
      payload
    });
    expectValidationError(response);
  });

  it("maps invalid device registration input to 400 after valid HMAC authentication", async () => {
    const payload = { device_code: "x", vendor: "", model: "", serial_number: "x" };
    const response = await app.inject({
      method: "POST",
      url: "/device-registrations",
      headers: hmacHeaders("/device-registrations", payload),
      payload
    });
    expectValidationError(response);
  });

  it("maps invalid device status input to 400", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/devices/not-used/status",
      headers: { "x-admin-token": ADMIN_TOKEN },
      payload: { status: "unknown" }
    });
    expectValidationError(response);
  });
});
