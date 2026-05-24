// 004 — Phase-1.5 R0 cleanup. The Phase-1 couple-loop (role-play
// sessions + saved-post unlock-by-prompt + the prompt state machine
// that drove unlocks) is removed; the data carriers go with it.
//
//   - DROP TABLE roleplay_session — the whole role-play surface is
//     gone (no more enactor/curator/rating/gratitude); the table has
//     zero rows in Phase 1, so a hard drop is safe.
//   - DROP INDEX saved_post_for_pubkey_idx — its definition references
//     `unlocked_at`, so it has to drop before the column.
//   - ALTER TABLE saved_post DROP COLUMN unlocked_at / unlock_prompt_id
//     — saved_post survives as the proto-pin table; the partner-side
//     unlock semantics die. better-sqlite3 11.x bundles SQLite 3.46+,
//     which supports DROP COLUMN natively (added in 3.35).
//
// `saved_for_pubkey` stays for now — its drop is deferred to the
// later pin-rename migration (009) along with the `saved_post → pin`
// rename, per the Phase-1.5 plan.
//
// The `prompt` table is removed by-implication: nothing reads or
// writes it after the cleanup, but it stays as a stranded table
// until the broader schema reshape in R2 (we don't want migration
// 004 to be the one carrying every drop the refactor demands).
export const sql = `
DROP TABLE IF EXISTS roleplay_session;
DROP INDEX IF EXISTS saved_post_for_pubkey_idx;
ALTER TABLE saved_post DROP COLUMN unlocked_at;
ALTER TABLE saved_post DROP COLUMN unlock_prompt_id;
`;
