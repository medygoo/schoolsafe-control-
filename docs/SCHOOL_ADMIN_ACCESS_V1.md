# School administrator access V1

Control owns these authorizations. This change does not integrate or deploy SchoolSafe.

## Administrative API

All administrative requests use the existing x-admin-token mechanism.

- GET /school-admin-access returns public records without password hashes.
- POST /school-admin-access accepts display_name, email and/or phone, and password; returns 201.
- POST /school-admin-access/:id/reset-password accepts password.
- POST /school-admin-access/:id/suspend permits active -> suspended.
- POST /school-admin-access/:id/reactivate permits suspended -> active only.
- POST /school-admin-access/:id/revoke permanently revokes the authorization.

Email is trimmed and lowercased. RDC telephone forms 0891234567, 243891234567
and +243891234567 normalize to +243891234567. Unique identity indexes also
retain revoked identities; no existing authorization is deleted or recycled.

Passwords use native asynchronous scrypt (N=16384, r=8, p=1, maxmem=64 MiB),
a random 16-byte salt and 64-byte output. Format:
scrypt$<salt-base64url>$<hash-base64url>. Passwords and hashes never appear in
public records or audit events. Password policy: 8–512 characters, common
password denylist, no repeated single-character password.

## Bootstrap API

Configure SCHOOLSAFE_BOOTSTRAP_SECRET separately in the runtime environment.
Control remains healthy without it; internal endpoints fail closed with 503.
Internal calls require x-schoolsafe-bootstrap-secret. Comparison uses
timingSafeEqual on fixed-size SHA-256 digests; the secret is never returned.
This credential is for a trusted SchoolSafe server, never for browser code.

POST /internal/school-admin-access/verify accepts login and password.
A successful response contains only access_id, status, onboarding_required,
and school_id. Wrong credentials return 401 AUTH_INVALID for both absent and
existing accounts. Status is disclosed only after a successful password
verification: 403 ACCESS_SUSPENDED or ACCESS_REVOKED.

POST /internal/school-admin-access/:id/bind-school accepts school_id (UUID).
Binding requires an active authorization. Same access/school is idempotent;
a different school returns 409 SCHOOL_BIND_CONFLICT. The school binding is
recorded as completed with its timestamp, without creating the school itself.

## Persistence and audit

Both adapters implement the same lifecycle. Creation, password reset, status
changes and binding commit the state and event together. SQLite uses a
synchronous transaction; PostgreSQL uses transactions and row locks.
Audit insertion failures roll back the entire operation. Existing tables and
data are preserved. PostgreSQL migration.sql adds the same authorization
schema as a fresh installation; SQLite initializes it additively.

The new browser tab keeps existing tabs. It supports creation, generated
passwords (crypto.getRandomValues), copying, reset and confirmed state
changes. Revoked accesses expose no action. Password form fields clear on
successful submission, cancellation, tab changes and logout.

## Qualification

The tests were first executed before implementation: 22 expected failures
(routes returned 404, UI controls were absent). Tests cover SQLite, HTTP
lifecycle, native password derivation, bootstrap protection, audit rollback,
concurrent creation/binding/state transitions, redaction and UI handlers.

Run npm run typecheck, npm test and npm run build.
With CONTROL_PG17_QUALIFY=1 the same authorization suite ALSO executes
against real PostgreSQL 17.11, using disposable databases alongside the
existing fresh-install/migration/catalog-equivalence qualification.

CI is the existing ci.yml workflow, manually dispatched on the feature
branch; its service remains postgres:17.11-bookworm. No workflow or deployment
configuration is changed.

Local Windows installation note: npm ci invokes node-gyp even though
better-sqlite3 13 ships a compatible Windows prebuild. Without Visual Studio,
the local install uses npm_config_ignore_scripts=true for npm ci only;
the shipped SQLite native binary is verified and ALL local tests execute.
CI retains its unmodified npm ci command and installation scripts.
