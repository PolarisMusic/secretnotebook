// 005 — Phase-1.5 R1 rename. The "couple" model becomes "connection".
// The schema-level change is a pure rename: no semantic shift, no
// data movement, no reshape of joins. Done as a discrete migration
// so a device that has already paired keeps its ratchet state
// intact across the rename — SQLite ALTER TABLE RENAME preserves
// row data and updates references in triggers, views, FKs, and
// indexes automatically since 3.25 (our better-sqlite3 11.x ships
// 3.46+).
//
// Out of scope, deferred:
//   - ledger_entry.kind = 'couple_points' literal stays. The CHECK
//     can't be modified in place without a table rebuild, and the
//     only writer was retired in R0 so there are no rows to migrate;
//     a later slice can rebuild the ledger when there's a real
//     reason to (e.g. when a second `kind` shows up).
//   - connection.status = 'paired' and partner_a_pubkey /
//     partner_b_pubkey stay — those terms are neutral, no rename
//     needed.
export const sql = `
ALTER TABLE couple RENAME TO connection;
ALTER TABLE couple_ratchet RENAME TO connection_ratchet;
ALTER TABLE connection_ratchet RENAME COLUMN couple_id TO connection_id;
`;
