import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresDatabase } from "../src/db/postgres.js";
const enabled = process.env.CONTROL_PG17_QUALIFY === "1";
const describePg17 = enabled ? describe : describe.skip;
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
describePg17("LOT 0: Migration & Foundation DB", () => {
const testDatabase = `control_lot0_test_${Date.now()}`;
let adminClient: InstanceType<typeof pg.Client>;
let db: PostgresDatabase | undefined;
let serverVersion = "";
beforeAll(async () => {
// All PG environment reads happen here, only if describePg17 is active
adminClient = new pg.Client({ connectionString: connectionString("postgres") });
await adminClient.connect();
serverVersion = (await adminClient.query<{ version: string }>("SELECT version() AS version")).rows[0].version;
await adminClient.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(testDatabase)} WITH (FORCE)`);
await adminClient.query(`CREATE DATABASE ${quoteIdentifier(testDatabase)}`);
console.info(`[pg17-lot0] version=${serverVersion}`);
}, 30_000);
afterAll(async () => {
if (db) await db.close();
if (adminClient) {
await adminClient.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(testDatabase)} WITH (FORCE)`);
await adminClient.end();
}
}, 30_000);
it("migrates legacy schema with named constraint and blocked status", async () => {
const client = new pg.Client({ connectionString: connectionString(testDatabase) });
await client.connect();
// Create legacy schema with explicit constraint name and blocked status
await client.query(`
CREATE TABLE instances (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
school_name TEXT NOT NULL,
school_slug TEXT NOT NULL UNIQUE,
domain TEXT NOT NULL,
api_base TEXT NOT NULL,
supabase_url TEXT NOT NULL,
status TEXT NOT NULL DEFAULT 'active' CONSTRAINT instances_status_check CHECK (status IN ('trial', 'active', 'blocked')),
setup_token TEXT,
hmac_secret TEXT NOT NULL,
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`);
// Insert witness data including a blocked instance
await client.query(`
INSERT INTO instances (school_name, school_slug, domain, api_base, supabase_url, status, setup_token, hmac_secret, updated_at)
VALUES
('Active School', 'active-school', 'active.example.test', 'https://active.example.test/api', 'https://active.supabase.test', 'active', 'token-active', 'hmac-active', NOW()),
('Blocked School', 'blocked-school', 'blocked.example.test', 'https://blocked.example.test/api', 'https://blocked.supabase.test', 'blocked', 'token-blocked', 'hmac-blocked', NOW() - INTERVAL '1 day');
`);
const migration = await readFile(resolve("src/db/migration.sql"), "utf8");
await client.query(migration);
// Verify migration results
const activeInstance = await client.query<{ status: string; is_blocked: boolean }>(
"SELECT status, is_blocked FROM instances WHERE school_slug = 'active-school'"
);
expect(activeInstance.rows[0].status).toBe("active");
expect(activeInstance.rows[0].is_blocked).toBe(false);
const blockedInstance = await client.query<{ status: string; is_blocked: boolean; blocked_at: string }>(
"SELECT status, is_blocked, blocked_at FROM instances WHERE school_slug = 'blocked-school'"
);
expect(blockedInstance.rows[0].status).toBe("suspended");
expect(blockedInstance.rows[0].is_blocked).toBe(true);
expect(blockedInstance.rows[0].blocked_at).toBeTruthy();
// Verify new constraint allows only valid lifecycles
await expect(client.query("UPDATE instances SET status = 'invalid' WHERE school_slug = 'active-school'"))
.rejects.toMatchObject({ code: "23514" });
await client.end();
});
it("migrates legacy schema with renamed constraint", async () => {
const renameDb = `control_lot0_rename_${Date.now()}`;
await adminClient.query(`CREATE DATABASE ${quoteIdentifier(renameDb)}`);
const client = new pg.Client({ connectionString: connectionString(renameDb) });
await client.connect();
// Create legacy schema with renamed constraint
await client.query(`
CREATE TABLE instances (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
school_name TEXT NOT NULL,
school_slug TEXT NOT NULL UNIQUE,
domain TEXT NOT NULL,
api_base TEXT NOT NULL,
supabase_url TEXT NOT NULL,
status TEXT NOT NULL DEFAULT 'active' CONSTRAINT my_custom_status_check CHECK (status IN ('trial', 'active', 'blocked')),
setup_token TEXT,
hmac_secret TEXT NOT NULL,
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`);
const migration = await readFile(resolve("src/db/migration.sql"), "utf8");
await client.query(migration);
// Verify migration succeeded despite renamed constraint
const columns = await client.query<{ column_name: string }>(
"SELECT column_name FROM information_schema.columns WHERE table_name = 'instances' AND column_name IN ('is_blocked', 'blocked_at')"
);
expect(columns.rows.map(r => r.column_name).sort()).toEqual(["blocked_at", "is_blocked"]);
await client.end();
await adminClient.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(renameDb)} WITH (FORCE)`);
});
it("is idempotent on second execution", async () => {
const client = new pg.Client({ connectionString: connectionString(testDatabase) });
await client.connect();
const migration = await readFile(resolve("src/db/migration.sql"), "utf8");
// Second execution should not fail
await client.query(migration);
// Verify structure remains consistent
const columns = await client.query<{ column_name: string }>(
"SELECT column_name FROM information_schema.columns WHERE table_name = 'instances' AND column_name IN ('is_blocked', 'blocked_at')"
);
expect(columns.rows.map(r => r.column_name).sort()).toEqual(["blocked_at", "is_blocked"]);
await client.end();
});
it("fresh schema matches migrated schema catalog", async () => {
const freshDb = `control_lot0_fresh_${Date.now()}`;
await adminClient.query(`CREATE DATABASE ${quoteIdentifier(freshDb)}`);
// Apply fresh schema
const freshDbInstance = new PostgresDatabase(connectionString(freshDb));
await freshDbInstance.init();
await freshDbInstance.close();
// Compare catalogs
const migratedClient = new pg.Client({ connectionString: connectionString(testDatabase) });
const freshClient = new pg.Client({ connectionString: connectionString(freshDb) });
await migratedClient.connect();
await freshClient.connect();
const migratedTables = await tableNames(migratedClient);
const freshTables = await tableNames(freshClient);
expect(freshTables).toEqual(migratedTables);
// Compare columns for instances table
const migratedCols = await migratedClient.query<{ column_name: string, data_type: string }>(
"SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'instances' ORDER BY ordinal_position"
);
const freshCols = await freshClient.query<{ column_name: string, data_type: string }>(
"SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'instances' ORDER BY ordinal_position"
);
expect(freshCols.rows).toEqual(migratedCols.rows);
await migratedClient.end();
await freshClient.end();
await adminClient.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(freshDb)} WITH (FORCE)`);
});
});