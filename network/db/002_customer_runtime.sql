-- Customer accounts, isolated bot runtime metadata, pairing lifecycle and allow-listed jobs.
-- Raw pairing codes, WhatsApp auth state, and encryption keys must never be stored here.

CREATE TABLE IF NOT EXISTS customer_accounts (
  id UUID PRIMARY KEY,
  customer_id UUID NOT NULL UNIQUE REFERENCES customers(id) ON DELETE CASCADE,
  login_email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  disabled_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS customer_sessions (
  id UUID PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS customer_sessions_active_idx
  ON customer_sessions(customer_id, expires_at) WHERE revoked_at IS NULL;

ALTER TABLE bot_instances
  ADD COLUMN IF NOT EXISTS instance_key TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS runtime_data_ref TEXT,
  ADD COLUMN IF NOT EXISTS last_error_code TEXT,
  ADD COLUMN IF NOT EXISTS last_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_stopped_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS pairing_requests (
  id UUID PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  bot_instance_id UUID NOT NULL REFERENCES bot_instances(id) ON DELETE CASCADE,
  phone_e164 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','generating','code_ready','paired','expired','failed','cancelled')),
  pairing_code_hash TEXT CHECK (pairing_code_hash IS NULL OR length(pairing_code_hash) = 64),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 10),
  expires_at TIMESTAMPTZ NOT NULL,
  paired_at TIMESTAMPTZ,
  failure_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pairing_requests_customer_recent_idx
  ON pairing_requests(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pairing_requests_pending_idx
  ON pairing_requests(status, expires_at)
  WHERE status IN ('queued','generating','code_ready');

-- Encrypted Baileys auth-state blobs only. Encryption/decryption keys live outside PostgreSQL
-- in the deployment secret manager/KMS; each instance has its own vault row.
CREATE TABLE IF NOT EXISTS whatsapp_session_vault (
  id UUID PRIMARY KEY,
  bot_instance_id UUID NOT NULL UNIQUE REFERENCES bot_instances(id) ON DELETE CASCADE,
  ciphertext BYTEA NOT NULL,
  nonce BYTEA NOT NULL,
  auth_tag BYTEA NOT NULL,
  key_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Workers may execute only these explicit operation types; never arbitrary shell commands.
CREATE TABLE IF NOT EXISTS provisioning_jobs (
  id UUID PRIMARY KEY,
  server_id UUID NOT NULL REFERENCES servers(id),
  bot_instance_id UUID REFERENCES bot_instances(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL CHECK (job_type IN (
    'instance_create','instance_start','instance_stop','instance_restart',
    'instance_update','instance_remove','pairing_start','pairing_cancel'
  )),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','leased','running','succeeded','failed','cancelled')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 5),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS provisioning_jobs_dispatch_idx
  ON provisioning_jobs(server_id, status, available_at, created_at)
  WHERE status IN ('queued','leased');

CREATE INDEX IF NOT EXISTS bot_instances_customer_status_idx
  ON bot_instances(customer_id, status);
