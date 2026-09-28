-- SchoolSafe Control V1 Migration (PostgreSQL)
-- Idempotent migration for existing production tables.
-- Run this script to upgrade an existing database to the new schema.

-- 1. Add new columns if they don't exist
ALTER TABLE instances ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ;
ALTER TABLE instances ADD COLUMN IF NOT EXISTS grace_ends_at TIMESTAMPTZ;
ALTER TABLE instances ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;

-- 2. Make setup_token nullable if it isn't already
ALTER TABLE instances ALTER COLUMN setup_token DROP NOT NULL;

-- 3. Update status constraint to include new states
-- Drop existing constraint if it exists and recreate with new values
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'instances_status_check') THEN
        ALTER TABLE instances DROP CONSTRAINT instances_status_check;
    END IF;
END $$;

ALTER TABLE instances ADD CONSTRAINT instances_status_check CHECK (status IN ('trial', 'grace', 'active', 'suspended', 'blocked'));

-- 4. Set default status to 'trial' for new instances
ALTER TABLE instances ALTER COLUMN status SET DEFAULT 'trial';

-- 5. Ensure indexes exist
CREATE INDEX IF NOT EXISTS idx_instances_slug ON instances(school_slug);
CREATE INDEX IF NOT EXISTS idx_instances_setup_token ON instances(setup_token);
CREATE INDEX IF NOT EXISTS idx_instances_status ON instances(status);

-- School administrator authorizations; revoked records remain immutable history.
CREATE TABLE IF NOT EXISTS school_admin_access (
 id UUID PRIMARY KEY,
 display_name TEXT NOT NULL,
 email_normalized TEXT,
 phone_normalized TEXT,
 password_hash TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','revoked')),
 school_id UUID,
 onboarding_state TEXT NOT NULL DEFAULT 'pending' CHECK (onboarding_state IN ('pending','completed')),
 created_at TIMESTAMPTZ NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL,
 password_changed_at TIMESTAMPTZ NOT NULL,
 suspended_at TIMESTAMPTZ,
 revoked_at TIMESTAMPTZ,
 school_bound_at TIMESTAMPTZ,
 CHECK (email_normalized IS NOT NULL OR phone_normalized IS NOT NULL),
 CHECK ((school_id IS NULL AND onboarding_state='pending' AND school_bound_at IS NULL) OR
        (school_id IS NOT NULL AND onboarding_state='completed' AND school_bound_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS school_admin_access_email_unique ON school_admin_access(email_normalized) WHERE email_normalized IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS school_admin_access_phone_unique ON school_admin_access(phone_normalized) WHERE phone_normalized IS NOT NULL;
CREATE TABLE IF NOT EXISTS school_admin_access_events (
 id UUID PRIMARY KEY,
 access_id UUID NOT NULL REFERENCES school_admin_access(id),
 event_type TEXT NOT NULL CHECK(event_type IN ('created','password_reset','suspended','reactivated','revoked','school_bound')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS school_admin_access_events_access ON school_admin_access_events(access_id);
