-- 0002_relay_inbox.sql
-- Phase 1 couple-channel relay (S4). The server stores opaque
-- ciphertext envelopes addressed to a daily-rotated blinded recipient
-- ID; it must not learn anything beyond:
--   * the blinded recipient (rotates each UTC day, derived via HMAC
--     from the couple_root that never leaves either device)
--   * the ratchet header and ciphertext bytes
--   * when the envelope was sent + when it arrived + when it expires
-- The server can decrypt none of this without the couple_root.

CREATE TABLE IF NOT EXISTS relay_inbox (
  id           UUID         PRIMARY KEY,
  blinded_id   BYTEA        NOT NULL,
  header       BYTEA        NOT NULL,
  ciphertext   BYTEA        NOT NULL,
  sent_at      TIMESTAMPTZ  NOT NULL,
  received_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ  NOT NULL
);

-- Recipients poll by blinded_id; the (blinded_id, received_at) tuple
-- supports keyset pagination via the (received_at, id) cursor.
CREATE INDEX IF NOT EXISTS relay_inbox_blinded_received_idx
  ON relay_inbox (blinded_id, received_at DESC, id DESC);

-- TTL sweep (apps/api/src/cron/relay-gc.ts in a later push) deletes any
-- row whose expires_at has passed; the index keeps that scan cheap.
CREATE INDEX IF NOT EXISTS relay_inbox_expires_idx ON relay_inbox (expires_at);
