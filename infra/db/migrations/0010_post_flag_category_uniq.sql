-- 0010_post_flag_category_uniq.sql
-- Let a viewer report the same post again under a DIFFERENT reason.
--
-- The original constraint was UNIQUE (post_id, flagged_by), so the second
-- report from a device was collapsed into the first and its category was
-- discarded — a post first flagged "off topic" could never also be reported
-- as, say, "reveals personal details". Widening the key to include the
-- category keeps repeat reports of the SAME reason idempotent while letting a
-- genuinely different reason register.
--
-- Safe on existing data: rows unique under (post_id, flagged_by) are also
-- unique under the wider key, so nothing conflicts.

ALTER TABLE post_flag DROP CONSTRAINT IF EXISTS post_flag_post_device_uniq;

DO $$
BEGIN
  ALTER TABLE post_flag
    ADD CONSTRAINT post_flag_post_device_category_uniq
    UNIQUE (post_id, flagged_by, category);
EXCEPTION
  WHEN duplicate_table THEN NULL;  -- constraint already present
  WHEN duplicate_object THEN NULL;
END $$;
