// 022 — reveal_comment column on note.
// The author of a secret note can attach a short explanation when revealing
// it ("why I'm sharing this now"). The message travels inside the E2E-encrypted
// note.secret.reveal op and is persisted here so the partner can read it on
// the note detail screen after the reveal.
export const sql = `
ALTER TABLE note ADD COLUMN reveal_comment TEXT;
`;
