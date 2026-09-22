# SchoolSafe Control P0 Runtime and Schema Design

## Objective

Make the Control V1 candidate safe to qualify without touching production: a PostgreSQL 17 database created from scratch must support Device Hub, a migrated historical database must be structurally equivalent to a fresh database, production must fail closed without PostgreSQL, readiness must reflect the database, invalid API input must return HTTP 400, and the mandatory CI path must exercise PostgreSQL 17.

## Scope and safety boundaries

- Work only on `fix/control-v1-p0-runtime-schema`, based on `production` at `5a69b87b49404c4d96397c4f8fda9a918cceda02`.
- Do not deploy, merge, change production data, restore a database, or restart production services.
- Do not change `CONTROL_DEPLOY_ENABLED`; its current malformed repository value remains effectively closed and is outside this lot.
- Use an isolated PostgreSQL 17 test environment with disposable databases only.
- Keep all existing production tables, columns, constraints, and data-preserving behavior.

## Schema convergence

`src/db/schema.sql` remains the canonical fresh PostgreSQL schema. The `devices` table gains the required `school_id TEXT NOT NULL` column already consumed by the TypeScript adapter and already present in SQLite and migrated production.

Fresh and migrated schemas will converge instead of hiding differences behind a broad normalizer:

- Fresh UUID defaults use `gen_random_uuid()`, matching the historical production fixture and migrated production.
- `idx_instances_setup_token` uses the same non-partial definition as migrated production.
- `migration.sql` ensures `idx_instances_slug` exists, so fixture plus migrations contains the same explicit indexes as fresh.
- Normalization ignores only representation noise such as PostgreSQL-generated formatting, object order, and schema qualification. It does not ignore a missing column, constraint, key, index predicate, referential action, nullability, type, or default.
- Any remaining intentional difference must be represented by a narrowly named allowlist entry and asserted in the test. The expected result for this lot is no table-contract difference.

The schema equivalence test builds two disposable databases: fresh from `schema.sql`, and migrated from `tests/fixtures/control-production-schema.sql` followed by every migration in the repository. It compares tables, columns, types, nullability, defaults, primary keys, foreign keys, delete actions, unique constraints, checks, and indexes.

## Database runtime selection

`createDatabase()` uses explicit configuration:

- In `NODE_ENV=production`, only a syntactically valid `postgres://` or `postgresql://` URL is accepted.
- Missing, blank, malformed, SQLite, relative-path, and other-scheme values throw a configuration error before a database adapter is constructed.
- In development and test, PostgreSQL remains accepted. SQLite is accepted only through an explicit SQLite value supplied to `createDatabase`; there is no implicit production fallback.
- Existing direct construction of `SqliteDatabase(":memory:")` in unit tests remains supported.
- Errors must not include credentials or the full DSN.

## Readiness contract

`ControlDatabase` gains `ping(): Promise<void>`.

- PostgreSQL implements it with `SELECT 1` through the existing pool.
- SQLite implements it with an equivalent `SELECT 1` against the open connection.
- `GET /health` remains process liveness and returns HTTP 200 without querying dependencies.
- `GET /ready` awaits `db.ping()`. Success returns HTTP 200 with a small readiness body. Failure returns HTTP 503 with a generic non-secret body and does not expose a DSN, credentials, SQL, or stack trace.

## Validation errors

The global Fastify error handler recognizes `ZodError` and maps it to HTTP 400 with code `VALIDATION_INVALID`. Existing `ControlAppError` behavior remains unchanged and unknown failures remain generic HTTP 500.

Regression cases cover invalid instance creation, card requests, card batches, device registration, and device status. Existing `safeParse()` route behavior remains valid.

## PostgreSQL 17 qualification

The existing PostgreSQL qualification suite becomes mandatory in `.github/workflows/ci.yml` using a PostgreSQL 17 service container. CI supplies only ephemeral test credentials and sets the existing qualification gate explicitly.

Mandatory coverage includes:

- schema creation from zero;
- Device Hub creation and read-back with exact identity fields;
- historical fixture plus migrations;
- full fresh/migrated catalog equivalence;
- trial/grace transitions;
- setup-token concurrent consumption.

Local execution may still omit PostgreSQL tests when the explicit qualification flag is absent, but the protected production CI job always enables them.

## TDD and verification

Each behavior follows red-green-refactor. Tests must first fail against the unmodified candidate for the expected reason, then pass after the smallest implementation change.

Final verification is:

1. `npm ci`
2. `npm run typecheck`
3. `npm test`
4. mandatory PostgreSQL 17 qualification
5. `npm run build`
6. `docker build`
7. `git diff --check`

The final commit and push target only `fix/control-v1-p0-runtime-schema`. No pull request merge or deployment is part of this lot.

## Acceptance evidence

The report includes changed files, a concise diff, exact test counts, fresh and migrated PostgreSQL results, catalog evidence for `devices.school_id`, `/ready` HTTP 200 and 503 evidence, fail-closed production cases, commit SHA, and confirmation that production and the deployment switch were not changed.
