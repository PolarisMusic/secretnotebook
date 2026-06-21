// 018 — Pre-pairing drafts (item I). Notes authored before there's a
// connection live here: no couple identity, no author_pubkey, no sync. The
// user can write notes with no partner yet, then on first pairing decide per
// note to Share (promoted into `note` and announced over the channel) or
// Archive (exported to CSV/JSON, then dropped).
//
// Text-only on purpose — attachments upload through the API and reference a
// `note` row, neither of which a draft has yet; media is added after pairing.
// Drafts are device-local and survive a sever (they aren't connection-scoped).
export const sql = `
CREATE TABLE IF NOT EXISTS pending_note (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('shared', 'secret')),
  body        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS pending_note_created_idx
  ON pending_note (created_at DESC, id);
`;
