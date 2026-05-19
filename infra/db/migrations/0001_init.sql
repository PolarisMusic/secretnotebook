-- 0001_init.sql
-- Phase 1 server schema. The moderation tier is allowed to know:
--   * a post's content_type + body (posts are explicitly public/global)
--   * a body_hash for dedup
--   * an anon_author tag (per-device pseudonym)
--   * a device pubkey + first-seen timestamp + reputation counter
-- It must NOT learn anything about: couples, profiles, Safe Words,
-- saved posts, prompts, ratings, gratitude, role-play, or Couple Points.

CREATE TABLE IF NOT EXISTS posts (
  id           UUID         PRIMARY KEY,
  content_type TEXT         NOT NULL,
  body         TEXT         NOT NULL,
  body_hash    BYTEA        NOT NULL,
  anon_author  BYTEA        NOT NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  popularity   INTEGER      NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS posts_created_at_idx ON posts (created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS posts_body_hash_uidx ON posts (body_hash);

CREATE TABLE IF NOT EXISTS devices (
  pubkey      BYTEA        PRIMARY KEY,
  first_seen  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  reputation  INTEGER      NOT NULL DEFAULT 0
);
