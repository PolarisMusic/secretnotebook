// 002 — Persistent ratchet state per couple.
//
// The couple-channel ratchet (packages/couple-protocol/src/ratchet) advances
// on every encrypt + decrypt. Cold launches must restore the exact state
// otherwise out-of-order envelopes that arrived right before close lose
// their skipped message keys. We store it in a separate table so the hot
// "advance counters + rewrite skipped cache" writes don't churn the couple
// row that navigation + status queries read every render.
//
// `self_side` lives here too: the couple table itself is symmetric
// (partner_a / partner_b ordered lexicographically; both devices agree
// on which pubkey is which) but does NOT record "which one is me". The
// ratchet is what needs that fact at every encrypt/decrypt, so we
// co-locate it. Pairing writes the side once; nothing else touches it.
//
// `couple_id` references couple.id — severing (Phase 2) wipes both rows
// in the same txn via ON DELETE CASCADE. `skipped_keys` is a versioned
// custom binary blob; the codec lives in
// packages/couple-protocol/src/ratchet/persistence.ts so the schema stays
// dumb.
export const sql = `
CREATE TABLE IF NOT EXISTS couple_ratchet (
  couple_id            TEXT PRIMARY KEY REFERENCES couple(id) ON DELETE CASCADE,
  self_side            TEXT NOT NULL CHECK (self_side IN ('a', 'b')),
  sending_chain_key    BLOB NOT NULL,
  sending_counter      INTEGER NOT NULL,
  receiving_chain_key  BLOB NOT NULL,
  receiving_counter    INTEGER NOT NULL,
  skipped_keys         BLOB NOT NULL,
  updated_at           INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
`;
