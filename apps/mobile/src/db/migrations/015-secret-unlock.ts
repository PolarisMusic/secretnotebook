// 015 — R7 secret-note unlock loop. A two-party, multi-step interaction
// layered on top of the R2 notes carrier:
//
//   1. the Unlocker starts an attempt against the Author's secret pool
//      and draws a relationship prompt (assigned),
//   2. completes the real-world task and submits it (submitted),
//   3. the Author verifies — which draws ONE random unrevealed secret
//      and ships its body to the Unlocker (revealed) — or sends it back
//      (returned) for another go; the Unlocker may cancel before the
//      reveal (canceled),
//   4. both partners reflect on the revealed note.
//
// `secret_unlock` is the attempt row. State transitions arrive as CRDT
// ops keyed on the attempt id; the add-only `start` op creates the row.
// `revealed_note_id` is the secret drawn at verify time — present on the
// Author's row immediately (they drew it) but withheld from the Author's
// UI until they open reflection ("blind until reflection").
//
// `secret_unlock_reflection` holds each partner's reflection, keyed
// (attempt_id, by_pubkey) so the projector's INSERT OR IGNORE collapses
// replays + the author's own echo. The mutual-reflection Couple-Points
// award fires once both rows exist (see ledger/store.ts awardCouplePoints).
export const sql = `
CREATE TABLE IF NOT EXISTS secret_unlock (
  id               TEXT PRIMARY KEY,
  author_pubkey    BLOB NOT NULL,
  unlocker_pubkey  BLOB NOT NULL,
  prompt_key       TEXT NOT NULL,
  state            TEXT NOT NULL
    CHECK (state IN ('assigned', 'submitted', 'returned', 'revealed', 'canceled')),
  created_at       INTEGER NOT NULL,
  submitted_at     INTEGER,
  returned_at      INTEGER,
  verified_at      INTEGER,
  canceled_at      INTEGER,
  revealed_note_id TEXT
);

CREATE INDEX IF NOT EXISTS secret_unlock_author_idx
  ON secret_unlock (author_pubkey, state);

CREATE INDEX IF NOT EXISTS secret_unlock_unlocker_idx
  ON secret_unlock (unlocker_pubkey, state);

CREATE TABLE IF NOT EXISTS secret_unlock_reflection (
  attempt_id    TEXT NOT NULL,
  by_pubkey     BLOB NOT NULL,
  appreciate    TEXT NOT NULL,
  uncomfortable TEXT NOT NULL,
  stars         INTEGER,
  reflected_at  INTEGER NOT NULL,
  PRIMARY KEY (attempt_id, by_pubkey)
);
`;
