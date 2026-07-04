-- 0009_blobs_object_key.sql
-- Prepare the blobs table for the object-storage backend (R2/S3). Ciphertext
-- can now live in a bucket instead of inline BYTEA — the row keeps only the
-- object key + metadata (size, TTL). Postgres stops carrying large media
-- payloads, which is where the Fly/Postgres bill was growing.
--
-- Additive + backward compatible: the default backend still stores bytes in
-- `data`. When BLOB_BACKEND=s3, new rows set `blob_key` and leave `data` NULL,
-- so `data` must become nullable. Existing inline rows are untouched and age
-- out under their own TTL.

ALTER TABLE blobs ADD COLUMN IF NOT EXISTS blob_key TEXT;
ALTER TABLE blobs ALTER COLUMN data DROP NOT NULL;
