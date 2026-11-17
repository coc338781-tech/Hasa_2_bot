ALTER TABLE bot_instances
  ADD COLUMN IF NOT EXISTS whatsapp_registered BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS provisioning_jobs_server_claim_idx
  ON provisioning_jobs(server_id, status, available_at, created_at)
  WHERE job_type IN ('instance_create','pairing_start','instance_start','instance_stop','instance_restart');
