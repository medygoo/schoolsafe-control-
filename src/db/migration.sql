-- Migration P0-B LOT 0: Foundation DB & State/HMAC
-- Target: PostgreSQL 17+
-- Requirements:
-- 1. Remove 'blocked' from status CHECK constraint (dynamic discovery)
-- 2. Add is_blocked (BOOLEAN) and blocked_at (TIMESTAMPTZ) columns
-- 3. Migrate legacy status='blocked' to status='suspended', is_blocked=true, blocked_at=COALESCE(updated_at, NOW())
-- 4. Idempotent execution
-- Note: This script is designed to be run inside a psql --single-transaction block.
-- Do not add BEGIN/COMMIT here.

-- Step 1: Discover and drop the old CHECK constraint on instances.status
-- We look for any check constraint on the 'instances' table that references the 'status' column.
DO $$
DECLARE
constraint_name TEXT;
BEGIN
SELECT conname INTO constraint_name
FROM pg_constraint
WHERE conrelid = 'instances'::regclass
AND contype = 'c'
AND pg_get_constraintdef(oid) LIKE '%status%';
IF constraint_name IS NOT NULL THEN
EXECUTE format('ALTER TABLE instances DROP CONSTRAINT %I', constraint_name);
END IF;
END $$;

-- Step 2: Add new columns if they don't exist
ALTER TABLE instances ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE instances ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ;

-- Step 3: Migrate legacy 'blocked' status
UPDATE instances
SET status = 'suspended',
is_blocked = true,
blocked_at = COALESCE(blocked_at, updated_at, NOW())
WHERE status = 'blocked';

-- Step 4: Add new CHECK constraint with only valid lifecycles
ALTER TABLE instances ADD CONSTRAINT instances_status_check
CHECK (status IN ('trial', 'grace', 'active', 'suspended'));