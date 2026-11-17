-- Track the isolated worker separately from the telemetry agent.
ALTER TABLE servers
  ADD COLUMN IF NOT EXISTS worker_last_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS worker_version TEXT,
  ADD COLUMN IF NOT EXISTS worker_max_sessions INTEGER,
  ADD COLUMN IF NOT EXISTS worker_active_sessions INTEGER;
