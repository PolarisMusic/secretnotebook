// 007 — Phase-1.5 R3 publish-from-note. A note can be promoted to a
// public post on the global feed; once it has been, both sides need
// to know:
//
//   - `published_at`             — wall-clock seconds at the moment
//                                  the connection's publish op
//                                  landed. NULL means "still
//                                  private to this connection."
//   - `published_global_post_id` — UUID of the resulting public post,
//                                  so the local UI can deep-link
//                                  into the feed when it surfaces
//                                  the "published" state.
//
// Both columns nullable + add-only via the projector's
// `WHERE published_at IS NULL` guard — first publish wins; replays
// or hostile second-publish ops are no-ops.
export const sql = `
ALTER TABLE note ADD COLUMN published_at INTEGER;
ALTER TABLE note ADD COLUMN published_global_post_id TEXT;
`;
