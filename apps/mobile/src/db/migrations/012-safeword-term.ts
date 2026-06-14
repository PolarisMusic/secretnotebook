// 012 — Safe Word redesigned as an optional roleplay term (Phase 2).
//
// The term no longer gates anything (app entry is biometric). It is a
// shared, mutually-known word. Setting or changing it is a propose →
// "type it back to match" handshake that reuses the existing Argon2id
// verifier (safeword_verifier / safeword_salt from 001): the proposer
// derives the verifier locally and sends only the hash; the partner
// derives the same salt from the shared root key and matches a typed
// candidate against it. The plaintext word never travels on-wire.
//
// New columns on `connection`:
//   safeword_term              — plaintext of the CONFIRMED term, for display
//                                (protected at rest by SQLCipher, same as
//                                every other row).
//   safeword_confirmed_at      — NULL until the term is mutually confirmed.
//   safeword_proposal_*        — the in-flight handshake. proposal_term holds
//                                the proposer-side plaintext (NULL on the
//                                receiver) and is promoted to safeword_term on
//                                confirm, so a *change* keeps the old active
//                                term until the new one is confirmed.
//
// `safeword_trigger` records a manual "safe word used" signal. It mirrors the
// note add-only + first-write-wins idiom: trigger ops INSERT OR IGNORE a row,
// ack ops stamp acked_at WHERE acked_at IS NULL. A row with acked_at IS NULL
// is the active signal — surfaced on the partner's device until they confirm
// receipt.
export const sql = `
ALTER TABLE connection ADD COLUMN safeword_term TEXT;
ALTER TABLE connection ADD COLUMN safeword_confirmed_at INTEGER;
ALTER TABLE connection ADD COLUMN safeword_proposal_verifier BLOB;
ALTER TABLE connection ADD COLUMN safeword_proposal_by BLOB;
ALTER TABLE connection ADD COLUMN safeword_proposal_at INTEGER;
ALTER TABLE connection ADD COLUMN safeword_proposal_term TEXT;

CREATE TABLE IF NOT EXISTS safeword_trigger (
  id                  TEXT PRIMARY KEY,
  triggered_by_pubkey BLOB NOT NULL,
  triggered_at        INTEGER NOT NULL,
  acked_at            INTEGER
);

CREATE INDEX IF NOT EXISTS safeword_trigger_active_idx
  ON safeword_trigger (acked_at, triggered_at);
`;
