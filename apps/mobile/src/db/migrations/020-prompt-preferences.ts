// 020 — prompt category preferences (per-user, partner-synced).
//
// One row per pubkey, owned by that pubkey. The local user owns their
// own row (writes via the preferences store); the partner's row is
// projected from incoming `prompt_preference.set` ops. Last-write-wins
// by `updated_at`.
//
// `categories` holds a JSON-encoded string array (e.g. '["dating","general"]').
// SQLite doesn't have first-class arrays, and JSON keeps the projector
// straight-through — the application layer (`preferences-store`) is the
// only place that parses it.
//
// An empty preferences row (no row at all) is treated by the draw
// filter as "everything enabled" — a fresh install picks from the full
// pool until the user opens Prompt Preferences and changes it.
export const sql = `
CREATE TABLE prompt_preference (
  pubkey      BLOB PRIMARY KEY,
  categories  TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);
`;
