// 013 — Phase 3a: cache the author-tagged audience on globally-fetched posts.
//
// The global feed now carries a per-post `audience` ('everyone' | 'masculine'
// | 'feminine') that drives the role filter. The write-through `post_cache`
// (used for the offline / post-detail fallback) gains the column so a cached
// post round-trips the tag instead of losing it. Existing rows backfill to
// 'everyone', matching the server default.
export const sql = `
ALTER TABLE post_cache ADD COLUMN audience TEXT NOT NULL DEFAULT 'everyone';
`;
