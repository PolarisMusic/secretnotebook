// 014 — Phase-1.5 multimedia notes. Couple-only media (images, voice
// notes) attached to shared + secret notes.
//
// The bytes never live here: they're chunk-AEAD encrypted (see
// @secretnotebook/crypto) and the ciphertext is uploaded to the opaque
// /v1/blobs store, then fetched + cached as an encrypted file on the
// recipient's device. THIS row holds only the metadata + the keys needed
// to fetch and decrypt — all inside SQLCipher, so the content key is at
// rest under the same protection as the rest of the connection state.
//
//   content_key  — per-attachment 32-byte XChaCha key (NEVER leaves the
//                  two devices; rides the E2E note op, not the relay/blob).
//   nonce_prefix — 16-byte chunked-AEAD nonce prefix.
//   content_hash — sha256 of the plaintext; verified after decrypt.
//   blob_id      — opaque server handle (NULL only briefly pre-upload).
//   local_uri    — encrypted file on this device. NULL = not fetched yet
//                  (partner-side, state 'remote').
//   state        — 'pending'     author has it locally, upload not done
//                  'ready'       ciphertext available locally (own or fetched)
//                  'remote'      descriptor known, blob still on server
//                  'downloading' fetch in flight
//                  'failed'      last fetch errored; retryable
export const sql = `
CREATE TABLE IF NOT EXISTS attachment (
  id            TEXT PRIMARY KEY,
  note_id       TEXT NOT NULL,
  media_type    TEXT NOT NULL CHECK (media_type IN ('image', 'audio')),
  mime_type     TEXT NOT NULL,
  byte_size     INTEGER NOT NULL,
  content_hash  BLOB NOT NULL,
  content_key   BLOB NOT NULL,
  nonce_prefix  BLOB NOT NULL,
  chunk_size    INTEGER NOT NULL,
  blob_id       TEXT,
  local_uri     TEXT,
  width         INTEGER,
  height        INTEGER,
  duration_ms   INTEGER,
  state         TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS attachment_note_idx
  ON attachment (note_id);
`;
