// 023 — title column on note.
// Optional short title set at compose time. Travels with note.share.add
// (shared notes) and note.secret.reveal (secret notes — substance stays
// off the wire until reveal, same as body). NULL means no title was set;
// the UI falls back to a body preview in that case.
export const sql = `
ALTER TABLE note ADD COLUMN title TEXT;
`;
