// 025 — emoji tags on notes and drafts.
// The author may tag any note with 1–3 emoji, rendered on the right of the
// row in the notes list. Two purposes: it makes the list more visually
// scannable/appealing, and on a SECRET note it acts as a hint about what is
// locked (see the note on note.secret.announce in the protocol package —
// emoji deliberately rides the announce so the hint is visible while the
// body is still withheld).
//
// Stored as a single TEXT column holding the concatenated emoji (NULL when
// the author didn't tag the note), mirroring how `title` is handled.
export const sql = `
ALTER TABLE note ADD COLUMN emoji TEXT;
ALTER TABLE pending_note ADD COLUMN emoji TEXT;
`;
