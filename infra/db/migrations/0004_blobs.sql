-- 0004_blobs.sql
-- Opaque encrypted-blob store for couple-note media (images, voice notes).
-- Like the relay, the server stores ONLY ciphertext and learns nothing it
-- could use to decrypt or correlate:
--   * a random handle it assigns on upload (not derived from any identity)
--   * the chunked-AEAD ciphertext bytes (content key never leaves the devices;
--     it rides the E2E note op)
--   * the byte size and the created/expiry timestamps
-- A blob is uploaded by the author, then fetched once by the partner using the
-- handle carried inside the (E2E-encrypted) attachment descriptor.

CREATE TABLE IF NOT EXISTS blobs (
  id          UUID         PRIMARY KEY,
  data        BYTEA        NOT NULL,
  byte_size   INTEGER      NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ  NOT NULL
);

-- TTL is enforced at read time (get filters expires_at > now); the index keeps
-- the periodic purge sweep cheap.
CREATE INDEX IF NOT EXISTS blobs_expires_idx ON blobs (expires_at);
