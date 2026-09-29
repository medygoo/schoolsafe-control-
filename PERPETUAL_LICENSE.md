# Explicit perpetual licenses

Prepared from Control production 449f3f1374bb2d99deed9e8410dda2955df65529.

The administrator API accepts `expires_at: null` only with
`metadata: {perpetual: true}` and `grace_days: 0`. Control signs a top-level
`perpetual: true` marker. Dated licenses remain compatible; existing unmarked
null database records remain unavailable. Admin authentication, HMAC and school
binding remain required. This capability does not grant licenses to any school.

Deploy the matching SchoolSafe verifier and license v2 additive migration
before issuing such a license. Old SchoolSafe versions reject the new format.
The migration does not rewrite prior migrations or loosen tenant RLS.

Validation: TypeScript and build pass; the targeted issuance test was run
against disposable PostgreSQL 17.11. The full SQLite suite was not run:
better-sqlite3 needs a native build toolchain unavailable on this Windows host.

Production provisioning is pending: create a protected Ed25519 signing pair,
configure Control's LICENSE_PRIVATE_KEY and the corresponding SchoolSafe
CONTROL_LICENSE_PUBLIC_KEY, register the existing runtime instance ID and HMAC
secret without rotating them, and bind/issue only the requested school's license.
Back up configurations and the Control database first; use the existing release
mechanism. Do not create a second school or bypass license validation.

An indefinite entitlement remains suspendable/revocable when a new signed state
is synchronized. Offline cached indefinite states have no automatic expiry;
instant revocation while offline is not guaranteed by the current protocol.

No production configuration, secret, database, merge or deployment was changed.
