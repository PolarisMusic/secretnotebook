-- 0006 — flag detail + moderation log.
--
-- Adds two things on top of the post_flag table from 0005:
--
-- 1. `post_flag.detail` — free-text reason. Required by the shared schema
--    when category = 'other'; optional otherwise. Bounded at 280 chars by
--    PostFlagInputSchema (server enforces), but the column itself is just
--    TEXT so a future protocol bump that widens the ceiling needs only a
--    code-side check.
--
-- 2. `flag_log` — append-only audit trail for the strictest flag category
--    (`reveals_personal_details`). The current `post_flag` table dedupes
--    (post, device) so re-flagging is idempotent, which is wrong for
--    auditing: each report from a distinct device against a personal-
--    details post needs its own row + the original poster's anon-pubkey
--    captured so a moderator can review the offending author out-of-band.
--    No FK to posts(id) — a deleted post must not silently wipe its audit
--    trail (the moderation surface still needs to see the record).
ALTER TABLE post_flag ADD COLUMN detail TEXT;

CREATE TABLE IF NOT EXISTS flag_log (
  id              UUID         PRIMARY KEY,
  post_id         UUID         NOT NULL,
  posted_by       BYTEA        NOT NULL,
  flagger         BYTEA        NOT NULL,
  category        TEXT         NOT NULL,
  detail          TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS flag_log_post_idx ON flag_log (post_id);
CREATE INDEX IF NOT EXISTS flag_log_posted_by_idx ON flag_log (posted_by);
