-- 0005 — global-feed moderation flags (Phase 6A).
-- A post_flag is a per-device report against a global post with a reason
-- category. One report per (post, device) — re-flagging is idempotent. The
-- feed obscures any post with >= 1 flag (content withheld; the distinct
-- categories are shown in its place). FK cascade so a deleted post drops
-- its flags.
CREATE TABLE IF NOT EXISTS post_flag (
  id          UUID PRIMARY KEY,
  post_id     UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  category    TEXT NOT NULL,
  flagged_by  BYTEA NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (post_id, flagged_by)
);

CREATE INDEX IF NOT EXISTS post_flag_post_id_idx ON post_flag (post_id);
