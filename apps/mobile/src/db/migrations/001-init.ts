// Phase 1 mobile schema. Matches the plan's Mobile local DB schema (every
// table including roleplay_session), with SQLite-appropriate types:
//   - identifiers: TEXT (UUID strings)
//   - pubkeys / hashes / wrapped keys: BLOB
//   - timestamps: INTEGER (unix seconds; matches strftime('%s','now'))
//   - enums: TEXT + CHECK constraint
//
// All tables and indexes are created if missing so the same migration can
// be re-applied to a fresh device or replayed in tests.
export const sql = `
CREATE TABLE IF NOT EXISTS profiles (
  id                   TEXT PRIMARY KEY,
  display_name         TEXT NOT NULL,
  public_bio           TEXT,
  partner_private_bio  TEXT,
  created_at           INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS couple (
  id                       TEXT PRIMARY KEY,
  partner_a_pubkey         BLOB NOT NULL,
  partner_b_pubkey         BLOB NOT NULL,
  safeword_verifier        BLOB,
  safeword_salt            BLOB,
  channel_root_key_wrapped BLOB NOT NULL,
  paired_at                INTEGER NOT NULL,
  status                   TEXT NOT NULL
    CHECK (status IN ('unpaired', 'awaiting_safeword', 'paired', 'severed'))
);

CREATE TABLE IF NOT EXISTS session (
  id                    TEXT PRIMARY KEY,
  opened_at             INTEGER NOT NULL,
  safeword_satisfied_at INTEGER,
  expires_at            INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS post_cache (
  global_id      TEXT PRIMARY KEY,
  content_type   TEXT NOT NULL,
  body           TEXT NOT NULL,
  anon_author_id BLOB NOT NULL,
  fetched_at     INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS saved_post (
  id               TEXT PRIMARY KEY,
  global_post_id   TEXT NOT NULL,
  saved_by_pubkey  BLOB NOT NULL,
  saved_for_pubkey BLOB NOT NULL,
  created_at       INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  unlocked_at      INTEGER,
  unlock_prompt_id TEXT
);

CREATE INDEX IF NOT EXISTS saved_post_for_pubkey_idx
  ON saved_post (saved_for_pubkey, unlocked_at);

CREATE TABLE IF NOT EXISTS prompt (
  id                  TEXT PRIMARY KEY,
  library_key         TEXT NOT NULL,
  title               TEXT NOT NULL,
  body                TEXT NOT NULL,
  assigned_to_pubkey  BLOB NOT NULL,
  assigned_by_pubkey  BLOB NOT NULL,
  state               TEXT NOT NULL
    CHECK (state IN ('assigned', 'completed', 'certified', 'expired')),
  completed_at        INTEGER,
  certified_at        INTEGER
);

CREATE INDEX IF NOT EXISTS prompt_assigned_to_idx
  ON prompt (assigned_to_pubkey, state);

CREATE TABLE IF NOT EXISTS ledger_entry (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('couple_points')),
  delta      INTEGER NOT NULL,
  reason     TEXT NOT NULL,
  ref_id     TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS ledger_entry_kind_idx
  ON ledger_entry (kind, created_at);

CREATE TABLE IF NOT EXISTS roleplay_session (
  id                         TEXT PRIMARY KEY,
  enactor_pubkey             BLOB NOT NULL,
  curator_pubkey             BLOB NOT NULL,
  rating                     INTEGER,
  started_at                 INTEGER NOT NULL,
  gratitude_prompt_id        TEXT,
  gratitude_enactor_done_at  INTEGER,
  gratitude_curator_done_at  INTEGER,
  ended_at                   INTEGER
);

CREATE TABLE IF NOT EXISTS sync_outbox (
  id              TEXT PRIMARY KEY,
  envelope        TEXT NOT NULL,
  recipient_pubkey BLOB NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS sync_outbox_next_attempt_idx
  ON sync_outbox (next_attempt_at);

CREATE TABLE IF NOT EXISTS sync_seen (
  envelope_hash BLOB PRIMARY KEY
);
`;
