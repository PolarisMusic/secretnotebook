// 008 — Phase-1.5 R4 connection roles. Each partner self-declares a
// role on the connection; the partner sees the value once it has
// rounded through the ratchet. Stored as two nullable columns on
// the connection table itself (symmetric with partner_a_pubkey /
// partner_b_pubkey) rather than a new carrier — only one value per
// partner, no history, no metadata.
//
// Three-value enum for now: 'masculine', 'feminine', 'neutral'. The
// CHECK constraint pins this at the SQLite layer so a malformed op
// that slipped past the wire-side Zod schema still can't poison the
// table. Widening the enum is a future migration that rebuilds the
// CHECK (better-sqlite3 11.x's 3.46 supports the table-rewrite
// dance under the hood for ALTER TABLE ... DROP COLUMN, but CHECK
// modifications still need an explicit table rebuild).
export const sql = `
ALTER TABLE connection ADD COLUMN partner_a_role TEXT
  CHECK (partner_a_role IS NULL OR partner_a_role IN ('masculine','feminine','neutral'));
ALTER TABLE connection ADD COLUMN partner_b_role TEXT
  CHECK (partner_b_role IS NULL OR partner_b_role IN ('masculine','feminine','neutral'));
`;
