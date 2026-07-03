-- 0008_pair_rendezvous.sql
-- Persistent pairing rendezvous for the long-distance flow. The previous
-- implementation held hellos in an in-memory Map, which the Fly machine
-- auto-stop wiped whenever the API idled between the two devices posting +
-- polling — pairing then timed out. Persisting the hellos lets a code stay
-- live for its full TTL (24h) across restarts.
--
-- A hello is a pair of base64 X25519 public keys, not a secret: the short
-- code is the only auth, and knowing it yields nothing but the two public
-- keys (the X3DH handshake still runs client-side). One row per
-- (code, hello); a repeat post is idempotent via the primary key.

CREATE TABLE IF NOT EXISTS pair_rendezvous (
  code        TEXT         NOT NULL,
  hello       TEXT         NOT NULL,
  posted_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ  NOT NULL,
  PRIMARY KEY (code, hello)
);

-- Poll path reads every non-expired hello for a code, oldest first.
CREATE INDEX IF NOT EXISTS pair_rendezvous_code_posted_idx
  ON pair_rendezvous (code, posted_at);

-- TTL sweep (cron/gc.ts) deletes rows whose expires_at has passed.
CREATE INDEX IF NOT EXISTS pair_rendezvous_expires_idx
  ON pair_rendezvous (expires_at);
