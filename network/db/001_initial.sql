-- HASA BOT NETWORK control-plane schema (PostgreSQL).
-- Never store raw WhatsApp credentials or agent bearer secrets in these tables.

CREATE TABLE IF NOT EXISTS owners (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  disabled_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS servers (
  id UUID PRIMARY KEY,
  label TEXT NOT NULL,
  provider TEXT NOT NULL,
  hostname TEXT NOT NULL,
  os_name TEXT,
  os_release TEXT,
  architecture TEXT,
  agent_version TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','online','offline','disabled')),
  cpu_cores INTEGER CHECK (cpu_cores IS NULL OR cpu_cores > 0),
  memory_total_bytes BIGINT CHECK (memory_total_bytes IS NULL OR memory_total_bytes >= 0),
  memory_available_bytes BIGINT CHECK (memory_available_bytes IS NULL OR memory_available_bytes >= 0),
  disk_total_bytes BIGINT CHECK (disk_total_bytes IS NULL OR disk_total_bytes >= 0),
  disk_available_bytes BIGINT CHECK (disk_available_bytes IS NULL OR disk_available_bytes >= 0),
  last_heartbeat_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS server_agent_credentials (
  server_id UUID PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY,
  display_name TEXT,
  phone_e164 TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','active','suspended','deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bot_instances (
  id UUID PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES customers(id),
  server_id UUID REFERENCES servers(id),
  product_code TEXT NOT NULL DEFAULT 'hasa-bot',
  release_version TEXT,
  status TEXT NOT NULL DEFAULT 'provisioning'
    CHECK (status IN ('pairing','provisioning','online','offline','updating','suspended','failed')),
  session_vault_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (customer_id)
);

CREATE TABLE IF NOT EXISTS releases (
  id UUID PRIMARY KEY,
  version TEXT NOT NULL UNIQUE,
  artifact_digest TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','testing','approved','deploying','active','rolled_back')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  owner_id UUID REFERENCES owners(id),
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  outcome TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS servers_status_heartbeat_idx ON servers(status, last_heartbeat_at);
CREATE INDEX IF NOT EXISTS bot_instances_server_status_idx ON bot_instances(server_id, status);
CREATE INDEX IF NOT EXISTS audit_events_created_idx ON audit_events(created_at DESC);
