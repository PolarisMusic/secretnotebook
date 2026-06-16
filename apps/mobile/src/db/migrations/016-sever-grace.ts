// 016 — R8 connection termination (7-day grace). Two nullable columns on
// the connection row track a pending, unilateral sever:
//   - sever_initiated_by: pubkey of the partner who started it (the only
//     side that may cancel/undo it),
//   - sever_at: unix seconds when the local wipe becomes due. Both devices
//     independently wipe all connection-scoped data once now >= sever_at.
//
// Nullable + co-NULL: a connection with no pending sever has both NULL.
// The columns are dropped implicitly when the row is deleted at wipe time,
// so there's no "severed" tombstone — the device simply returns to
// unpaired and can re-pair. (No server involvement; points are E2E and go
// with the rest of the wiped data.)
export const sql = `
ALTER TABLE connection ADD COLUMN sever_initiated_by BLOB;
ALTER TABLE connection ADD COLUMN sever_at INTEGER;
`;
