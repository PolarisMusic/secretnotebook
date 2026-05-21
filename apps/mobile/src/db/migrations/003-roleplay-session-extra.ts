// 003 — Role-play session: link back to the unlocked post + carry the
// gratitude prompt's text so both partners can render it without
// re-resolving against a library version.
//
// Three new columns on roleplay_session:
//   - saved_post_id           — the unlocked saved_post whose contents
//                               the enactor tried. Needed so the curator
//                               can be reminded what they curated when
//                               they're prompted to rate.
//   - gratitude_prompt_title  — caches the title chosen at start time.
//                               Storing the text in the row + in the
//                               start op means we don't depend on a
//                               versioned library being identical on
//                               both devices.
//   - gratitude_prompt_body   — caches the body. Same rationale.
// SQLite's ALTER TABLE ... ADD COLUMN is happy with these because the
// existing rows (zero in Phase 1) can accept NULL safely.
export const sql = `
ALTER TABLE roleplay_session ADD COLUMN saved_post_id          TEXT;
ALTER TABLE roleplay_session ADD COLUMN gratitude_prompt_title TEXT;
ALTER TABLE roleplay_session ADD COLUMN gratitude_prompt_body  TEXT;
`;
