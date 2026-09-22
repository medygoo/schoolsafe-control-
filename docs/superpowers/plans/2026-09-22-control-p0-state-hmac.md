# SchoolSafe Control P0 State Machine and HMAC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use superpowers:subagent-driven-development only if the user separately authorizes subagents. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate the commercial lifecycle from administrative blocking, enforce every lifecycle transition atomically, and apply deterministic HMAC capability and school authorization across SQLite and PostgreSQL 17.

**Architecture:** Keep `instances.status` as the stored commercial lifecycle and add orthogonal `is_blocked`/`blocked_at` fields. Route every state mutation through an `InstanceStateService` backed by intent-specific atomic repository methods, and route every HMAC request through authentication, lifecycle refresh, capability authorization, then shared school resolution. Central serializers expose one consistent lifecycle/block representation to API and UI consumers.

**Tech Stack:** TypeScript 5.8, Node.js 22, Fastify 5, Zod 3, Vitest 3, better-sqlite3 13, PostgreSQL 17.11, Docker, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-22-control-p0-state-hmac-design.md`

## Global Constraints

- Work only on `fix/control-v1-p0-state-hmac`, whose approved specification commit is `4226a4491f43c05b6db00184226a382944579797` and whose production base is `5666d15c17faf9c9e364871583e3497f6e55c6c8`.
- Keep `CONTROL_DEPLOY_ENABLED=false`.
- Do not merge, deploy, contact or mutate the production database, restart production, or change VPS helpers.
- Preserve explicit commercial suspension `active -> suspended`.
- Only explicit commercial activation may enter `active`.
- Administrative block/unblock never changes commercial lifecycle and never pauses trial/grace time.
- Use only disposable SQLite databases and the isolated PostgreSQL 17.11 qualification service.
- Keep the historical fixture historical (`active | blocked`) and make all migrations idempotent and transactional.
- Preserve strict fresh/migrated catalog equality with no allowlist.
- Do not add setup-token bootstrap grants, HMAC replay nonces, JSON canonicalization, `key_id` rotation, or unrelated dependency upgrades.
- Task 1 intentionally records RED tests. Do not push the branch or open a PR while any planned RED test remains failing.

## File Structure

- Create `src/domain/instance-state.ts`: state service, clock contract, transition-to-HTTP error mapping.
- Create `src/http/instance-serializer.ts`: shared lifecycle/block serializer and full instance serializer.
- Create `src/auth/hmac-capabilities.ts`: pure capability matrix and Fastify HMAC guard composition.
- Create `src/auth/school-access.ts`: shared multi-school resolver.
- Create `src/types/fastify.d.ts`: typed HMAC principal attached to authenticated requests.
- Modify `src/db/types.ts`: lifecycle, block fields, transition results, repository method signatures.
- Modify `src/db/postgres.ts` and `src/db/sqlite.ts`: atomic repository implementations and safe row mapping.
- Modify `src/db/migration.sql`, `src/db/schema.sql`, and `src/db/schema.sqlite.sql`: deployer-owned transactional migration and convergent fresh schemas.
- Modify `src/auth/hmac.ts`: authentication only; no lifecycle/block authorization.
- Modify `src/app.ts`: construct one state service, register the shared HMAC request context, pass dependencies to routes.
- Modify `src/routes/instances.ts`, `card-requests.ts`, `card-batches.ts`, `devices.ts`, and `license.ts`: consume service, guards, resolver, and serializers.
- Create `public/instance-state-ui.js` and modify `public/app.js`, `public/index.html`, and `public/styles.css`: separate lifecycle label from block badge and separate commercial/admin controls.
- Modify `vitest.config.ts`: discover both TypeScript tests and the explicit JavaScript UI test.
- Create `tests/helpers/instance-state-contract.ts`: adapter-neutral state matrix reused by SQLite and PostgreSQL tests.
- Create `tests/instance-state-sqlite.test.ts`, `tests/instance-serializer.test.ts`, `tests/hmac-capabilities.test.ts`, `tests/school-access.test.ts`, `tests/postgres17-state-hmac.test.ts`, and `tests/postgres17-state-concurrency.test.ts`.
- Modify `tests/control-app.test.ts`, `tests/trial-grace.test.ts`, `tests/license-devicehub.test.ts`, `tests/postgres17-qualification.test.ts`, and `tests/fixtures/control-production-schema.sql` only where the plan explicitly says so. The fixture's legacy status constraint remains `active | blocked`.

## Review Focus

- A valid signature from a blocked suspended instance must return `403 INSTANCE_BLOCKED`, not 401 or `INSTANCE_SUSPENDED`; covered in Task 9.
- A grace row whose deadline passed before the timer ran must be refreshed to suspended before mutation authorization; covered in Tasks 6, 9, and 14.
- A stored trial already beyond `grace_ends_at` must become suspended in one refresh and must not use HMAC mutations or setup tokens; covered in Tasks 5, 6, 9, 12, and 13.
- Repeated block must preserve `blocked_at`, while unblock then re-block must create a later timestamp; covered in Tasks 5 and 12.
- Two authorized schools with an explicit authorized `school_id` must succeed, while the same request without a school remains ambiguous and fails; covered in Task 10.
- A timer/activation race must never overwrite `active`, and a block/timer race must never couple the two state dimensions; covered in Task 14.

---

### Task 1: Record the current defects as RED integration tests

**Files:**
- Modify: `tests/control-app.test.ts`
- Modify: `tests/trial-grace.test.ts`
- Modify: `tests/license-devicehub.test.ts`
- Modify: `tests/postgres17-qualification.test.ts`

**Interfaces:**
- Consumes: current HTTP and database behavior only; no future module imports.
- Produces: failing acceptance tests that later tasks make green without weakening assertions.

- [ ] **Step 1: Add the unblock regression test**

Create a trial instance, call `/block`, then `/unblock`, and assert the response remains trial and exposes separate state:

```ts
expect(unblock.statusCode).toBe(200);
expect(unblock.json().data).toMatchObject({
  lifecycle_status: "trial",
  status: "trial",
  is_blocked: false,
  blocked_at: null
});
```

- [ ] **Step 2: Add current HMAC authorization RED cases**

Create a suspended unblocked instance with a valid HMAC and assert card creation returns:

```ts
expect(response.statusCode).toBe(403);
expect(response.json().code).toBe("INSTANCE_SUSPENDED");
```

Create an active blocked instance with a valid HMAC and assert licence-state read returns `403 INSTANCE_BLOCKED`.

- [ ] **Step 3: Add the multi-school RED case**

Bind two schools, send a valid signed device registration with one explicitly authorized `school_id`, and assert HTTP 200. Keep a paired request without `school_id` expecting `403 PERMISSION_DENIED`.

- [ ] **Step 4: Add creation and HMAC-rotation boundary tests**

Inject the fixed clock `2026-09-22T12:00:00.000Z`, call `POST /instances`, and assert:

```ts
expect(created).toMatchObject({
  status: "trial",
  is_blocked: false,
  blocked_at: null,
  trial_started_at: "2026-09-22T12:00:00.000Z",
  grace_ends_at: "2026-10-09T12:00:00.000Z"
});
```

For `POST /instances/:id/revoke-hmac`, snapshot lifecycle, block, setup-token, and creation fields before the request. Require only `hmac_secret` and `updated_at` to change, and require the old HMAC signature to fail immediately while a signature made with the returned replacement secret succeeds.

- [ ] **Step 5: Add the stale-lifecycle RED cases**

Store `status='trial'`, `trial_started_at=J0`, and `grace_ends_at=J17`; inject `now=J18`. With a valid HMAC signature, call one card mutation, one device registration, and one batch mutation. Each must return:

```ts
expect(response.statusCode).toBe(403);
expect(response.json().code).toBe("INSTANCE_SUSPENDED");
```

Using a separate stale-trial witness, prove both setup-token consumption and setup-token regeneration fail without clearing or replacing the stored token.

- [ ] **Step 6: Add the historical migration RED case**

Build a disposable PostgreSQL database from `tests/fixtures/control-production-schema.sql`, insert one active witness and one blocked witness, apply `src/db/migration.sql`, and assert:

```ts
expect(activeRow).toMatchObject({ status: "active", is_blocked: false, blocked_at: null });
expect(blockedRow.status).toBe("suspended");
expect(blockedRow.is_blocked).toBe(true);
expect(blockedRow.blocked_at).toBeTruthy();
```

- [ ] **Step 7: Run RED and record exact reasons**

Run:

```bash
npm test -- tests/control-app.test.ts tests/trial-grace.test.ts tests/license-devicehub.test.ts
CONTROL_PG17_QUALIFY=1 CONTROL_PG17_RUN_ID=p0b_red npm test -- tests/postgres17-qualification.test.ts
```

Expected failures:

- unblock currently returns `active`;
- suspended HMAC mutation currently succeeds;
- blocked authentication is conflated with authorization;
- explicit multi-school selection is rejected by `authorized.length !== 1`;
- creation timestamps are constructed in the route instead of the state service;
- HMAC rotation depends on unrestricted `updateInstance`;
- a stale trial beyond `grace_ends_at` can remain trial for one call and can still reach mutation/setup-token paths;
- migration cannot expose the new block fields or convert legacy blocked safely.

- [ ] **Step 8: Commit only the RED tests**

```bash
git add tests/control-app.test.ts tests/trial-grace.test.ts tests/license-devicehub.test.ts tests/postgres17-qualification.test.ts
git diff --cached --check
git commit -m "test(control): expose state and HMAC defects"
```

Do not push this intentionally red intermediate commit.

### Task 2: Implement the production-equivalent PostgreSQL migration transaction

**Files:**
- Modify: `src/db/migration.sql`
- Modify: `tests/postgres17-qualification.test.ts`

**Interfaces:**
- Consumes: legacy `instances.status` and the historical fixture from Task 1.
- Produces: an idempotent migration body designed to run under the deployer's single outer transaction, adding `is_blocked`/`blocked_at`, converting legacy blocked rows, and validating constraints.

- [ ] **Step 1: Expand the migration test before editing SQL**

Add assertions that the historical status CHECK is discovered by dependency, not its name. Rename it inside a test database before migration:

```sql
ALTER TABLE instances RENAME CONSTRAINT instances_status_check TO legacy_status_rule_unexpected_name;
```

Apply the migration and require success. Add a second migration execution and require no catalog or data change.

- [ ] **Step 2: Add the production-equivalent `psql` runner before implementation**

Execute migration fixtures with the same transaction owner and failure semantics as production:

```ts
const result = spawnSync("psql", [
  "--set", "ON_ERROR_STOP=1",
  "--single-transaction",
  connectionString,
  "--file", migrationPath
], { encoding: "utf8", env: process.env });
```

Never print `connectionString`. Assert exit code zero for success and non-zero for failure. Before invoking `psql`, reject a migration body containing top-level `BEGIN`, `COMMIT`, or `ROLLBACK`; `--single-transaction` is the only transaction owner because it is the current deployer contract.

- [ ] **Step 3: Add rollback and idempotence proof before implementation**

Create a temporary copy containing the full migration followed by `SELECT 1 / 0;`. Run that copy through the exact runner above, then reconnect and assert `is_blocked`/`blocked_at` do not exist and the legacy witness still has `status='blocked'`. Run the unmodified migration once and require all changes, then run it a second time and require identical catalog and witness data. These assertions prove complete commit, complete rollback, idempotence, and absence of premature commits.

- [ ] **Step 4: Run the targeted migration tests RED**

Run:

```bash
CONTROL_PG17_QUALIFY=1 CONTROL_PG17_RUN_ID=p0b_migration_red npm test -- tests/postgres17-qualification.test.ts
```

Expected: failure at missing block columns or the legacy CHECK preventing `blocked -> suspended`.

- [ ] **Step 5: Replace migration ordering with one fail-fast migration body**

Implement this structure in `src/db/migration.sql` without `BEGIN`, `COMMIT`, or `ROLLBACK`; production and qualification both wrap the entire file with `psql --set ON_ERROR_STOP=1 --single-transaction`:

```sql
ALTER TABLE instances ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE instances ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ;

DO $$
DECLARE constraint_name TEXT;
DECLARE status_attnum SMALLINT;
BEGIN
  SELECT attnum INTO STRICT status_attnum
    FROM pg_attribute
   WHERE attrelid = 'instances'::regclass
     AND attname = 'status'
     AND NOT attisdropped;

  FOR constraint_name IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'instances'::regclass
       AND contype = 'c'
       AND status_attnum = ANY (conkey)
  LOOP
    EXECUTE format('ALTER TABLE instances DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

UPDATE instances
   SET status = 'suspended',
       is_blocked = TRUE,
       blocked_at = COALESCE(updated_at, NOW())
 WHERE status = 'blocked';

ALTER TABLE instances
  ADD CONSTRAINT instances_lifecycle_status_check
  CHECK (status IN ('trial', 'grace', 'active', 'suspended')) NOT VALID;
ALTER TABLE instances VALIDATE CONSTRAINT instances_lifecycle_status_check;
```

For `instances_block_consistency_check`, use a catalog-guarded `DO` block: if absent, add it `NOT VALID`; if present, compare `pg_get_constraintdef` to the expected normalized expression and raise an exception on mismatch. Then validate it.

- [ ] **Step 6: Add explicit pre-transaction-completion validation**

Inside a `DO` block, raise exceptions when any query is true:

```sql
EXISTS (SELECT 1 FROM instances WHERE status NOT IN ('trial','grace','active','suspended'))
EXISTS (SELECT 1 FROM instances WHERE is_blocked <> (blocked_at IS NOT NULL))
EXISTS (SELECT 1 FROM instances WHERE status = 'blocked')
```

Do not end with `COMMIT;`. A validation exception makes `psql` exit non-zero and `--single-transaction` rolls back the entire file.

- [ ] **Step 7: Run migration tests GREEN with deployer semantics**

Run:

```bash
CONTROL_PG17_QUALIFY=1 CONTROL_PG17_RUN_ID=p0b_migration_green npm test -- tests/postgres17-qualification.test.ts
```

Expected: historical active/blocked migration, renamed constraint, complete first-run commit, second-run idempotence, injected-error rollback, and the top-level transaction-control scan all pass. Other Task 1 API tests may remain red.

- [ ] **Step 8: Commit migration and its tests**

```bash
git add src/db/migration.sql tests/postgres17-qualification.test.ts
git diff --cached --check
git commit -m "fix(db): migrate administrative blocking transactionally"
```

### Task 3: Align fresh PostgreSQL and SQLite schemas

**Files:**
- Modify: `src/db/schema.sql`
- Modify: `src/db/schema.sqlite.sql`
- Modify: `tests/postgres17-qualification.test.ts`
- Modify: `tests/control-app.test.ts`

**Interfaces:**
- Consumes: migration column names and constraints from Task 2.
- Produces: fresh schemas with the exact same state contract.

- [ ] **Step 1: Add fresh-schema assertions RED**

For PostgreSQL query `information_schema.columns` and `pg_constraint`; for SQLite query `PRAGMA table_info(instances)` and `sqlite_master`. Assert:

```text
status: trial|grace|active|suspended
is_blocked: NOT NULL, default false/0
blocked_at: nullable
block consistency CHECK present
```

- [ ] **Step 2: Run targeted fresh tests RED**

```bash
npm test -- tests/control-app.test.ts
CONTROL_PG17_QUALIFY=1 CONTROL_PG17_RUN_ID=p0b_fresh_red npm test -- tests/postgres17-qualification.test.ts
```

Expected: missing block fields and old lifecycle CHECK containing `blocked`.

- [ ] **Step 3: Update `schema.sql`**

Use:

```sql
status TEXT NOT NULL DEFAULT 'trial'
  CONSTRAINT instances_lifecycle_status_check
  CHECK (status IN ('trial', 'grace', 'active', 'suspended')),
is_blocked BOOLEAN NOT NULL DEFAULT FALSE,
blocked_at TIMESTAMPTZ,
CONSTRAINT instances_block_consistency_check
  CHECK ((is_blocked AND blocked_at IS NOT NULL)
      OR (NOT is_blocked AND blocked_at IS NULL))
```

- [ ] **Step 4: Update `schema.sqlite.sql` equivalently**

Use `is_blocked INTEGER NOT NULL DEFAULT 0 CHECK (is_blocked IN (0,1))`, nullable `blocked_at TEXT`, the four-state lifecycle CHECK, and the same block/timestamp consistency rule expressed with `0/1`.

- [ ] **Step 5: Run fresh tests GREEN**

Run the two commands from Step 2. Expected: fresh schema assertions pass; API RED cases remain until later tasks.

- [ ] **Step 6: Commit fresh schema changes**

```bash
git add src/db/schema.sql src/db/schema.sqlite.sql tests/control-app.test.ts tests/postgres17-qualification.test.ts
git diff --cached --check
git commit -m "fix(db): separate fresh lifecycle and block state"
```

### Task 4: Define lifecycle types and database contracts

**Files:**
- Modify: `src/db/types.ts`
- Modify: `src/db/index.ts`
- Create: `tests/helpers/instance-state-contract.ts`

**Interfaces:**
- Produces: `LifecycleStatus`, `Instance`, `CreateTrialInput`, `CreateTrialRecord`, `TransitionResult`, and intent-specific `ControlDatabase` methods used by Tasks 5–14.
- Consumes: exact database fields from Tasks 2–3.

- [ ] **Step 1: Add compile-time contract fixtures**

Create typed builders in `tests/helpers/instance-state-contract.ts` using:

```ts
export const LIFECYCLES = ["trial", "grace", "active", "suspended"] as const;
export type ExpectedLifecycle = typeof LIFECYCLES[number];
export const fixedNow = new Date("2026-09-22T12:00:00.000Z");
```

Use `satisfies Instance` so missing `is_blocked` or `blocked_at` fails typecheck.

- [ ] **Step 2: Run typecheck RED**

```bash
npm run typecheck
```

Expected: `blocked` remains in `InstanceStatus`, and block fields/repository contracts are absent.

- [ ] **Step 3: Replace state types**

Define:

```ts
export type LifecycleStatus = "trial" | "grace" | "active" | "suspended";

export type Instance = {
  // existing identity/profile fields unchanged
  status: LifecycleStatus;
  is_blocked: boolean;
  blocked_at: string | null;
  // existing lifecycle timestamps unchanged
};

export type TransitionResult =
  | { kind: "updated"; instance: Instance }
  | { kind: "not_found" }
  | { kind: "invalid_state"; current: LifecycleStatus };

export type UpdateInstanceProfileInput = Partial<Pick<Instance,
  "school_name" | "school_slug" | "domain" | "api_base" | "supabase_url"
>>;

export type CreateTrialInput = Pick<Instance,
  "school_name" | "school_slug" | "domain" | "api_base" | "supabase_url"
> & {
  setup_token: string;
  hmac_secret: string;
};

export type CreateTrialRecord = CreateTrialInput & Pick<Instance,
  "status" | "is_blocked" | "blocked_at" | "trial_started_at" |
  "grace_ends_at" | "activated_at" | "created_at" | "updated_at"
>;
```

- [ ] **Step 4: Replace generic state-writing contracts**

The `ControlDatabase` interface exposes:

```ts
insertTrial(record: CreateTrialRecord): Promise<Instance>;
updateInstanceProfile(id: string, patch: UpdateInstanceProfileInput): Promise<Instance | undefined>;
rotateHmacSecret(id: string, secret: string, now: string): Promise<Instance | undefined>;
activateCommercially(id: string, now: string): Promise<TransitionResult>;
suspendCommercially(id: string, now: string): Promise<TransitionResult>;
setAdministrativeBlock(id: string, blocked: boolean, now: string): Promise<TransitionResult>;
refreshDueLifecycle(id: string, now: string): Promise<Instance | undefined>;
advanceExpiredTrials(now: string): Promise<{ toGrace: number; toSuspended: number }>;
consumeSetupToken(token: string, now: string): Promise<Instance | undefined>;
regenerateSetupToken(id: string, token: string, now: string): Promise<Instance | undefined>;
```

Remove public `startTrial`, arbitrary state-bearing `updateInstance`, and unrestricted `activateInstance`/`suspendInstance` signatures.
Replace broad `createInstance` with `insertTrial`; only `InstanceStateService.createTrial` may assemble a `CreateTrialRecord`. `rotateHmacSecret` may update only `hmac_secret` and `updated_at`; immediate single-secret rotation remains the contract, while `key_id` and progressive rotation stay out of scope.

- [ ] **Step 5: Run typecheck and record expected adapter failures**

```bash
npm run typecheck
```

Expected: type definitions themselves compile, while PostgreSQL/SQLite adapters and routes fail on the removed contracts. Task 5 closes those failures.

- [ ] **Step 6: Commit the contract boundary**

```bash
git add src/db/types.ts src/db/index.ts tests/helpers/instance-state-contract.ts
git diff --cached --check
git commit -m "refactor(state): define lifecycle repository contracts"
```

### Task 5: Implement atomic PostgreSQL and SQLite repositories

**Files:**
- Modify: `src/db/postgres.ts`
- Modify: `src/db/sqlite.ts`
- Create: `tests/instance-state-sqlite.test.ts`
- Modify: `tests/postgres17-qualification.test.ts`

**Interfaces:**
- Consumes: Task 4 `ControlDatabase` methods and `TransitionResult`.
- Produces: atomic adapter behavior used by `InstanceStateService`.

- [ ] **Step 1: Add adapter-level RED tests**

For both adapters assert:

- trial insertion stores the exact service-provided lifecycle and timestamps;
- HMAC rotation changes only `hmac_secret` and `updated_at`;
- activation updates only trial/grace/suspended;
- activation from active returns `invalid_state`;
- suspension updates only active;
- unblock changes no lifecycle;
- repeated block preserves its timestamp;
- unblock then re-block uses the new clock value;
- scheduler advances blocked trial/grace rows while preserving block fields.
- one refresh moves a stale trial with `grace_ends_at < now` directly to suspended;
- setup-token consume/regenerate reject stale trial/grace rows whose `grace_ends_at <= now` without mutating the token.

- [ ] **Step 2: Run SQLite and PostgreSQL adapter tests RED**

```bash
npm test -- tests/instance-state-sqlite.test.ts
CONTROL_PG17_QUALIFY=1 CONTROL_PG17_RUN_ID=p0b_repository_red npm test -- tests/postgres17-qualification.test.ts
```

- [ ] **Step 3: Centralize row mapping**

Map PostgreSQL boolean directly and SQLite `0/1` with `Boolean(Number(row.is_blocked))`. Map `blocked_at` to string or null. Remove all casts that permit `blocked` as a lifecycle.

- [ ] **Step 4: Implement PostgreSQL atomic transitions**

Use conditional `UPDATE ... WHERE id=$n AND status IN (...) RETURNING *`. When no row updates, run a read only to distinguish `not_found` from `invalid_state`; never perform a fallback update.

Administrative blocking uses:

```sql
UPDATE instances
   SET is_blocked = $2,
       blocked_at = CASE
         WHEN $2 = FALSE THEN NULL
         WHEN is_blocked = TRUE THEN blocked_at
         ELSE $3::timestamptz
       END,
       updated_at = $3::timestamptz
 WHERE id = $1
 RETURNING *;
```

Activation requires `status IN ('trial','grace','suspended')`; suspension requires `status='active'`. Timer updates require their source state in each `WHERE` clause.

Implement `rotateHmacSecret` as one `UPDATE` whose `SET` list is exactly `hmac_secret=$2, updated_at=$3`; return `undefined` when the ID does not exist.

Implement `refreshDueLifecycle` so the most expired condition wins in one statement/transaction: `trial` or `grace` with `grace_ends_at <= now` becomes `suspended`; only a non-expired `trial` at least 14 days old becomes `grace`. Order the suspended condition before the grace condition so a J18 trial cannot stop at grace.

- [ ] **Step 5: Implement SQLite transitions under immediate transactions**

Use `db.transaction(...).immediate()` around read/conditional update/result mapping. Mirror the same source-state conditions and timestamp semantics. Do not implement a broad `UPDATE status=?` helper callable by routes.

Implement the same one-call catch-up ordering as PostgreSQL: check `grace_ends_at <= now` first, then the J14 trial boundary. Implement HMAC rotation with a dedicated prepared statement that names only `hmac_secret` and `updated_at`.

- [ ] **Step 6: Make setup-token operations lifecycle-neutral**

Consumption clears only `setup_token`/`updated_at` when `status IN ('trial','grace')`, `grace_ends_at IS NOT NULL`, and `grace_ends_at > now`. Regeneration uses the same effective-period predicate, changes only token/updated time, and rejects every other row. A stored stale `trial` cannot consume or regenerate a token. Neither operation writes `status`, block fields, or other lifecycle timestamps.

- [ ] **Step 7: Run adapter tests GREEN and typecheck**

```bash
npm test -- tests/instance-state-sqlite.test.ts
CONTROL_PG17_QUALIFY=1 CONTROL_PG17_RUN_ID=p0b_repository_green npm test -- tests/postgres17-qualification.test.ts
npm run typecheck
```

- [ ] **Step 8: Commit atomic repositories**

```bash
git add src/db/postgres.ts src/db/sqlite.ts tests/instance-state-sqlite.test.ts tests/postgres17-qualification.test.ts
git diff --cached --check
git commit -m "fix(state): enforce atomic lifecycle transitions"
```

### Task 6: Add `InstanceStateService`

**Files:**
- Create: `src/domain/instance-state.ts`
- Create: `tests/instance-state-service.test.ts`
- Modify: `src/app.ts`

**Interfaces:**
- Consumes: Task 5 repository methods.
- Produces: `InstanceStateService` used by routes and HMAC capability guards.

- [ ] **Step 1: Write service RED tests with a fake repository**

Test exact mapping of repository outcomes:

```ts
await expect(service.activateCommercially("missing")).rejects.toMatchObject({ statusCode: 404, code: "NOT_FOUND" });
await expect(service.activateCommercially("active-id")).rejects.toMatchObject({ statusCode: 400, code: "INVALID_STATE" });
```

Assert injected clock strings are passed unchanged and `refreshDueLifecycle` is called by authorization-facing flows.

Add `createTrial` tests with a fixed clock and require `trial_started_at=now`, `grace_ends_at=now+17 days`, `status='trial'`, `is_blocked=false`, `blocked_at=null`, and `activated_at=null`. Add `rotateHmacSecret` tests proving only the secret and `updated_at` change. Add a stale J18 trial test proving one `refreshDueLifecycle` call returns suspended.

- [ ] **Step 2: Run service tests RED**

```bash
npm test -- tests/instance-state-service.test.ts
```

Expected: module absent.

- [ ] **Step 3: Implement the service**

Define:

```ts
export type StateClock = () => Date;

export class InstanceStateService {
  constructor(private readonly db: ControlDatabase, private readonly clock: StateClock = () => new Date()) {}
  createTrial(input: CreateTrialInput): Promise<Instance>;
  rotateHmacSecret(id: string, secret: string): Promise<Instance>;
  activateCommercially(id: string): Promise<Instance>;
  suspendCommercially(id: string): Promise<Instance>;
  setAdministrativeBlock(id: string, blocked: boolean): Promise<Instance>;
  refreshDueLifecycle(id: string): Promise<Instance | undefined>;
  advanceExpiredTrials(): Promise<{ toGrace: number; toSuspended: number }>;
  consumeSetupToken(token: string): Promise<Instance | undefined>;
  regenerateSetupToken(id: string, token: string): Promise<Instance>;
}
```

Convert the clock once per method with `const now = this.clock()` and reuse that single value. `createTrial` calls `db.insertTrial` with `trial_started_at=now.toISOString()`, `grace_ends_at=new Date(now.getTime() + 17 * 24 * 60 * 60 * 1000).toISOString()`, `status='trial'`, `is_blocked=false`, `blocked_at=null`, `activated_at=null`, and matching `created_at`/`updated_at`. `rotateHmacSecret` passes only ID, replacement secret, and the injected time to the dedicated repository method. Map missing rows and `TransitionResult` centrally to `NOT_FOUND` or `INVALID_STATE`.

- [ ] **Step 4: Construct one service in `buildApp`**

Extend `BuildAppOptions` with optional `clock?: StateClock`, instantiate one service, and pass it to every route registration. Do not instantiate per request.

- [ ] **Step 5: Run service tests GREEN and typecheck**

```bash
npm test -- tests/instance-state-service.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit the service**

```bash
git add src/domain/instance-state.ts src/app.ts tests/instance-state-service.test.ts
git diff --cached --check
git commit -m "feat(state): centralize instance transitions"
```

### Task 7: Add the common instance serializer

**Files:**
- Create: `src/http/instance-serializer.ts`
- Create: `tests/instance-serializer.test.ts`

**Interfaces:**
- Produces: `serializeInstanceState(instance)` and `serializeInstance(instance)` consumed by all instance-returning routes and UI.
- Consumes: Task 4 `Instance`.

- [ ] **Step 1: Write serializer tests RED**

Assert exact output:

```ts
expect(serializeInstance(instance)).toMatchObject({
  lifecycle_status: instance.status,
  status: instance.status,
  is_blocked: instance.is_blocked,
  blocked_at: instance.blocked_at
});
expect(JSON.stringify(serializeInstance(instance))).not.toContain('"status":"blocked"');
```

Test all four lifecycle values and both block values.

- [ ] **Step 2: Run serializer tests RED**

```bash
npm test -- tests/instance-serializer.test.ts
```

- [ ] **Step 3: Implement serializer functions and types**

`serializeInstanceState` returns only the four canonical/compatibility state fields. `serializeInstance` spreads the existing public instance fields plus `serializeInstanceState`. Export an `InstanceResponse` type derived from the return value.

- [ ] **Step 4: Run serializer tests GREEN**

```bash
npm test -- tests/instance-serializer.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit serializer**

```bash
git add src/http/instance-serializer.ts tests/instance-serializer.test.ts
git diff --cached --check
git commit -m "feat(api): serialize lifecycle and block state consistently"
```

### Task 8: Route creation, HMAC rotation, lifecycle actions, timer, and tokens through the service

**Files:**
- Modify: `src/routes/instances.ts`
- Modify: `tests/control-app.test.ts`
- Modify: `tests/trial-grace.test.ts`

**Interfaces:**
- Consumes: Tasks 6–7 service and serializer.
- Produces: safe creation, immediate HMAC rotation, administrative/commercial HTTP operations, and setup-token handling; closes the Task 1 route failures.

- [ ] **Step 1: Extend route tests before edits**

Cover fixed-clock trial creation; HMAC rotation field isolation and immediate old-secret invalidation; block/unblock for trial, grace, active, suspended; activation from trial/grace/suspended; activation from active rejected; explicit `active -> suspended`; timer on blocked states; repeated block timestamp preservation; re-block timestamp renewal; and stale-trial setup-token consume/regenerate rejection.

- [ ] **Step 2: Run route tests RED**

```bash
npm test -- tests/control-app.test.ts tests/trial-grace.test.ts
```

- [ ] **Step 3: Replace direct database writes**

Update route registration to receive `InstanceStateService`. Replace `db.updateInstance(...status...)`, `db.activateInstance`, `db.suspendInstance`, and direct expiry calls with service methods. `/block` and `/unblock` call only `setAdministrativeBlock`.

`POST /instances` generates only the setup and HMAC secrets, then calls `service.createTrial({ ...validatedBody, setup_token, hmac_secret })`; the route must not construct `status`, `trial_started_at`, `grace_ends_at`, block fields, or creation/update timestamps. `POST /instances/:id/revoke-hmac` generates one replacement secret and calls `service.rotateHmacSecret(id, replacement)`. The current secret becomes invalid immediately; do not introduce `key_id`, overlapping keys, or progressive rotation.

`POST /instances/:id/token` calls `service.regenerateSetupToken`, and `/instances/validate-setup-token` calls `service.consumeSetupToken`. Remove the post-consumption wall-clock check from the route because the repository predicate must reject an expired effective period before any token mutation.

- [ ] **Step 4: Apply the serializer everywhere instances are returned**

Use `serializeInstance` for create, get, list, token regeneration, block, unblock, activate, and suspend responses. Setup-token response must spread `serializeInstanceState(consumedInstance)` for lifecycle/block fields rather than constructing them manually; retain its existing scoped setup fields without adding a grant mechanism.

- [ ] **Step 5: Keep commercial suspension explicit**

`POST /instances/:id/suspend` remains present, requires admin authentication, and calls `service.suspendCommercially(id)`. It cannot suspend trial, grace, or already-suspended rows.

- [ ] **Step 6: Run route tests GREEN**

```bash
npm test -- tests/control-app.test.ts tests/trial-grace.test.ts
npm run typecheck
```

- [ ] **Step 7: Commit route state safety**

```bash
git add src/routes/instances.ts tests/control-app.test.ts tests/trial-grace.test.ts
git diff --cached --check
git commit -m "fix(api): separate administrative and commercial state routes"
```

### Task 9: Separate HMAC authentication from capability authorization

**Files:**
- Modify: `src/auth/hmac.ts`
- Create: `src/auth/hmac-capabilities.ts`
- Create: `src/types/fastify.d.ts`
- Create: `tests/hmac-capabilities.test.ts`
- Modify: `src/http/errors.ts`
- Modify: `src/app.ts`

**Interfaces:**
- Consumes: `InstanceStateService.refreshDueLifecycle`.
- Produces: `HmacPrincipal`, `HmacCapability`, `authenticateHmac`, `authorizeHmacCapability`, and `makeHmacGuard`.

- [ ] **Step 1: Write the pure capability matrix RED**

Table-drive all lifecycle/block combinations against:

```ts
type HmacCapability = "cards:create" | "batches:create" | "devices:register" | "license:read";
```

Expected: trial/grace/active allow all; unblocked suspended allows only `license:read`; every blocked combination throws `403 INSTANCE_BLOCKED`; suspended mutation throws `403 INSTANCE_SUSPENDED`.

- [ ] **Step 2: Add authentication-order RED tests**

For a blocked instance with an invalid signature expect 401 `AUTH_INVALID`. For the same instance with a valid signature expect 403 `INSTANCE_BLOCKED`. This proves signature validation precedes authorization.

Add a stored stale trial with `grace_ends_at < now` and a valid signature. Card, device, and batch mutation requests must each return `403 INSTANCE_SUSPENDED` after a single guard invocation; the test must reload the instance and prove the stored lifecycle is now suspended.

- [ ] **Step 3: Run HMAC tests RED**

```bash
npm test -- tests/hmac-capabilities.test.ts
```

- [ ] **Step 4: Make `authenticateHmac` authentication-only**

Return:

```ts
export type HmacPrincipal = { instance: Instance };
```

Keep header, instance existence, timestamp, and signature checks. Remove the current `instance.status === "blocked"` authorization branch.

- [ ] **Step 5: Implement capability authorization**

`authorizeHmacCapability` first calls `stateService.refreshDueLifecycle(instance.id)` exactly once, throws `AUTH_INVALID` if the instance disappeared, then checks `is_blocked`, then lifecycle/capability. Because refresh fully catches up a J18 trial in one call, stale trial signatures cannot authorize a mutation. Add `INSTANCE_SUSPENDED` to `ControlAppErrorCode`.

- [ ] **Step 6: Compose a shared guard**

`makeHmacGuard({ db, stateService, capability })` authenticates, authorizes, and stores the refreshed principal in a decorated request property. Add Fastify request typing and one `decorateRequest` call during app setup; do not use untyped `any`.

- [ ] **Step 7: Run HMAC tests GREEN**

```bash
npm test -- tests/hmac-capabilities.test.ts
npm run typecheck
```

- [ ] **Step 8: Commit HMAC separation**

```bash
git add src/auth/hmac.ts src/auth/hmac-capabilities.ts src/types/fastify.d.ts src/http/errors.ts src/app.ts tests/hmac-capabilities.test.ts
git diff --cached --check
git commit -m "fix(auth): authorize HMAC capabilities by state"
```

### Task 10: Centralize multi-school resolution and wire HMAC routes

**Files:**
- Create: `src/auth/school-access.ts`
- Create: `tests/school-access.test.ts`
- Modify: `src/routes/card-requests.ts`
- Modify: `src/routes/card-batches.ts`
- Modify: `src/routes/devices.ts`
- Modify: `src/routes/license.ts`
- Modify: `tests/license-devicehub.test.ts`

**Interfaces:**
- Consumes: Task 9 request principal and capability guard.
- Produces: `resolveAuthorizedSchoolId(authorizedIds, requestedId)` shared by four route families.

- [ ] **Step 1: Write resolver table tests RED**

Assert:

```ts
expect(resolveAuthorizedSchoolId(["a"], undefined)).toBe("a");
expect(resolveAuthorizedSchoolId(["a", "b"], "b")).toBe("b");
for (const [authorized, requested] of [
  [["a", "b"], undefined],
  [["a"], "b"],
  [[], undefined]
] as const) {
  let error: unknown;
  try {
    resolveAuthorizedSchoolId([...authorized], requested);
  } catch (caught) {
    error = caught;
  }
  expect(error).toMatchObject({ code: "PERMISSION_DENIED" });
}
```

- [ ] **Step 2: Run resolver tests RED**

```bash
npm test -- tests/school-access.test.ts
```

- [ ] **Step 3: Implement the pure resolver**

Deduplicate authorized IDs before decisions. Accept an explicit ID only by exact membership. Infer only when the deduplicated set has exactly one member. Return only the selected ID; never return the whole authorization set.

- [ ] **Step 4: Apply capability guards and resolver to routes**

- card requests: `cards:create`;
- card batches: `batches:create`;
- device registrations: `devices:register`;
- licence state: `license:read`.

Each handler obtains `instance.id` from the refreshed HMAC principal, fetches authorized schools once, and calls the resolver. Remove every route-local `authorized.length !== 1` rule.

- [ ] **Step 5: Include lifecycle in licence state**

Return existing licence fields plus `instance_lifecycle_status` from the refreshed principal. Do not expose HMAC secrets, setup tokens, or DSNs.

- [ ] **Step 6: Run route and resolver tests GREEN**

```bash
npm test -- tests/school-access.test.ts tests/license-devicehub.test.ts tests/control-app.test.ts
npm run typecheck
```

Expected: Task 1 suspended, blocked, and multi-school HMAC cases are now green.

- [ ] **Step 7: Commit shared school authorization**

```bash
git add src/auth/school-access.ts src/routes/card-requests.ts src/routes/card-batches.ts src/routes/devices.ts src/routes/license.ts tests/school-access.test.ts tests/license-devicehub.test.ts tests/control-app.test.ts
git diff --cached --check
git commit -m "fix(auth): resolve HMAC school access consistently"
```

### Task 11: Render lifecycle and administrative block separately in the UI

**Files:**
- Create: `public/instance-state-ui.js`
- Modify: `public/app.js`
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Modify: `vitest.config.ts`
- Create: `tests/control-ui-state.test.js`

**Interfaces:**
- Consumes: serializer fields `lifecycle_status`, compatibility `status`, `is_blocked`, `blocked_at`.
- Produces: separate labels and non-interchangeable commercial/admin controls.

- [ ] **Step 1: Make JavaScript UI tests discoverable**

Change the Vitest include list to exactly:

```ts
include: ["tests/**/*.test.ts", "tests/**/*.test.js"]
```

Do not rename or exclude existing TypeScript tests.

- [ ] **Step 2: Add DOM/string-level UI tests RED**

Create `public/instance-state-ui.js` as an ES module exporting `renderInstanceState` and `actionsFor`, then assert:

```ts
expect(renderInstanceState({ lifecycle_status: "trial", is_blocked: true })).toContain("Essai");
expect(renderInstanceState({ lifecycle_status: "trial", is_blocked: true })).toContain("Bloquée");
expect(actionsFor({ lifecycle_status: "active", is_blocked: true })).toEqual(["unblock", "suspend"]);
expect(actionsFor({ lifecycle_status: "suspended", is_blocked: false })).toEqual(["activate", "block"]);
```

- [ ] **Step 3: Run UI tests RED and prove discovery**

```bash
npm test -- tests/control-ui-state.test.js
```

Expected: Vitest reports `tests/control-ui-state.test.js` by name and fails on the missing module/helpers. A zero-test result is a plan failure, not success.

- [ ] **Step 4: Update UI helpers and rendering**

Import the two helpers from `public/instance-state-ui.js` in `public/app.js`, and mark the existing application script as `type="module"` in `public/index.html`. Use `lifecycle_status` as canonical with temporary fallback to `status` only for compatibility. Render one lifecycle badge and an additional block badge. Remove `blocked` from lifecycle labels.

- [ ] **Step 5: Separate controls**

Block/unblock buttons depend only on `is_blocked`. Activate appears for trial/grace/suspended. Suspend appears only for active. After every action, render the server response; never locally assign a lifecycle.

- [ ] **Step 6: Add block styling without changing lifecycle styling**

Create a `.status-blocked` or equivalent secondary badge class. Do not reuse `.status.active`, `.status.trial`, `.status.grace`, or `.status.suspended` to encode the administrative dimension.

- [ ] **Step 7: Run targeted and full discovery GREEN, then build**

```bash
npm test -- tests/control-ui-state.test.js
npm test
npm run build
```

Expected: the targeted run executes the JavaScript file, and the unfiltered run includes the same UI test in its reported test-file count.

- [ ] **Step 8: Commit UI and discovery changes**

```bash
git add public/instance-state-ui.js public/app.js public/index.html public/styles.css vitest.config.ts tests/control-ui-state.test.js
git diff --cached --check
git commit -m "fix(ui): separate lifecycle and blocked state"
```

### Task 12: Complete the SQLite state and HMAC matrix

**Files:**
- Modify: `tests/instance-state-sqlite.test.ts`
- Modify: `tests/hmac-capabilities.test.ts`
- Modify: `tests/control-app.test.ts`
- Modify: `tests/trial-grace.test.ts`
- Modify: `tests/helpers/instance-state-contract.ts`

**Interfaces:**
- Consumes: all implementation through Task 11.
- Produces: complete fast local contract coverage before PostgreSQL expansion.

- [ ] **Step 1: Parameterize the transition matrix**

Run the reusable contract for fixed-clock trial creation (`now`, `now+17 days`, trial, unblocked), J14, direct stale-trial J18-to-suspended catch-up in one refresh, three allowed activations, retained active suspension, forbidden regressions, generic-update exclusion, and unblock neutrality.

Snapshot every field around HMAC rotation and require only `hmac_secret` and `updated_at` to differ. Verify the old signature fails immediately and the new signature succeeds.

- [ ] **Step 2: Parameterize block/time cases**

Use fixed clocks for:

- trial block/unblock before J14;
- blocked trial advanced after J17 then unblocked;
- blocked grace expiry;
- active block/unblock;
- suspended block/unblock;
- repeated block same timestamp;
- unblock/re-block later timestamp.

Add stale setup-token witnesses for both consumption and regeneration. With stored `status='trial'` and `grace_ends_at < now`, both operations must fail and leave the original token unchanged.

- [ ] **Step 3: Parameterize the full HMAC cross-product**

For four lifecycles × two block values × four capabilities, assert exact allow or error result. Include HTTP integration for each route family, not only the pure matrix. Add the stored-trial-at-J18 case for cards, devices, and batches; each validly signed request must perform one refresh and return `403 INSTANCE_SUSPENDED`.

- [ ] **Step 4: Run SQLite/full unit suite**

```bash
npm test -- tests/instance-state-sqlite.test.ts tests/hmac-capabilities.test.ts tests/control-app.test.ts tests/trial-grace.test.ts
npm test
```

Expected: all non-PostgreSQL tests pass; PostgreSQL-gated tests may be reported skipped only in the unqualified local command.

- [ ] **Step 5: Commit complete SQLite coverage**

```bash
git add tests/helpers/instance-state-contract.ts tests/instance-state-sqlite.test.ts tests/hmac-capabilities.test.ts tests/control-app.test.ts tests/trial-grace.test.ts
git diff --cached --check
git commit -m "test(state): cover SQLite lifecycle and HMAC matrix"
```

### Task 13: Run the same critical contract on PostgreSQL 17

**Files:**
- Create: `tests/postgres17-state-hmac.test.ts`
- Modify: `tests/helpers/instance-state-contract.ts`
- Modify: `.github/workflows/ci.yml` only if the new file is not already selected by existing `npm test`.

**Interfaces:**
- Consumes: shared Task 12 contract and PostgreSQL qualification environment.
- Produces: PostgreSQL 17 parity evidence with no skipped CI cases.

- [ ] **Step 1: Instantiate the shared contract with `PostgresDatabase`**

Create a unique disposable database from `CONTROL_PG17_RUN_ID`, initialize it from fresh schema, and run transition, block/time, HMAC capability, and school-resolution critical cases. Include fixed-clock `createTrial`, dedicated HMAC rotation field isolation, one-call J18 trial-to-suspended refresh, and expired setup-token consume/regenerate rejection with the token left unchanged.

- [ ] **Step 2: Add PostgreSQL HTTP integration cases**

Build Fastify with the PostgreSQL adapter and fixed clock. Exercise the four HMAC routes for trial, grace, active, suspended, and administratively blocked principals. For a stored J18 trial with a valid signature, cards, devices, and batches must each return `403 INSTANCE_SUSPENDED` and the first request must persist suspended state.

- [ ] **Step 3: Run PostgreSQL 17 qualification**

```bash
CONTROL_PG17_QUALIFY=1 CONTROL_PG17_RUN_ID=p0b_pg17 npm test -- tests/postgres17-state-hmac.test.ts
```

Expected: every test executes; zero skips and zero failures. Log only PostgreSQL version, disposable database names, and aggregate matrix counts.

- [ ] **Step 4: Confirm CI includes the test automatically**

Run:

```bash
CONTROL_PG17_QUALIFY=1 CONTROL_PG17_RUN_ID=p0b_ci_matrix npm test
```

If Vitest already discovers the file, do not modify CI. If not, add the exact file to the existing test command without changing workflow triggers or deployment workflows.

- [ ] **Step 5: Commit PostgreSQL parity tests**

```bash
git add tests/postgres17-state-hmac.test.ts tests/helpers/instance-state-contract.ts .github/workflows/ci.yml
git diff --cached --check
git commit -m "test(state): qualify lifecycle and HMAC on PostgreSQL 17"
```

Do not stage `.github/workflows/ci.yml` when unchanged.

### Task 14: Prove transition concurrency safety

**Files:**
- Create: `tests/postgres17-state-concurrency.test.ts`
- Modify: `src/db/postgres.ts` only if a race test reveals a non-atomic query.
- Modify: `src/db/sqlite.ts` only if the equivalent immediate transaction is not atomic.

**Interfaces:**
- Consumes: atomic methods from Task 5.
- Produces: proof that concurrent operations cannot create forbidden lifecycle/block combinations.

- [ ] **Step 1: Add activation-versus-timer race RED test**

Create a due grace instance. Launch `activateCommercially` and `advanceExpiredTrials` concurrently with `Promise.allSettled`. Reload the row and require:

```ts
expect(final.status).toBe("active");
```

The only accepted terminal result is active because a timer update must require `status='grace'` and cannot overwrite a completed activation.

- [ ] **Step 2: Add block-versus-timer race**

Race blocking a due trial/grace instance against lifecycle advancement. Require the lifecycle dictated by time and `is_blocked=true` with a non-null block timestamp. Neither operation may erase the other's dimension.

- [ ] **Step 3: Add simultaneous block/re-block test**

Race two block calls with different injected timestamps. Require one valid non-null timestamp, then repeat block after the row is already blocked and prove its chosen timestamp stays stable. Unblock and re-block later must use the later timestamp.

- [ ] **Step 4: Run concurrency tests repeatedly**

```bash
for i in $(seq 1 20); do
  CONTROL_PG17_QUALIFY=1 CONTROL_PG17_RUN_ID="p0b_race_${i}" \
    npm test -- tests/postgres17-state-concurrency.test.ts || exit 1
done
```

Require all twenty isolated runs to exit zero.

- [ ] **Step 5: Fix only demonstrated atomicity defects and rerun GREEN**

Use conditional single-statement updates or transactions; do not add process-local mutexes because CI and production may have multiple processes.

- [ ] **Step 6: Commit concurrency proof**

```bash
git add tests/postgres17-state-concurrency.test.ts src/db/postgres.ts src/db/sqlite.ts
git diff --cached --check
git commit -m "test(state): prove concurrent transition safety"
```

Do not stage adapters unless a correction was made.

### Task 15: Re-prove strict fresh/migrated equivalence

**Files:**
- Modify: `tests/postgres17-qualification.test.ts`
- Modify: `tests/helpers/postgres-catalog.ts` only if it does not already compare the new checks faithfully.
- Modify: `tests/fixtures/control-production-schema.sql` only to preserve an explicitly named historical CHECK variant needed by the migration test; do not modernize the fixture.

**Interfaces:**
- Consumes: fresh schemas from Task 3 and migration from Task 2.
- Produces: zero-difference catalog and data-preservation evidence.

- [ ] **Step 1: Extend catalog assertions for block fields/checks**

Require matching type, nullability, default, lifecycle CHECK, and block consistency CHECK. Do not normalize away constraint predicates, names used by application logic, or missing objects.

- [ ] **Step 2: Add data preservation witnesses**

Before migration insert active and blocked instances plus one row in each of the seven related Control tables. After migration assert counts and identifiers are unchanged, active is unchanged, and blocked is fail-closed.

- [ ] **Step 3: Run strict qualification with the production-equivalent transaction owner**

```bash
CONTROL_PG17_QUALIFY=1 CONTROL_PG17_RUN_ID=p0b_equivalence npm test -- tests/postgres17-qualification.test.ts
```

The qualification test must invoke the Task 2 `psql --set ON_ERROR_STOP=1 --single-transaction` runner, not `client.query(migrationText)`. Expected logs include PostgreSQL 17.11, seven preserved table counts, legacy conversion result, and `catalog_equivalence_tables=7`; zero differences are allowed.

- [ ] **Step 4: Run the migration twice and compare again**

Apply both runs through the same `psql` runner. After the second application, re-read normalized catalog and all witness rows. Require byte-equivalent normalized results and unchanged counts.

- [ ] **Step 5: Commit equivalence evidence**

```bash
git add tests/postgres17-qualification.test.ts tests/helpers/postgres-catalog.ts tests/fixtures/control-production-schema.sql
git diff --cached --check
git commit -m "test(db): prove state migration equivalence"
```

Stage only files actually changed.

### Task 16: Complete CI-equivalent validation and prepare review

**Files:**
- Verify all changed files; make no feature expansion in this task.

**Interfaces:**
- Consumes: every prior task.
- Produces: a clean reviewable branch and non-secret acceptance evidence.

- [ ] **Step 1: Verify safety controls before final execution**

```bash
git branch --show-current
git merge-base origin/production HEAD
gh variable get CONTROL_DEPLOY_ENABLED --repo medygoo/schoolsafe-control-
```

Require branch `fix/control-v1-p0-state-hmac`, expected approved ancestry, and exact output `false`.

- [ ] **Step 2: Install from lockfile in a clean qualification copy**

```bash
npm ci
```

Record dependency audit warnings without applying upgrades in this lot.

- [ ] **Step 3: Run compiler and full SQLite suite**

```bash
npm run typecheck
npm test
```

Record exact test-file/test counts and verify only PostgreSQL-gated tests are skipped in the non-PG invocation.
Require the output to name `tests/control-ui-state.test.js`; if it is absent, fail validation even when the command exits zero.

- [ ] **Step 4: Run the full mandatory PostgreSQL 17 suite**

Against the existing isolated `postgres:17.11` service bound only to loopback:

```bash
CONTROL_PG17_QUALIFY=1 CONTROL_PG17_RUN_ID=p0b_final npm test
```

Require zero skipped PostgreSQL tests and zero failures. Require explicit evidence for fixed-clock trial creation, isolated HMAC rotation, J18 one-call suspension, stale setup-token rejection, and migration success/rollback/idempotence under `psql --single-transaction`.

- [ ] **Step 5: Build application and container**

```bash
npm run build
docker build -t schoolsafe-control-p0b-review .
```

Do not run the built container against production services.

- [ ] **Step 6: Validate workflow and diff hygiene**

```powershell
& 'C:\Users\PC\Documents\Codex\2026-09-20\o\outputs\INFRA2-20260921\tools\actionlint\actionlint.exe' .github/workflows/ci.yml
git diff --check
git status --short
```

Require no actionlint errors, no whitespace errors, and a clean worktree after the final evidence commit.

- [ ] **Step 7: Audit forbidden state writes and route-local authorization**

Run:

```bash
rg -n "status\s*=|status:" src/routes src/auth
rg -n "authorized\.length\s*!==\s*1" src
rg -n "INSTANCE_BLOCKED|INSTANCE_SUSPENDED" src tests
rg -n "trial_started_at|grace_ends_at|is_blocked|blocked_at" src/routes/instances.ts
rg -n "updateInstance\(|createInstance\(" src/routes src/domain
```

Every lifecycle mutation and trial creation must resolve to `InstanceStateService`; the route scan may contain response serialization but no construction of lifecycle timestamps/block values. No route/domain use of broad `updateInstance` or `createInstance` may remain, and no route-local `authorized.length !== 1` may remain. Expected error-code references must be present in shared authorization and tests.

- [ ] **Step 8: Confirm final verification made no changes**

Run `git status --short` again. If it is not empty, stop Task 16 and return each changed file to the task that owns it; validate and commit it there with that task's exact file list. Task 16 must not create an evidence-only or empty commit.

- [ ] **Step 9: Produce the review report and stop**

Report:

- changed files and concise diff;
- migration order and rollback proof;
- confirmation that production and qualification both use the single `psql --single-transaction` owner;
- SQLite and PostgreSQL 17 test counts;
- explicit discovery/execution of `tests/control-ui-state.test.js`;
- lifecycle/block and HMAC matrix results;
- concurrency results;
- fresh/migrated equality;
- final SHA;
- `CONTROL_DEPLOY_ENABLED=false`;
- proof that no merge or deployment occurred.

Do not push, open a PR, merge, or deploy until the user explicitly authorizes the next action.
