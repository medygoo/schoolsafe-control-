# SchoolSafe Control P0 State Machine and HMAC Design

## 1. Purpose and safety boundary

This specification separates SchoolSafe Control's commercial lifecycle from administrative blocking and defines deterministic HMAC authorization for every lifecycle state.

The implementation covered by a later plan will start from `production@5666d15c17faf9c9e364871583e3497f6e55c6c8` on `fix/control-v1-p0-state-hmac`. This specification does not authorize implementation, deployment, production database changes, service restarts, or changes to `CONTROL_DEPLOY_ENABLED`. The deployment switch remains `false`.

The commercial lifecycle is:

```text
trial --J14--> grace --J17--> suspended
  |               |               |
  +---------------+---------------+-- explicit commercial activation --> active
```

Administrative blocking is an independent dimension. It can coexist with any commercial lifecycle value and never pauses or rewinds time.

This lot explicitly excludes setup-token bootstrap grants, HMAC replay nonces, JSON canonicalization, `key_id` rotation, production deployment, VPS helper changes, and general documentation.

## 2. Decision and rejected alternatives

### Selected design: orthogonal lifecycle and administrative block

Keep `instances.status` as the commercial lifecycle field for storage compatibility, but restrict it to `trial | grace | active | suspended`. Add `is_blocked` and `blocked_at` for administrative blocking.

This model preserves the existing lifecycle column and most consumers while allowing states such as `trial + blocked`, `active + blocked`, and `suspended + blocked`. The scheduler can advance lifecycle time without consulting the block flag.

### Rejected: keep `blocked` inside `status`

This loses the underlying commercial lifecycle, prevents correct time progression, and makes `unblock` guess a commercial state. It is the cause of the current implicit activation defect.

### Rejected: save and blindly restore a previous status

A stored previous value becomes stale while trial/grace time continues. Restoring `trial` on day 18 would incorrectly grant additional access. The authoritative lifecycle must be computed and advanced independently, not restored from a snapshot.

### Rejected: infer `active` for legacy blocked rows

Legacy rows do not carry a trustworthy previous lifecycle. Inferring activation would bypass commercial approval. Migration therefore fails closed.

## 3. Data model

### PostgreSQL and SQLite instance fields

The `instances` contract becomes:

```text
status            trial | grace | active | suspended
is_blocked        boolean, NOT NULL, default false
blocked_at        timestamp with time zone / ISO timestamp, nullable
trial_started_at  nullable timestamp
grace_ends_at     nullable timestamp
activated_at      nullable timestamp
```

`status` remains the stored commercial lifecycle name to minimize database and adapter churn. In TypeScript it is represented as `LifecycleStatus`; `blocked` is removed from that union. `Instance` gains `is_blocked: boolean` and `blocked_at: string | null`.

Fresh PostgreSQL and SQLite schemas enforce:

- `status` is one of `trial`, `grace`, `active`, or `suspended`;
- `is_blocked` is non-null and defaults to `false`;
- `blocked_at` is nullable;
- a consistency check requires `blocked_at IS NULL` when `is_blocked=false` and a non-null `blocked_at` when `is_blocked=true`.

The adapters normalize SQLite integers to booleans at the boundary. Dates remain ISO strings in the application contract.

No block reason or free-form administrative metadata is added in this P0 lot. Those fields are not required to resolve the safety defect and would create an unaudited secondary contract.

## 4. Commercial transition contract

### Transition matrix

| Current lifecycle | Event | Next lifecycle | Allowed |
|---|---|---:|---|
| none | create instance | `trial` | yes |
| `trial` | scheduler at/after J14 | `grace` | yes |
| `grace` | scheduler at/after J17 | `suspended` | yes |
| `trial` | explicit commercial activation | `active` | yes |
| `grace` | explicit commercial activation | `active` | yes |
| `suspended` | explicit commercial reactivation | `active` | yes |
| `active` | explicit administrative commercial suspension | `suspended` | yes |
| `active` | timer, unblock, token, HMAC, generic update | any other state | no |
| `suspended` | timer, unblock, token, HMAC, generic update | `trial` or `grace` | no |
| any | administrative block/unblock | unchanged | yes |

J0 is `trial_started_at`. Trial ends at J14. Grace ends at `grace_ends_at`, which is J17. Comparisons use an injected UTC clock so tests and both database adapters share exact boundary behavior.

### Single transition service

HTTP routes and scheduler code must not write lifecycle fields directly. They call one application service, provisionally `InstanceStateService`, which exposes intent-specific operations:

```ts
createTrial(...)
activateCommercially(instanceId, now)
suspendCommercially(instanceId, now)
setAdministrativeBlock(instanceId, blocked, now)
refreshDueLifecycle(instanceId, now)
advanceExpiredTrials(now)
consumeSetupToken(token, now)
regenerateSetupToken(instanceId)
```

The service delegates to atomic repository methods. A generic profile update accepts only non-state fields; its TypeScript input and SQL update list exclude `status`, `is_blocked`, `blocked_at`, lifecycle timestamps, activation timestamp, and setup-token state.

Repository methods enforce their own source states in SQL rather than trusting routes:

- commercial activation updates only rows whose lifecycle is `trial`, `grace`, or `suspended`;
- commercial suspension updates only `active` rows;
- trial expiry updates only due `trial` rows;
- grace expiry updates only due `grace` rows;
- setup-token consumption does not change lifecycle and succeeds only for an unexpired `trial` or `grace` row;
- administrative block/unblock changes only `is_blocked`, `blocked_at`, and `updated_at`;
- blocking an already blocked row preserves its existing `blocked_at`;
- blocking a row that was unblocked creates a new `blocked_at=now`.

An operation that finds an instance but whose source lifecycle is invalid returns a typed transition rejection. It never broadens its `WHERE` clause and never retries by applying a different transition.

The administrative flag does not appear in scheduler predicates. A blocked trial therefore becomes grace at J14 and suspended at J17. Commercial activation may occur while administratively blocked, producing `active + blocked`; HMAC remains denied until a separate unblock operation.

After signature validation and before capability authorization, HMAC handling calls `refreshDueLifecycle(instanceId, now)`. This repository operation conditionally advances that single instance from due trial to grace and from expired grace to suspended, then returns the current row. Authorization therefore never relies on a stale lifecycle merely because the periodic timer is delayed.

## 5. Migration of existing data

The PostgreSQL migration is idempotent and executes in one explicit transaction. Every statement uses fail-fast behavior; no intermediate schema or data state may be committed.

The required order is:

1. `BEGIN`.
2. Add `is_blocked BOOLEAN NOT NULL DEFAULT false` and nullable `blocked_at` if absent.
3. Discover every historical CHECK constraint attached to `instances` that depends on the `status` column, then drop it before changing legacy values. Discovery must use PostgreSQL catalog dependencies, not only a hard-coded constraint name: resolve the `status` attribute number from `pg_attribute`, select `pg_constraint` rows with `contype='c'`, `conrelid='instances'::regclass`, and that attribute number in `conkey`, then quote each discovered `conname` with `format('%I', ...)` before `ALTER TABLE ... DROP CONSTRAINT`.
4. Convert every legacy `status='blocked'` row to:
   - `status='suspended'`;
   - `is_blocked=true`;
   - `blocked_at=COALESCE(updated_at, NOW())`.
5. Add the new lifecycle CHECK allowing only `trial`, `grace`, `active`, and `suspended` as `NOT VALID`, then run `ALTER TABLE instances VALIDATE CONSTRAINT ...`.
6. Add the block consistency CHECK as `NOT VALID` only when an equivalent constraint is absent, then validate it. On rerun, discover the existing constraint through `pg_constraint`, verify its normalized definition, and validate it rather than attempting a duplicate `ADD CONSTRAINT`. It requires `(is_blocked AND blocked_at IS NOT NULL) OR (NOT is_blocked AND blocked_at IS NULL)`.
7. Run explicit validation queries proving there is no remaining `status='blocked'`, no invalid lifecycle, and no inconsistent block timestamp. Verify preservation of the expected rows and relationships used by the migration test.
8. `COMMIT` only after every validation succeeds.

Any catalog lookup, data conversion, constraint creation, constraint validation, or preservation check failure aborts the transaction and performs a complete rollback. The deployer must execute the migration with stop-on-error semantics; it must never continue from a partially applied migration.

Mapping an unknown legacy blocked row to `suspended + blocked` is deliberately fail-closed. It grants neither normal HMAC access nor commercial activation. An administrator must explicitly perform the commercial activation and administrative unblock operations if both are intended.

Existing non-blocked rows retain their lifecycle unchanged and receive `is_blocked=false`, `blocked_at=NULL`.

The historical production fixture remains historical: it continues to model `status='blocked'`. Applying all migrations to it must yield a catalog strictly identical to a fresh schema and must prove the fail-closed row conversion. No catalog allowlist is introduced.

## 6. API contract

### Instance representation

Instance responses expose the two dimensions explicitly:

```json
{
  "lifecycle_status": "trial",
  "status": "trial",
  "is_blocked": true,
  "blocked_at": "2026-09-22T12:00:00.000Z"
}
```

One common serializer module owns this representation. Its state primitive, provisionally `serializeInstanceState(instance)`, sets `lifecycle_status = instance.status` and temporarily also sets `status = instance.status` as a compatibility alias; neither field ever contains `blocked`. It also emits `is_blocked` and `blocked_at`. The normal `serializeInstance(instance)` and any explicitly scoped projection, including setup/bootstrap responses handled in their own later lot, must reuse this primitive. No route may manually construct different lifecycle/block fields. New UI and clients use `lifecycle_status`; the `status` alias is output-only compatibility and does not authorize arbitrary lifecycle writes.

### Administrative endpoints

- `POST /instances/:id/block` sets `is_blocked=true` without changing lifecycle. On the first block after an unblocked state it sets `blocked_at=now`; if the row is already blocked, it preserves the existing `blocked_at`.
- `POST /instances/:id/unblock` sets `is_blocked=false` and `blocked_at=NULL`, idempotently, without changing lifecycle.
- A later block after an unblock creates a new `blocked_at`; it never restores the timestamp from the previous block period.
- Both return the complete two-dimensional instance representation.

Examples:

- block trial at day 10, unblock at day 12: lifecycle remains `trial`;
- block trial at day 10, scheduler runs through day 18, unblock: lifecycle is `suspended`;
- block active, then unblock: lifecycle remains `active`;
- block suspended, then unblock: lifecycle remains `suspended`.

### Commercial endpoints

- `POST /instances/:id/activate` is the only route that enters `active`, and accepts only `trial`, `grace`, or `suspended`.
- `POST /instances/:id/suspend` is retained as the explicit administrative commercial-suspension action and accepts only `active`, producing `suspended`.
- Invalid transitions return the existing public `INVALID_STATE` error without changing data.
- Token validation, token regeneration, HMAC calls, timer execution, profile updates, block, and unblock can never enter `active`.

### Licence-state response

`GET /api/license/state` remains available to an authenticated suspended instance so SchoolSafe can learn why mutation is denied. Its response adds a non-secret `instance_lifecycle_status` field while retaining the existing licence status. This avoids confusing the commercial instance lifecycle with the status of an individual licence.

## 7. HMAC authentication and authorization

### Four separate stages

Every HMAC route follows the same ordered pipeline:

1. Resolve instance identity from `x-schoolsafe-instance`.
2. Validate timestamp shape and HMAC signature against that instance.
3. Authorize the requested capability from commercial lifecycle and administrative block.
4. Resolve and authorize `school_id`.

An unknown instance or invalid signature returns the existing 401 authentication error. A correctly authenticated but disallowed instance returns 403. Administrative blocking is checked after signature validation, preventing block state from being used as an authentication oracle.

The authentication function returns a typed principal and does not make route-specific authorization decisions. A shared authorization function accepts an explicit capability such as `cards:create`, `batches:create`, `devices:register`, or `license:read`.

### HMAC capability matrix

| Instance condition | Card request create | Batch create | Device registration | Licence state read |
|---|---:|---:|---:|---:|
| `trial`, not blocked | allow | allow | allow | allow |
| `grace`, not blocked and not expired | allow | allow | allow | allow |
| `active`, not blocked | allow | allow | allow | allow |
| `suspended`, not blocked | `403 INSTANCE_SUSPENDED` | `403 INSTANCE_SUSPENDED` | `403 INSTANCE_SUSPENDED` | allow |
| any lifecycle, administratively blocked | `403 INSTANCE_BLOCKED` | `403 INSTANCE_BLOCKED` | `403 INSTANCE_BLOCKED` | `403 INSTANCE_BLOCKED` |

`INSTANCE_BLOCKED` takes authorization precedence over `INSTANCE_SUSPENDED` after successful authentication. This makes a blocked suspended instance deterministic without confusing either result with authentication failure.

If a grace row is found after its deadline before the periodic scheduler has run, `refreshDueLifecycle` persists and returns `suspended` before capability authorization. A delayed timer therefore cannot extend the grace window.

### Multi-school resolution

All HMAC routes share one resolver:

- no authorized schools: `403 PERMISSION_DENIED`;
- explicit `school_id` present and contained in the authorized set: accept it, regardless of set size;
- explicit `school_id` absent and exactly one school is authorized: infer that school;
- explicit `school_id` absent and multiple schools are authorized: `403 PERMISSION_DENIED` because selection is ambiguous;
- explicit `school_id` not in the authorized set: `403 PERMISSION_DENIED`.

The resolver removes the incorrect `authorized.length !== 1` logic from individual routes when implementation is authorized. The full contract is defined now even if multi-school route refactoring is split from the first implementation slice.

## 8. Timer behavior

The systemd timer continues to call the existing administrative trial-check endpoint. That endpoint delegates exclusively to `advanceExpiredTrials(now)`.

The operation performs two idempotent, conditional transitions:

1. due `trial` rows become `grace`;
2. due `grace` rows become `suspended`.

It never changes `is_blocked`, `blocked_at`, `active`, setup tokens, licences, or related business data. It evaluates blocked and unblocked rows identically. Repeated execution produces the same final state, and concurrent activation cannot be overwritten because each SQL update requires the expected source lifecycle.

## 9. UI behavior

The UI renders lifecycle and administrative state independently:

- `trial + false`: **Essai**;
- `trial + true`: **Essai — Bloquée**;
- `grace + true`: **Grâce — Bloquée**;
- `active + true`: **Active — Bloquée**;
- `suspended + false`: **Suspendue**;
- `suspended + true`: **Suspendue — Bloquée**.

Lifecycle styling derives from `lifecycle_status`; a separate blocked badge derives from `is_blocked`. The UI never synthesizes a single `blocked` lifecycle.

Controls remain distinct:

- **Bloquer/Débloquer** changes only administrative access;
- **Activer/Réactiver** is the explicit commercial action;
- **Suspendre commercialement**, if retained, is separate and available only for active instances.

After unblock, the UI displays the lifecycle returned by the server. It does not assume `active`, restore a cached value, or calculate a lifecycle locally.

## 10. SQLite and PostgreSQL strategy

`schema.sql` and `schema.sqlite.sql` receive equivalent lifecycle and block fields and constraints supported by each engine. PostgreSQL migration remains the production migration path. SQLite test databases are created fresh; targeted SQLite migration coverage may use a historical fixture where needed.

PostgreSQL repository methods use atomic conditional `UPDATE ... WHERE status=... RETURNING *`. SQLite uses an immediate transaction or equivalent single-statement conditional update and verifies exactly one changed row. Both adapters expose the same typed result: updated instance, not found, or invalid transition.

The strict P0-A catalog comparison remains mandatory. A fresh PostgreSQL database and a historical fixture followed by every migration must match for tables, columns, types, nullability, defaults, primary keys, foreign keys and delete actions, unique constraints, checks, and indexes.

## 11. TDD test plan

Implementation follows RED/GREEN/refactor and runs the same domain contract suite against SQLite and PostgreSQL 17 wherever adapter behavior is involved.

### Transition tests

- creation produces `trial`, unblocked;
- `trial -> grace` at J14;
- `grace -> suspended` at J17;
- explicit `trial -> active`;
- explicit `grace -> active`;
- explicit `suspended -> active`;
- `active` cannot become trial or grace;
- `suspended` cannot become trial or grace;
- token consumption and regeneration never activate;
- generic updates cannot submit lifecycle or block fields;
- low-level activation refuses `active` and every unknown/invalid source state;
- unblock never changes lifecycle.

### Administrative blocking and time tests

- block trial, unblock before J14: lifecycle remains trial;
- block trial, advance time past J17, run scheduler, unblock: lifecycle is suspended;
- block grace, expire it: lifecycle becomes suspended while still blocked;
- block active, unblock: lifecycle remains active;
- block suspended, unblock: lifecycle remains suspended;
- commercial activation while blocked changes only lifecycle; HMAC remains blocked;
- a repeated block preserves the original `blocked_at`;
- unblock clears `blocked_at`, and a subsequent new block creates a later `blocked_at`.

### HMAC matrix tests

For each lifecycle `trial`, `grace`, `active`, and `suspended`, and for both `is_blocked=false` and `is_blocked=true`, test:

- card request creation;
- batch creation;
- device registration;
- licence-state read.

Assert exact HTTP status and error code. Add separate cases proving an invalid signature stays 401, an authenticated suspension is `403 INSTANCE_SUSPENDED`, and an authenticated administrative block is `403 INSTANCE_BLOCKED`.

### School authorization tests

- one authorized school without `school_id` is inferred;
- multiple schools with an explicit authorized `school_id` succeed;
- multiple schools without `school_id` fail;
- explicit unauthorized `school_id` fails;
- no authorized school fails.

### PostgreSQL migration and concurrency tests

- start from the unmodified historical `active | blocked` fixture, insert one active witness and one blocked witness, and prove the complete transaction succeeds after robustly removing the historical status CHECK;
- prove the active witness remains `active + is_blocked=false` and the blocked witness becomes `suspended + is_blocked=true` with its expected `blocked_at`;
- migrate a legacy `blocked` witness to `suspended + is_blocked=true` without data loss;
- migrate non-blocked lifecycle rows unchanged;
- run the migration twice;
- inject a failure before commit and prove schema and data roll back completely;
- prove fresh/migrated catalog equality;
- execute the critical transition, blocking, scheduler, and HMAC matrix on PostgreSQL 17;
- race activation against timer advancement and prove `active` is never overwritten;
- race block/unblock with lifecycle advancement and prove the dimensions remain independent.

## 12. Risks and compatibility

### Legacy `blocked` ambiguity

The previous commercial state is unknowable. Mapping to suspended and blocked is intentionally conservative. Operational review can later activate and unblock explicitly; migration never guesses.

### API compatibility

Consumers that expect `status='blocked'` must move to `is_blocked`. Keeping `status` as a lifecycle alias during a compatibility window reduces breakage, while the new explicit `lifecycle_status` prevents ambiguity. Input schemas reject attempts to set either lifecycle or block fields through generic updates.

### Scheduler races

Route-only validation is insufficient. Conditional repository updates make source state part of each write, so a late timer cannot turn a newly active row into grace or suspended.

### Stale grace authorization

Authorization must use the shared clock/lifecycle rule, not merely the stored string, or a delayed timer could extend access. Tests freeze time around J14 and J17 boundaries.

### HMAC information leakage

Authorization occurs only after signature validation. Unknown identity and invalid signature remain authentication failures; blocked and suspended codes are returned only to an authenticated principal.

### Multi-school ambiguity

Automatic selection is safe only when exactly one school is authorized. Explicit selection is accepted only by membership, never by route-local assumptions or the first row returned.

### Rollout order

Schema/migration, repository contracts, service, HMAC middleware, routes, UI, and tests must land in one reviewed change before deployment. The deployer must continue to require backup and strict fresh/migrated qualification. No partial production rollout is part of this specification.

## 13. Acceptance criteria for the later implementation

- No code path other than explicit commercial activation enters `active`.
- Administrative unblock never changes commercial lifecycle.
- Blocked trials and grace periods continue aging to suspension.
- HMAC authentication and authorization produce deterministic 401/403 semantics.
- Suspended instances can read licence state but cannot mutate cards, batches, or devices.
- Administratively blocked instances cannot use any HMAC route.
- Multi-school selection follows the shared resolver contract.
- SQLite and PostgreSQL 17 pass the same critical state-machine contract.
- Historical blocked rows migrate fail-closed with no data loss.
- Fresh and migrated PostgreSQL catalogs remain strictly identical.
- `CONTROL_DEPLOY_ENABLED` remains `false`; no merge or deployment occurs.
