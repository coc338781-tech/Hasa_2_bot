ALTER TABLE bot_instances
  ADD COLUMN IF NOT EXISTS runtime_provisioned BOOLEAN NOT NULL DEFAULT false;
