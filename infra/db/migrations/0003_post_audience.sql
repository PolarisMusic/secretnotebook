-- 0003_post_audience.sql
-- Phase 3a: roles drive the global feed. The author tags each post with an
-- intended audience ('everyone' | 'masculine' | 'feminine'); the feed's
-- default-on role filter returns posts whose audience matches the viewer's
-- connection role plus 'everyone'. Existing rows backfill to 'everyone' so
-- they stay visible to all.

ALTER TABLE posts ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'everyone';

-- The filtered feed query is `audience IN (:role, 'everyone') ORDER BY
-- created_at DESC, id DESC`; this index keeps it a cheap keyset scan.
CREATE INDEX IF NOT EXISTS posts_audience_created_idx
  ON posts (audience, created_at DESC, id DESC);
