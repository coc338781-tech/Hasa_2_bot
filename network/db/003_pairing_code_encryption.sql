-- Encrypted, short-lived pairing codes only. Raw codes are never stored in plaintext.
ALTER TABLE pairing_requests
  ADD COLUMN IF NOT EXISTS pairing_code_ciphertext BYTEA,
  ADD COLUMN IF NOT EXISTS pairing_code_nonce BYTEA,
  ADD COLUMN IF NOT EXISTS pairing_code_auth_tag BYTEA,
  ADD COLUMN IF NOT EXISTS pairing_code_key_version TEXT;
ALTER TABLE pairing_requests
  DROP CONSTRAINT IF EXISTS pairing_code_encryption_fields_check;
ALTER TABLE pairing_requests
  ADD CONSTRAINT pairing_code_encryption_fields_check CHECK (
    (pairing_code_ciphertext IS NULL AND pairing_code_nonce IS NULL AND pairing_code_auth_tag IS NULL AND pairing_code_key_version IS NULL)
    OR
    (pairing_code_ciphertext IS NOT NULL AND pairing_code_nonce IS NOT NULL AND octet_length(pairing_code_nonce) = 12
      AND pairing_code_auth_tag IS NOT NULL AND octet_length(pairing_code_auth_tag) = 16
      AND pairing_code_key_version IS NOT NULL)
  );
