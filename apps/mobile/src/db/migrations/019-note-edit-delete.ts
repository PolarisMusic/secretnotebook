// 019 — note edit + delete.
//
// Three columns added, all nullable:
//
//   - `last_edited_at`  — wall-clock seconds of the most recent applied
//                         edit. Drives last-write-wins on the projector:
//                         an edit op is applied only when its `editedAt`
//                         is strictly newer than this. NULL means "never
//                         edited".
//   - `last_edited_by`  — pubkey of whoever made the most recent applied
//                         edit. Needed because shared notes can be edited
//                         by either partner (creator + the other); the UI
//                         renders "edited by …" from this.
//   - `deleted_at`      — wall-clock seconds when the row was tombstoned.
//                         NULL means "live". Set by the projector when the
//                         note's original author emits `note.delete`;
//                         `body` is cleared at the same time so the
//                         contents leave local storage even though the row
//                         survives as a tombstone. listNotes filters on
//                         this so deleted rows don't appear; the
//                         secret-unlock pool query does the same so a
//                         deleted secret can't be drawn.
//
// Permissions enforced at the projector + store boundary, not the
// schema:
//   - shared: either partner may edit; only the original author may delete
//   - secret: only the original author may edit OR delete
//
// All three columns are nullable on add — existing rows are "never edited,
// not deleted" by default. The projector's edit branch is LWW + guarded by
// `deleted_at IS NULL` so a late edit can't resurrect a tombstone.
export const sql = `
ALTER TABLE note ADD COLUMN last_edited_at INTEGER;
ALTER TABLE note ADD COLUMN last_edited_by BLOB;
ALTER TABLE note ADD COLUMN deleted_at     INTEGER;
`;
