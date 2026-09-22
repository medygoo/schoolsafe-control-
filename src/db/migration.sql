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
