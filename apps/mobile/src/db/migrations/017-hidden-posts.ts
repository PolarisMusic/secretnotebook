// 017 — Phase 6A feed moderation: locally-hidden global posts. "Hide" is a
// personal, device-local action (distinct from "Flag", which is a global
// server-side report that obscures content for everyone). A hidden post is
// filtered out of this device's feed entirely; the set is small and keyed
// by the global post id.
export const sql = `
CREATE TABLE IF NOT EXISTS hidden_post (
  global_post_id TEXT PRIMARY KEY,
  hidden_at      INTEGER NOT NULL
);
`;
