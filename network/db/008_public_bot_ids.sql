CREATE SEQUENCE IF NOT EXISTS hasa_bot_public_id_seq START WITH 1;
ALTER TABLE bot_instances ADD COLUMN IF NOT EXISTS public_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS bot_instances_public_id_unique ON bot_instances(public_id) WHERE public_id IS NOT NULL;
UPDATE bot_instances SET public_id = 'HASA-' || lpad(nextval('hasa_bot_public_id_seq')::text, 4, '0') WHERE public_id IS NULL;
