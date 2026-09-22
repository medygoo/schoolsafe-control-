import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { PostgresDatabase } from "../src/db/postgres.js";
import type { Instance, InstanceStatus } from "../src/db/types.js";
import { readNormalizedPostgresCatalog } from "./helpers/postgres-catalog.js";

const enabled = process.env.CONTROL_PG17_QUALIFY === "1";
const describePg17 = enabled ? describe : describe.skip;
const ADMIN_TOKEN = "qualification-admin-token-not-production";
const EXPECTED_TABLES = [
  "admin_sessions",
  "card_print_batches",
  "card_print_requests",
  "devices",
  "instance_school_registry",
  "instances",
  "licenses"
] as const;

// Helper functions moved inside the describe block or used conditionally to avoid execution at load time
function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function safeRunId(): string {
  return (process.env.CONTROL_PG17_RUN_ID ?? "local")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .slice(0, 24);
}

function connectionString(database: string): string {
  const user = encodeURIComponent(requiredEnv("PGUSER"));
  const password = encodeURIComponent(requiredEnv("PGPASSWORD"));
  const host = requiredEnv("PGHOST");
  const port = requiredEnv("PGPORT");
  return `postgresql://${user}:${password}@${host}:${port}/${database}`;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

async function tableNames(client: InstanceType<typeof pg.Client>): Promise<string[]> {
  const result = await client.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
  );
  return result.rows.map((row) => row.table_name);
}

describePg17("Control V1 PostgreSQL 17 qualification", () => {
  const runId = safeRunId();
  const slugRunId = runId.replaceAll("_", "-");
  const zeroDatabase = `control_v1_zero_${runId}`;
  const migrationDatabase = `control_v1_migration_${runId}`;
  const equivalenceDatabase = `control_v1_equivalence_${runId}`;
  const readinessDatabase = `control_v1_readiness_${runId}`;

  // Clients and DB instances are only created when tests run
  let adminClient: InstanceType<typeof pg.Client>;
  let zeroDb: PostgresDatabase;
  let zeroApp: Awaited<ReturnType<typeof buildApp>>;
  let serverVersion = "";

  beforeAll(async () => {
    // All PG environment reads happen here, only if describePg17 is active
    adminClient = new pg.Client({ connectionString: connectionString("postgres") });
    await adminClient.connect();
    serverVersion = (await adminClient.query<{ version: string }>("SELECT version() AS version")).rows[0].version;

    for (const database of [zeroDatabase, migrationDatabase, equivalenceDatabase, readinessDatabase]) {
      await adminClient.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(database)} WITH (FORCE)`);
      await adminClient.query(`CREATE DATABASE ${quoteIdentifier(database)}`);
    }

    zeroDb = new PostgresDatabase(connectionString(zeroDatabase));
    await zeroDb.init();
    zeroApp = await buildApp({ db: zeroDb, adminToken: ADMIN_TOKEN, testRoutes: true });

    console.info(`[pg17] version=${serverVersion}`);
    console.info(`[pg17] temporary_databases=${zeroDatabase},${migrationDatabase},${equivalenceDatabase},${readinessDatabase}`);
  }, 30_000);

  afterAll(async () => {
    if (zeroApp) await zeroApp.close();
    if (zeroDb) await zeroDb.close();
    if (adminClient) {
      for (const database of [zeroDatabase, migrationDatabase, equivalenceDatabase, readinessDatabase]) {
        await adminClient.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(database)} WITH (FORCE)`);
      }
      await adminClient.end();
    }
  }, 30_000);

  it("installs from zero and consumes a setup token exactly once while remaining in trial", async () => {
    const client = new pg.Client({ connectionString: connectionString(zeroDatabase) });
    await client.connect();
    expect(await tableNames(client)).toEqual([...EXPECTED_TABLES]);
    await client.end();

    const create = await zeroApp.inject({
      method: "POST",
      url: "/instances",
      headers: { "x-admin-token": ADMIN_TOKEN },
      payload: {
        school_name: "Qualification From Zero",
        school_slug: `from-zero-${slugRunId}`,
        domain: "from-zero.example.test",
        api_base: "https://from-zero.example.test/api",
        supabase_url: "https://qualification.supabase.test"
      }
    });
    expect(create.statusCode).toBe(200);
    const instance = create.json().data as Instance;
    expect(instance.status).toBe("trial");
    expect(instance.trial_started_at).toBeTruthy();
    expect(instance.grace_ends_at).toBeTruthy();
    const dayMs = 24 * 60 * 60 * 1000;
    expect((new Date(instance.grace_ends_at!).getTime() - new Date(instance.trial_started_at!).getTime()) / dayMs)
      .toBeCloseTo(17, 6);

    const first = await zeroApp.inject({
      method: "POST",
      url: "/instances/validate-setup-token",
      payload: { setup_token: instance.setup_token }
    });
    const second = await zeroApp.inject({
      method: "POST",
      url: "/instances/validate-setup-token",
      payload: { setup_token: instance.setup_token }
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(404);
    const stored = await zeroDb.getInstanceById(instance.id);
    expect(stored?.setup_token).toBeNull();
    expect(stored?.status).toBe("trial");

    const schoolId = "11111111-1111-4111-8111-111111111111";
    await zeroDb.bindInstanceSchool(instance.id, schoolId);
    const device = await zeroDb.createDevice({
      instance_id: instance.id,
      school_id: schoolId,
      device_code: "P0-FRESH-DEVICE",
      vendor: "P0 Vendor",
      model: "P0 Model",
      serial_number: `p0-fresh-${runId}`,
      location: "P0 Lab"
    });
    const storedDevices = await zeroDb.getDevices({ instance_id: instance.id });
    expect(storedDevices).toHaveLength(1);
    expect({
      instance_id: storedDevices[0].instance_id,
      school_id: storedDevices[0].school_id,
      device_code: storedDevices[0].device_code,
      vendor: storedDevices[0].vendor,
      model: storedDevices[0].model,
      serial_number: storedDevices[0].serial_number
    }).toEqual({
      instance_id: device.instance_id,
      school_id: schoolId,
      device_code: "P0-FRESH-DEVICE",
      vendor: "P0 Vendor",
      model: "P0 Model",
      serial_number: `p0-fresh-${runId}`
    });
  });

  it("migrates the production schema without losing tables or witness data", async () => {
    const client = new pg.Client({ connectionString: connectionString(migrationDatabase) });
    await client.connect();
    const legacySchema = await readFile(resolve("tests/fixtures/control-production-schema.sql"), "utf8");
    const migration = await readFile(resolve("src/db/migration.sql"), "utf8");
    await client.query(legacySchema);

    const instanceId = "10000000-0000-4000-8000-000000000001";
    await client.query(
      `INSERT INTO instances (id, school_name, school_slug, domain, api_base, supabase_url, status, setup_token, hmac_secret)
       VALUES ($1, 'Witness School', 'witness-school', 'witness.example.test', 'https://witness.example.test/api',
               'https://witness.supabase.test', 'active', 'witness-token', 'witness-hmac')`,
      [instanceId]
    );
    await client.query(
      `INSERT INTO card_print_requests
       (id, instance_id, school_id, student_id, student_name, class_name, academic_year, front_key, back_key,
        front_signed_url, back_signed_url, signed_url_expires_at, format, status, metadata)
       VALUES ('20000000-0000-4000-8000-000000000001', $1, 'school-witness', 'student-witness', 'Student Witness',
               '6A', '2026', 'front', 'back', 'https://front.example.test', 'https://back.example.test', NOW() + INTERVAL '1 day',
               'badge', 'pending', '{"witness":true}')`,
      [instanceId]
    );
    await client.query(
      `INSERT INTO admin_sessions (id, token_hash, label, expires_at)
       VALUES ('30000000-0000-4000-8000-000000000001', 'witness-hash', 'witness-admin', NOW() + INTERVAL '1 day')`
    );
    await client.query(
      `INSERT INTO card_print_batches
       (id, instance_id, school_id, batch_id, version, card_count, r2_key, zip_signed_url,
        signed_url_expires_at, zip_sha256, status, metadata)
       VALUES ('40000000-0000-4000-8000-000000000001', $1, 'school-witness', 'batch-witness', 1, 1,
               'witness.zip', 'https://zip.example.test', NOW() + INTERVAL '1 day', 'sha256-witness', 'pending', '{"witness":true}')`,
      [instanceId]
    );
    await client.query(
      `INSERT INTO devices
       (id, instance_id, school_id, device_code, vendor, model, serial_number, location, status)
       VALUES ('50000000-0000-4000-8000-000000000001', $1, 'school-witness', 'device-witness',
               'Vendor Witness', 'Model Witness', 'serial-witness', 'Lab Witness', 'registered')`,
      [instanceId]
    );
    await client.query(
      `INSERT INTO instance_school_registry (instance_id, school_id, status)
       VALUES ($1, 'school-witness', 'active')`,
      [instanceId]
    );
    await client.query(
      `INSERT INTO licenses (instance_id, school_id, license_id, status, issued_at, expires_at, grace_days, metadata)
       VALUES ($1, 'school-witness', 'license-witness', 'active', NOW(), NOW() + INTERVAL '1 year', 3, '{"witness":true}')`,
      [instanceId]
    );

    const tablesBefore = await tableNames(client);
    const countsBefore: Record<string, number> = {};
    for (const table of EXPECTED_TABLES) {
      const count = await client.query<{ count: string }>(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`);
      countsBefore[table] = Number(count.rows[0].count);
    }

    await client.query(migration);

    expect(await tableNames(client)).toEqual(tablesBefore);
    for (const table of EXPECTED_TABLES) {
      const count = await client.query<{ count: string }>(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`);
      expect(Number(count.rows[0].count), table).toBe(countsBefore[table]);
    }
    expect(Object.values(countsBefore).every((count) => count === 1)).toBe(true);

    const witness = await client.query<{ school_name: string; setup_token: string }>(
      "SELECT school_name, setup_token FROM instances WHERE id = $1",
      [instanceId]
    );
    expect(witness.rows[0]).toEqual({ school_name: "Witness School", setup_token: "witness-token" });

    const columns = await client.query<{ column_name: string; data_type: string; is_nullable: string }>(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'instances'
         AND column_name IN ('setup_token', 'trial_started_at', 'grace_ends_at', 'activated_at')`
    );
    const byName = Object.fromEntries(columns.rows.map((row) => [row.column_name, row]));
    expect(byName.setup_token.is_nullable).toBe("YES");
    for (const column of ["trial_started_at", "grace_ends_at", "activated_at"]) {
      expect(byName[column].data_type).toBe("timestamp with time zone");
    }

    const constraint = await client.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition
       FROM pg_constraint WHERE conname = 'instances_status_check' AND conrelid = 'instances'::regclass`
    );
    for (const status of ["trial", "grace", "active", "suspended", "blocked"]) {
      expect(constraint.rows[0].definition).toContain(status);
    }
    await client.query(
      `INSERT INTO instances (school_name, school_slug, domain, api_base, supabase_url, status, setup_token, hmac_secret)
       VALUES ('Nullable Token', 'nullable-token', 'nullable.example.test', 'https://nullable.example.test/api',
               'https://nullable.supabase.test', 'trial', NULL, 'nullable-hmac')`
    );
    await expect(client.query("UPDATE instances SET status = 'invalid' WHERE id = $1", [instanceId]))
      .rejects.toMatchObject({ code: "23514" });
    console.info(`[pg17] migration_row_counts=${JSON.stringify(countsBefore)}`);
    await client.end();
  });

  it("keeps fresh and fully migrated PostgreSQL schemas structurally equivalent", async () => {
    const freshClient = new pg.Client({ connectionString: connectionString(zeroDatabase) });
    const migratedClient = new pg.Client({ connectionString: connectionString(equivalenceDatabase) });
    await Promise.all([freshClient.connect(), migratedClient.connect()]);
    try {
      const legacySchema = await readFile(resolve("tests/fixtures/control-production-schema.sql"), "utf8");
      const migration = await readFile(resolve("src/db/migration.sql"), "utf8");
      await migratedClient.query(legacySchema);
      await migratedClient.query(migration);

      const freshCatalog = await readNormalizedPostgresCatalog(freshClient);
      const migratedCatalog = await readNormalizedPostgresCatalog(migratedClient);
      expect(migratedCatalog).toEqual(freshCatalog);
      console.info(`[pg17] catalog_equivalence_tables=${freshCatalog.tables.length}`);
    } finally {
      await Promise.all([freshClient.end(), migratedClient.end()]);
    }
  });

  it("reports PostgreSQL readiness without weakening process liveness", async () => {
    const readinessDb = new PostgresDatabase(connectionString(readinessDatabase));
    await readinessDb.init();
    const readinessApp = await buildApp({ db: readinessDb, adminToken: ADMIN_TOKEN, testRoutes: true });
    try {
      const available = await readinessApp.inject({ method: "GET", url: "/ready" });
      expect(available.statusCode).toBe(200);
      expect(available.json()).toEqual({ status: "ready" });

      await readinessDb.close();
      const unavailable = await readinessApp.inject({ method: "GET", url: "/ready" });
      expect(unavailable.statusCode).toBe(503);
      expect(unavailable.json()).toEqual({ status: "not_ready" });
      const live = await readinessApp.inject({ method: "GET", url: "/health" });
      expect(live.statusCode).toBe(200);
      console.info("[pg17] readiness=200,503 liveness_after_db_loss=200");
    } finally {
      await readinessApp.close();
    }
  });

  it("executes all lifecycle transitions against PostgreSQL 17", async () => {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    let sequence = 0;
    async function create(status: InstanceStatus, setupToken: string, dates?: { trialStart?: number; graceEnd?: number }) {
      sequence += 1;
      const timestamp = new Date().toISOString();
      return zeroDb.createInstance({
        school_name: `Lifecycle ${sequence}`,
        school_slug: `lifecycle-${slugRunId}-${sequence}`,
        domain: `lifecycle-${sequence}.example.test`,
        api_base: `https://lifecycle-${sequence}.example.test/api`,
        supabase_url: "https://qualification.supabase.test",
        status,
        setup_token: setupToken,
        hmac_secret: `hmac-${sequence}`,
        trial_started_at: new Date(dates?.trialStart ?? now).toISOString(),
        grace_ends_at: new Date(dates?.graceEnd ?? now + 17 * dayMs).toISOString(),
        activated_at: null,
        created_at: timestamp,
        updated_at: timestamp
      });
    }

    const toGrace = await create("trial", "token-to-grace", {
      trialStart: now - 15 * dayMs,
      graceEnd: now + 2 * dayMs
    });
    const toSuspended = await create("grace", "token-to-suspended", {
      trialStart: now - 18 * dayMs,
      graceEnd: now - dayMs
    });
    await zeroDb.checkAndExpireTrials();
    expect((await zeroDb.getInstanceById(toGrace.id))?.status).toBe("grace");
    expect((await zeroDb.getInstanceById(toSuspended.id))?.status).toBe("suspended");

    for (const status of ["trial", "grace", "suspended"] as const) {
      const instance = await create(status, `activate-${status}`);
      const response = await zeroApp.inject({
        method: "POST",
        url: `/instances/${instance.id}/activate`,
        headers: { "x-admin-token": ADMIN_TOKEN }
      });
      expect(response.statusCode, `${status} -> active`).toBe(200);
      expect((await zeroDb.getInstanceById(instance.id))?.status).toBe("active");
    }

    for (const candidate of [
      { status: "active" as const, token: "reject-active" },
      { status: "suspended" as const, token: "reject-suspended" },
      { status: "blocked" as const, token: "reject-blocked" },
      { status: "grace" as const, token: "reject-expired-grace", graceEnd: now - dayMs }
    ]) {
      const instance = await create(candidate.status, candidate.token, { graceEnd: candidate.graceEnd });
      const response = await zeroApp.inject({
        method: "POST",
        url: "/instances/validate-setup-token",
        payload: { setup_token: candidate.token }
      });
      expect(response.statusCode, `reject ${candidate.status}`).toBe(404);
      expect((await zeroDb.getInstanceById(instance.id))?.setup_token).toBe(candidate.token);
    }
  });

  it("allows exactly one concurrent consumption of the same setup token", async () => {
    const timestamp = new Date().toISOString();
    const instance = await zeroDb.createInstance({
      school_name: "Concurrent Qualification",
      school_slug: `concurrent-${slugRunId}`,
      domain: "concurrent.example.test",
      api_base: "https://concurrent.example.test/api",
      supabase_url: "https://qualification.supabase.test",
      status: "trial",
      setup_token: "one-concurrent-token",
      hmac_secret: "concurrent-hmac",
      trial_started_at: timestamp,
      grace_ends_at: new Date(Date.now() + 17 * 24 * 60 * 60 * 1000).toISOString(),
      activated_at: null,
      created_at: timestamp,
      updated_at: timestamp
    });
    const responses = await Promise.all([
      zeroApp.inject({ method: "POST", url: "/instances/validate-setup-token", payload: { setup_token: "one-concurrent-token" } }),
      zeroApp.inject({ method: "POST", url: "/instances/validate-setup-token", payload: { setup_token: "one-concurrent-token" } })
    ]);
    const statuses = responses.map((response) => response.statusCode).sort();
    expect(statuses).toEqual([200, 404]);
    expect((await zeroDb.getInstanceById(instance.id))?.setup_token).toBeNull();
    console.info(`[pg17] concurrent_consumption_statuses=${statuses.join(",")}`);
  });
});
