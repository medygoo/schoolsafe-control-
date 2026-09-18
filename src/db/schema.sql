CREATE TABLE IF NOT EXISTS instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_name TEXT NOT NULL,
  school_slug TEXT NOT NULL UNIQUE,
  domain TEXT NOT NULL,
  api_base TEXT NOT NULL,
  supabase_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  setup_token TEXT NOT NULL UNIQUE,
  hmac_secret TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_instances_setup_token ON instances(setup_token);
CREATE INDEX IF NOT EXISTS idx_instances_status ON instances(status);

CREATE TABLE IF NOT EXISTS card_print_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id UUID NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  school_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  student_name TEXT NOT NULL,
  class_name TEXT NOT NULL,
  academic_year TEXT NOT NULL,
  front_key TEXT NOT NULL,
  back_key TEXT NOT NULL,
  front_signed_url TEXT NOT NULL,
  back_signed_url TEXT NOT NULL,
  signed_url_expires_at TIMESTAMPTZ NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('badge', 'carte')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'printed', 'failed')),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  printed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cpr_instance_id ON card_print_requests(instance_id);
CREATE INDEX IF NOT EXISTS idx_cpr_status ON card_print_requests(status);
CREATE INDEX IF NOT EXISTS idx_cpr_created_at ON card_print_requests(created_at DESC);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT 'admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_token ON admin_sessions(token_hash);

CREATE TABLE IF NOT EXISTS card_print_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id UUID NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  school_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  card_count INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  zip_signed_url TEXT NOT NULL,
  signed_url_expires_at TIMESTAMPTZ NOT NULL,
  zip_sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'downloaded', 'printed', 'failed')),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (instance_id, batch_id, version)
);

CREATE INDEX IF NOT EXISTS idx_cpb_instance_id ON card_print_batches(instance_id);
CREATE INDEX IF NOT EXISTS idx_cpb_status ON card_print_batches(status);

-- Device Hub : registre maître du matériel (Control est maître de
-- l'exploitation technique ; SchoolSafe reste maître des identités).
CREATE TABLE IF NOT EXISTS devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id UUID NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  school_id TEXT NOT NULL,
  device_code TEXT NOT NULL,
  vendor TEXT NOT NULL,
  model TEXT NOT NULL,
  serial_number TEXT NOT NULL,
  location TEXT,
  status TEXT NOT NULL DEFAULT 'registered' CHECK (status IN ('registered', 'testing', 'online', 'offline', 'disabled', 'revoked')),
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (instance_id, device_code),
  UNIQUE (serial_number)
);

CREATE INDEX IF NOT EXISTS idx_devices_instance_id ON devices(instance_id);
CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status);
