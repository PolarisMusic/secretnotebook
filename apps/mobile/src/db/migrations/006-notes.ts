// 006 — Phase-1.5 R2 notes. The connection's primary data carrier
// after the role-play/prompt cleanup. Two kinds:
//
//   - 'shared'  — body is the substance and travels with the op.
//                 Both partners see it as soon as the announce op
//                 lands. Think "save this article for both of us".
//
//   - 'secret'  — author's body stays local until they choose to
//                 reveal it. The wire only sees the existence of
//                 the note (id + author + createdAt) via the
//                 announce op; the body rides on a separate
//                 reveal op when the author opts in. R2 puts the
//                 reveal under direct author control; R2.5+ will
//                 add the partner-side unlock-attempt flow
//                 (draw challenge → claim → verify) that pulls
//                 the reveal automatically.
//
// `body` is nullable: NULL means "row exists but I don't have the
// substance yet" (i.e. partner-side secret pre-reveal). Author-side
// secrets always have body filled locally. `revealed_at` is set
// when the body has been published to the connection — it serves
// as both an audit hint and the idempotency guard on the partner's
// reveal projector branch.
export const sql = `
CREATE TABLE IF NOT EXISTS note (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('shared', 'secret')),
  author_pubkey BLOB NOT NULL,
  body          TEXT,
  created_at    INTEGER NOT NULL,
  revealed_at   INTEGER
);

CREATE INDEX IF NOT EXISTS note_created_idx
  ON note (created_at DESC, id);
`;
