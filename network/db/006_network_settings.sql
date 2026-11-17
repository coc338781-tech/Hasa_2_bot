-- Owner-controlled resource admission policy. Values are stored in bytes.
CREATE TABLE IF NOT EXISTS network_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO network_settings (setting_key, setting_value)
VALUES ('min_free_memory_bytes', to_jsonb(805306368::bigint))
ON CONFLICT (setting_key) DO NOTHING;
