CREATE TABLE instances (
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

CREATE INDEX idx_instances_setup_token ON instances(setup_token);
CREATE INDEX idx_instances_status ON instances(status);

CREATE TABLE card_print_requests (
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

CREATE INDEX idx_cpr_instance_id ON card_print_requests(instance_id);
CREATE INDEX idx_cpr_status ON card_print_requests(status);
CREATE INDEX idx_cpr_created_at ON card_print_requests(created_at DESC);

CREATE TABLE admin_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT 'admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_admin_sessions_token ON admin_sessions(token_hash);

CREATE TABLE card_print_batches (
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

CREATE INDEX idx_cpb_instance_id ON card_print_batches(instance_id);
CREATE INDEX idx_cpb_status ON card_print_batches(status);

CREATE TABLE devices (
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

CREATE INDEX idx_devices_instance_id ON devices(instance_id);
CREATE INDEX idx_devices_status ON devices(status);

CREATE TABLE instance_school_registry (
  instance_id UUID NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  school_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(instance_id, school_id)
);

CREATE TABLE licenses (
  instance_id UUID NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  school_id TEXT NOT NULL,
  license_id TEXT NOT NULL,
  status TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  grace_days INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY(instance_id, school_id)
);
