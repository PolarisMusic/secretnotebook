// 021 — local cache of the server-owned prompt library.
//
// Mirrors the rows the API returns from `/v1/prompts`. Mobile fetches
// this once on boot (best-effort — a failure falls back to the bundled
// list shipped with the app) and hydrates this table from the response.
// Draw + render code reads from a module-level in-memory cache that's
// populated from this table at boot, so the synchronous resolve path
// keeps working without an SQLite hop per render.
//
// `categories` holds the JSON array the server sent — same wire shape
// the admin sees in the portal. Source attribution + sponsorship are
// inline so the prompt-card renderer can show them per-row.
//
// One row per `key`. The whole table is replaced atomically on each
// successful sync (DELETE + bulk INSERT in a transaction), so a retired
// prompt drops out of the local pool on the next fetch. The bundled
// fallback in code keeps historical op references resolving even when
// the cache is empty (cold install, sync failure).
export const sql = `
CREATE TABLE prompt_cache (
  key          TEXT PRIMARY KEY,
  text         TEXT NOT NULL,
  categories   TEXT NOT NULL DEFAULT '[]',
  source_name  TEXT,
  source_url   TEXT,
  sponsored    INTEGER NOT NULL DEFAULT 0,
  fetched_at   INTEGER NOT NULL
);
`;
