# Control P0 Runtime and Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Control V1 safe on a fresh or migrated PostgreSQL 17 database, fail closed on invalid production database configuration, expose dependency-aware readiness, return HTTP 400 for invalid input, and run the PostgreSQL qualification in protected CI.

**Architecture:** Keep `schema.sql` and the historical fixture-plus-migrations path structurally convergent, with a reusable PostgreSQL catalog reader proving equality. Add one `ping()` boundary to the existing database abstraction, keep `/health` as liveness, and make `/ready` the only dependency-aware endpoint. Make adapter selection explicit and deterministic before any network connection is attempted.

**Tech Stack:** TypeScript 5.8, Node.js 22, Fastify 5, Zod 3, Vitest 3, PostgreSQL 17.11, Docker, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-22-control-p0-runtime-schema-design.md`

## Global Constraints

- Work only on `fix/control-v1-p0-runtime-schema` based on `production@5a69b87b49404c4d96397c4f8fda9a918cceda02`.
- No deployment, merge, production database change, restore, or production restart.
- Do not change `CONTROL_DEPLOY_ENABLED`.
- Use disposable PostgreSQL 17 databases only.
- Do not remove an existing table, column, or constraint.
- Every production-code change follows RED, GREEN, then refactor.

## Review Focus

- A PostgreSQL URL with the right prefix but no host/database must fail before adapter construction; covered in Task 2.
- A readiness database error containing credentials must produce a generic 503 body; covered in Task 3.
- A migrated catalog with the correct columns but a wrong FK delete action or index predicate must fail equivalence; covered in Task 1.
- Invalid authenticated HMAC payloads must reach validation and return 400 rather than being rejected earlier as 401; covered in Task 4.
- The CI test command must not silently skip PostgreSQL qualification; covered in Task 5 and final local CI-equivalent execution.

---

### Task 1: Fresh Device Hub schema and catalog equivalence

**Files:**
- Modify: `src/db/schema.sql`
- Modify: `src/db/migration.sql`
- Create: `tests/helpers/postgres-catalog.ts`
- Modify: `tests/postgres17-qualification.test.ts`

**Interfaces:**
- Produces: `readPostgresCatalog(client): Promise<NormalizedCatalog>` for normalized comparison of tables, columns, keys, checks, referential actions, and indexes.
- Consumes: the existing PostgreSQL qualification connection helpers and disposable databases.

- [ ] **Step 1: Add a failing fresh Device Hub test**

Create an instance through `PostgresDatabase`, call `bindInstanceSchool`, then call `createDevice` with literal values and assert the stored record exactly:

```ts
expect({
  instance_id: device.instance_id,
  school_id: device.school_id,
  device_code: device.device_code,
  vendor: device.vendor,
  model: device.model,
  serial_number: device.serial_number
}).toEqual({
  instance_id: instance.id,
  school_id: "11111111-1111-4111-8111-111111111111",
  device_code: "P0-FRESH-DEVICE",
  vendor: "P0 Vendor",
  model: "P0 Model",
  serial_number: `p0-fresh-${runId}`
});
```

- [ ] **Step 2: Run RED for Device Hub**

Run with a real PostgreSQL 17 instance from PowerShell:

```bash
$env:CONTROL_PG17_QUALIFY='1'
$env:PGHOST='127.0.0.1'
$env:PGPORT='55433'
$env:PGUSER='postgres'
$env:PGPASSWORD='control-p0-test'
$env:CONTROL_PG17_RUN_ID='p0_red'
npm test -- tests/postgres17-qualification.test.ts
```

Expected: FAIL from PostgreSQL because fresh `devices.school_id` does not exist.

- [ ] **Step 3: Add `school_id` minimally**

Add `school_id TEXT NOT NULL` immediately after `instance_id` in the fresh `devices` table. Run the targeted test and expect it to pass.

- [ ] **Step 4: Add a failing normalized catalog comparison**

Implement a catalog reader using `pg_catalog`/`information_schema` queries. Its normalized result must include literal structures for:

```ts
type NormalizedCatalog = {
  tables: Array<{
    name: string;
    columns: Array<{ name: string; type: string; nullable: boolean; default: string | null }>;
    primaryKeys: Array<{ columns: string[] }>;
    foreignKeys: Array<{ columns: string[]; referencedTable: string; referencedColumns: string[]; onDelete: string }>;
    uniqueConstraints: Array<{ columns: string[] }>;
    checks: string[];
    indexes: Array<{ columns: string[]; unique: boolean; predicate: string | null }>;
  }>;
};
```

Normalize whitespace, schema qualification, generated casts, ordering, and UUID-default spelling only when explicitly defined in the helper. Do not normalize away missing objects or index predicates.

Build fresh and migrated databases, then assert:

```ts
expect(await readPostgresCatalog(migratedClient))
  .toEqual(await readPostgresCatalog(freshClient));
```

- [ ] **Step 5: Run RED for equivalence**

Expected differences must name at least UUID defaults, the setup-token index predicate, and the missing migrated slug index. Confirm this is a failed assertion, not a setup error.

- [ ] **Step 6: Converge the schemas minimally**

In `schema.sql`, use `gen_random_uuid()` and a non-partial `idx_instances_setup_token`, matching the historical path. In `migration.sql`, add:

```sql
CREATE INDEX IF NOT EXISTS idx_instances_slug ON instances(school_slug);
```

Do not remove any table, column, constraint, or data.

- [ ] **Step 7: Verify GREEN and migration preservation**

Run the whole PostgreSQL qualification file. Expected: fresh Device Hub succeeds, catalogs are equal, all seven witness rows survive migration, trial/grace succeeds, and concurrent token results remain `[200, 404]`.

- [ ] **Step 8: Commit Task 1**

```bash
git add src/db/schema.sql src/db/migration.sql tests/helpers/postgres-catalog.ts tests/postgres17-qualification.test.ts
git diff --cached --check
git commit -m "fix(db): align fresh and migrated PostgreSQL schemas"
```

### Task 2: Fail-closed database adapter selection

**Files:**
- Modify: `src/db/index.ts`
- Create: `tests/database-selection.test.ts`

**Interfaces:**
- Produces: `createDatabase(url?: string, nodeEnv?: string): ControlDatabase` with explicit PostgreSQL and `sqlite:` parsing.
- Consumes: `PostgresDatabase` and `SqliteDatabase` constructors without initiating a connection.

- [ ] **Step 1: Write table-driven failing tests**

Use literal cases:

```ts
it.each([
  [undefined, "production"],
  ["", "production"],
  ["sqlite::memory:", "production"],
  ["not-a-dsn", "production"],
  ["postgresql://", "production"]
])("fails closed for %j in %s", (dsn, nodeEnv) => {
  expect(() => createDatabase(dsn, nodeEnv)).toThrow(/PostgreSQL database configuration is required/);
});

it("accepts a valid production PostgreSQL DSN", async () => {
  const db = createDatabase("postgresql://control:secret@db.example.test:5432/control", "production");
  expect(db).toBeInstanceOf(PostgresDatabase);
  await db.close();
});

it("accepts explicit in-memory SQLite in test", async () => {
  const db = createDatabase("sqlite::memory:", "test");
  expect(db).toBeInstanceOf(SqliteDatabase);
  await db.close();
});
```

- [ ] **Step 2: Run RED**

```bash
npm test -- tests/database-selection.test.ts
```

Expected: current fallback constructs SQLite for missing/malformed production values and does not understand `sqlite:`.

- [ ] **Step 3: Implement strict parsing**

Parse PostgreSQL URLs with `new URL()`, require protocol `postgres:` or `postgresql:`, non-empty hostname, and a non-root database pathname. In production, throw the same generic configuration error for every invalid value without embedding the DSN. In test/development, accept only explicit `sqlite:<path>` or a valid PostgreSQL URL.

- [ ] **Step 4: Verify GREEN and full unit suite**

Run the targeted file, then `npm test` without PostgreSQL qualification. Confirm no implicit SQLite path remains in `createDatabase`.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/db/index.ts tests/database-selection.test.ts
git diff --cached --check
git commit -m "fix(runtime): require PostgreSQL in production"
```

### Task 3: Dependency-aware readiness

**Files:**
- Modify: `src/db/types.ts`
- Modify: `src/db/postgres.ts`
- Modify: `src/db/sqlite.ts`
- Modify: `src/app.ts`
- Modify: `tests/control-app.test.ts`

**Interfaces:**
- Produces: `ControlDatabase.ping(): Promise<void>`.
- PostgreSQL contract: resolve after `SELECT 1`; SQLite contract: resolve after local `SELECT 1`.
- HTTP contract: `/ready` returns `{status:"ready"}`/200 or `{status:"not_ready"}`/503.

- [ ] **Step 1: Write failing readiness tests**

Keep the existing healthy readiness assertion. Add a failing dependency case at the database boundary:

```ts
it("returns 503 without exposing the database error", async () => {
  vi.spyOn(db, "ping").mockRejectedValue(new Error("postgresql://user:secret@db/control"));
  const app = await makeApp(db);
  const response = await app.inject({ method: "GET", url: "/ready" });
  expect(response.statusCode).toBe(503);
  expect(response.json()).toEqual({ status: "not_ready" });
  expect(response.body).not.toContain("secret");
});
```

Also assert `/health` still returns 200 while the same `ping()` rejects.

- [ ] **Step 2: Run RED**

Expected: `ping` is absent at compile/test time or `/ready` still returns 200.

- [ ] **Step 3: Add `ping()` implementations and route behavior**

PostgreSQL:

```ts
async ping(): Promise<void> {
  await this.pool.query("SELECT 1");
}
```

SQLite:

```ts
async ping(): Promise<void> {
  this.db.prepare("SELECT 1").get();
}
```

Catch readiness errors inside the route and return only the generic 503 body.

- [ ] **Step 4: Verify GREEN**

Run `npm run typecheck` and the health tests. Then, during PostgreSQL qualification, stop or target a disposable DB connection and prove `/ready` changes from 200 to 503 without affecting `/health`.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/db/types.ts src/db/postgres.ts src/db/sqlite.ts src/app.ts tests/control-app.test.ts
git diff --cached --check
git commit -m "fix(health): make readiness depend on the database"
```

### Task 4: Zod validation errors return HTTP 400

**Files:**
- Modify: `src/app.ts`
- Create: `tests/validation-errors.test.ts`

**Interfaces:**
- Produces: global mapping `ZodError -> 400 VALIDATION_INVALID`.
- Preserves: `ControlAppError` statuses and unknown-error HTTP 500 behavior.

- [ ] **Step 1: Write one failing case per route family**

Build a real in-memory SQLite application and valid HMAC headers where required. Submit invalid payloads to:

```text
POST /instances
POST /card-print-requests
POST /card-print-batches
POST /device-registrations
POST /devices/:id/status
```

For every response assert status 400, code `VALIDATION_INVALID`, presence of a request ID, and absence of stack traces/internal Zod details.

- [ ] **Step 2: Run RED**

```bash
npm test -- tests/validation-errors.test.ts
```

Expected: all five routes currently return `500 INTERNAL_ERROR`.

- [ ] **Step 3: Implement the global mapping**

Import `ZodError`, distinguish it from `ControlAppError`, and construct the same generic public error envelope with `retryable:false`. Unknown errors remain HTTP 500 and are logged server-side.

- [ ] **Step 4: Verify GREEN and protect existing codes**

Run the new tests plus the full unit suite. Confirm existing 401, 404, and application-error tests are unchanged.

- [ ] **Step 5: Commit Task 4**

```bash
git add src/app.ts tests/validation-errors.test.ts
git diff --cached --check
git commit -m "fix(api): return 400 for invalid Zod payloads"
```

### Task 5: Mandatory PostgreSQL 17 CI qualification

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: a PostgreSQL `17.11-bookworm` service available to the existing `test` job.
- Supplies: `CONTROL_PG17_QUALIFY=1`, `PGHOST=127.0.0.1`, the mapped service port, ephemeral user/password, and a run-specific database suffix.

- [ ] **Step 1: Record the pre-change gap**

Run the normal suite and retain the baseline evidence that `tests/postgres17-qualification.test.ts` reports four skipped tests when the flag is absent.

- [ ] **Step 2: Add the PostgreSQL service and mandatory test environment**

Configure the job with:

```yaml
services:
  postgres:
    image: postgres:17.11-bookworm
    env:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: control-ci-test
    ports:
      - 5432:5432
    options: >-
      --health-cmd "pg_isready -U postgres"
      --health-interval 5s
      --health-timeout 5s
      --health-retries 10
```

Set the `npm test` step environment so the PostgreSQL suite cannot skip:

```yaml
env:
  CONTROL_PG17_QUALIFY: "1"
  CONTROL_PG17_RUN_ID: "ci_${{ github.run_id }}_${{ github.run_attempt }}"
  PGHOST: 127.0.0.1
  PGPORT: "5432"
  PGUSER: postgres
  PGPASSWORD: control-ci-test
```

- [ ] **Step 3: Validate workflow and reproduce CI locally**

Run the existing pinned validator:

```powershell
& 'C:\Users\PC\Documents\Codex\2026-09-20\o\outputs\INFRA2-20260921\tools\actionlint\actionlint.exe' .github/workflows/ci.yml
```

Then run the same `npm test` environment against a disposable PostgreSQL 17 container and verify zero skipped PostgreSQL tests. Do not trigger the deployment workflow.

- [ ] **Step 4: Commit Task 5**

```bash
git add .github/workflows/ci.yml
git diff --cached --check
git commit -m "ci: require PostgreSQL 17 qualification"
```

### Task 6: Full verification, evidence, and branch publication

**Files:**
- Verify all modified files; no new production behavior is added in this task.

**Interfaces:**
- Consumes all prior task outputs.
- Produces the reviewable remote branch and final evidence.

- [ ] **Step 1: Start a disposable PostgreSQL 17.11 container**

```powershell
docker run --rm -d --name control-p0-pg17 -e POSTGRES_PASSWORD=control-p0-test -p 127.0.0.1:55433:5432 postgres:17.11-bookworm
```

Wait for `pg_isready`; never connect to the production database.

- [ ] **Step 2: Run the requested verification exactly**

```powershell
npm ci
npm run typecheck
npm test
$env:CONTROL_PG17_QUALIFY='1'
$env:PGHOST='127.0.0.1'
$env:PGPORT='55433'
$env:PGUSER='postgres'
$env:PGPASSWORD='control-p0-test'
$env:CONTROL_PG17_RUN_ID='p0_final'
npm test -- tests/postgres17-qualification.test.ts
npm run build
docker build -t schoolsafe-control-p0-review .
git diff --check
```

Record exact test-file/test counts and every exit code.

- [ ] **Step 3: Capture acceptance evidence**

Capture only non-secret results:

- fresh `devices.school_id` catalog row;
- exact Device Hub read-back fields;
- fresh/migrated normalized equality;
- `/ready` 200 with DB and 503 after a controlled disposable-DB connection failure;
- production fail-closed cases;
- PostgreSQL `17.11` server version;
- `git status --short` and `git diff --stat production...HEAD`.

- [ ] **Step 4: Stop the disposable container**

```bash
docker stop control-p0-pg17
```

- [ ] **Step 5: Perform a final requirements audit**

Re-read the specification and verify every acceptance condition against fresh command output. Confirm no production host or deployment workflow was contacted for mutation.

- [ ] **Step 6: Push only the authorized branch**

```bash
git push --set-upstream origin fix/control-v1-p0-runtime-schema
```

Report the resulting SHA. Do not merge and do not run CD.
