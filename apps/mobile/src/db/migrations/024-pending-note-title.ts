// 024 — title column on pending_note.
// Mirrors 023 (title on `note`): a pre-pairing draft can now carry the
// optional short title the compose form collects. NULL means no title.
// When a draft is promoted via sharePendingNote the title travels the same
// way a freshly composed note's does — with note.share.add for shared
// notes, kept local for secret notes until reveal.
export const sql = `
ALTER TABLE pending_note ADD COLUMN title TEXT;
`;
