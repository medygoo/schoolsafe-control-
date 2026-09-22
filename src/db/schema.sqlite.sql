CREATE TABLE IF NOT EXISTS instances (
id TEXT PRIMARY KEY,
school_name TEXT NOT NULL,
school_slug TEXT NOT NULL UNIQUE,
domain TEXT NOT NULL,
api_base TEXT NOT NULL,
supabase_url TEXT NOT NULL,
status TEXT NOT NULL DEFAULT 'trial' CHECK (status IN ('trial', 'grace', 'active', 'suspended')),
setup_token TEXT UNIQUE,
hmac_secret TEXT NOT NULL,
is_blocked BOOLEAN NOT NULL DEFAULT 0,
blocked_at TEXT,
trial_started_at TEXT,
grace_ends_at TEXT,
activated_at TEXT,
created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_instances_setup_token ON instances(setup_token);
CREATE INDEX IF NOT EXISTS idx_instances_status ON instances(status);
CREATE TABLE IF NOT EXISTS card_print_requests (
id TEXT PRIMARY KEY,
instance_id TEXT NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
school_id TEXT NOT NULL,
student_id TEXT NOT NULL,
student_name TEXT NOT NULL,
class_name TEXT NOT NULL,
academic_year TEXT NOT NULL,
front_key TEXT NOT NULL,
back_key TEXT NOT NULL,
front_signed_url TEXT NOT NULL,
back_signed_url TEXT NOT NULL,
signed_url_expires_at TEXT NOT NULL,
format TEXT NOT NULL CHECK (format IN ('badge', 'carte')),
status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'printed', 'failed')),
metadata TEXT NOT NULL DEFAULT '{}',
created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
printed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_cpr_instance_id ON card_print_requests(instance_id);
CREATE INDEX IF NOT EXISTS idx_cpr_status ON card_print_requests(status);
CREATE INDEX IF NOT EXISTS idx_cpr_created_at ON card_print_requests(created_at DESC);
CREATE TABLE IF NOT EXISTS admin_sessions (
id TEXT PRIMARY KEY,
token_hash TEXT NOT NULL UNIQUE,
label TEXT NOT NULL DEFAULT 'admin',
created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_token ON admin_sessions(token_hash);
CREATE TABLE IF NOT EXISTS card_print_batches (
id TEXT PRIMARY KEY,
instance_id TEXT NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
school_id TEXT NOT NULL,
batch_id TEXT NOT NULL,
version INTEGER NOT NULL,
card_count INTEGER NOT NULL,
r2_key TEXT NOT NULL,
zip_signed_url TEXT NOT NULL,
signed_url_expires_at TEXT NOT NULL,
zip_sha256 TEXT NOT NULL,
status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'downloaded', 'printed', 'failed')),
metadata TEXT NOT NULL DEFAULT '{}',
created_at TEXT NOT NULL,
updated_at TEXT NOT NULL,
UNIQUE (instance_id, batch_id, version)
);
CREATE INDEX IF NOT EXISTS idx_cpb_instance_id ON card_print_batches(instance_id);
CREATE INDEX IF NOT EXISTS idx_cpb_status ON card_print_batches(status);
CREATE TABLE IF NOT EXISTS devices (
id TEXT PRIMARY KEY,
instance_id TEXT NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
school_id TEXT NOT NULL,
device_code TEXT NOT NULL,
vendor TEXT NOT NULL,
model TEXT NOT NULL,
serial_number TEXT NOT NULL,
location TEXT,
status TEXT NOT NULL DEFAULT 'registered' CHECK (status IN ('registered', 'testing', 'online', 'offline', 'disabled', 'revoked')),
last_seen_at TEXT,
created_at TEXT NOT NULL,
updated_at TEXT NOT NULL,
UNIQUE (instance_id, device_code),
UNIQUE (serial_number)
);
CREATE INDEX IF NOT EXISTS idx_devices_instance_id ON devices(instance_id);
CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status);
CREATE TABLE IF NOT EXISTS instance_school_registry (instance_id TEXT NOT NULL, school_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(instance_id,school_id));
CREATE TABLE IF NOT EXISTS licenses (instance_id TEXT NOT NULL, school_id TEXT NOT NULL, license_id TEXT NOT NULL, status TEXT NOT NULL, issued_at TEXT NOT NULL, expires_at TEXT, grace_days INTEGER NOT NULL DEFAULT 0, metadata TEXT NOT NULL DEFAULT '{}', PRIMARY KEY(instance_id,school_id));