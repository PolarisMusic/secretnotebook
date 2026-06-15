import type { AttachmentDescriptor } from '@secretnotebook/connection-protocol';
import { bytesToHex, hexToBytes } from '@secretnotebook/crypto';

import type { SqlExecutor } from '../../db/executor';
import type { AttachmentRow, AttachmentState } from './types';

interface RawAttachmentRow {
  id: string;
  note_id: string;
  media_type: 'image' | 'audio';
  mime_type: string;
  byte_size: number;
  content_hash: Uint8Array | ArrayBufferLike;
  content_key: Uint8Array | ArrayBufferLike;
  nonce_prefix: Uint8Array | ArrayBufferLike;
  chunk_size: number;
  blob_id: string | null;
  local_uri: string | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  state: AttachmentState;
  created_at: number;
}

function bytesFromRow(value: Uint8Array | ArrayBufferLike): Uint8Array {
  if (value instanceof Uint8Array) return value;
  return new Uint8Array(value as ArrayBufferLike);
}

function rowOf(r: RawAttachmentRow): AttachmentRow {
  return {
    id: r.id,
    noteId: r.note_id,
    mediaType: r.media_type,
    mimeType: r.mime_type,
    byteSize: r.byte_size,
    contentHash: bytesFromRow(r.content_hash),
    contentKey: bytesFromRow(r.content_key),
    noncePrefix: bytesFromRow(r.nonce_prefix),
    chunkSize: r.chunk_size,
    blobId: r.blob_id,
    localUri: r.local_uri,
    width: r.width,
    height: r.height,
    durationMs: r.duration_ms,
    state: r.state,
    createdAt: r.created_at,
  };
}

const ATTACHMENT_SELECT = `id, note_id, media_type, mime_type, byte_size, content_hash,
                           content_key, nonce_prefix, chunk_size, blob_id, local_uri,
                           width, height, duration_ms, state, created_at`;

/** Build the on-wire descriptor from a locally-stored attachment row. The row
 *  must already have a blob_id (i.e. the author has uploaded it). */
export function descriptorFromRow(row: AttachmentRow): AttachmentDescriptor {
  if (!row.blobId) {
    throw new Error(`descriptorFromRow: attachment ${row.id} has no blobId`);
  }
  return {
    id: row.id,
    blobId: row.blobId,
    mediaType: row.mediaType,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    contentHash: bytesToHex(row.contentHash),
    contentKey: bytesToHex(row.contentKey),
    noncePrefix: bytesToHex(row.noncePrefix),
    chunkSize: row.chunkSize,
    ...(row.width != null ? { width: row.width } : {}),
    ...(row.height != null ? { height: row.height } : {}),
    ...(row.durationMs != null ? { durationMs: row.durationMs } : {}),
  };
}

/**
 * Insert an attachment row from an on-wire descriptor. Used both author-side
 * (own copy, `state: 'ready'` + a local encrypted file) and partner-side
 * (projector, `state: 'remote'`, no local file yet). INSERT OR IGNORE keyed on
 * the descriptor id makes replays + late deliveries collapse into one row.
 */
export async function insertAttachmentFromDescriptor(
  exec: SqlExecutor,
  noteId: string,
  descriptor: AttachmentDescriptor,
  opts: { state: AttachmentState; localUri: string | null; createdAt: number },
): Promise<void> {
  await exec.execute(
    `INSERT OR IGNORE INTO attachment (
       id, note_id, media_type, mime_type, byte_size, content_hash, content_key,
       nonce_prefix, chunk_size, blob_id, local_uri, width, height, duration_ms,
       state, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      descriptor.id,
      noteId,
      descriptor.mediaType,
      descriptor.mimeType,
      descriptor.byteSize,
      hexToBytes(descriptor.contentHash),
      hexToBytes(descriptor.contentKey),
      hexToBytes(descriptor.noncePrefix),
      descriptor.chunkSize,
      descriptor.blobId,
      opts.localUri,
      descriptor.width ?? null,
      descriptor.height ?? null,
      descriptor.durationMs ?? null,
      opts.state,
      opts.createdAt,
    ],
  );
}

export async function listNoteAttachments(
  exec: SqlExecutor,
  noteId: string,
): Promise<AttachmentRow[]> {
  const rows = await exec.query<RawAttachmentRow>(
    `SELECT ${ATTACHMENT_SELECT} FROM attachment WHERE note_id = ? ORDER BY created_at ASC, id ASC`,
    [noteId],
  );
  return rows.map(rowOf);
}

export async function getAttachment(exec: SqlExecutor, id: string): Promise<AttachmentRow | null> {
  const rows = await exec.query<RawAttachmentRow>(
    `SELECT ${ATTACHMENT_SELECT} FROM attachment WHERE id = ?`,
    [id],
  );
  const row = rows[0];
  return row ? rowOf(row) : null;
}

/** Mark an attachment as fetched: stamp the local encrypted file + 'ready'. */
export async function markAttachmentReady(
  exec: SqlExecutor,
  id: string,
  localUri: string,
): Promise<void> {
  await exec.execute(`UPDATE attachment SET local_uri = ?, state = 'ready' WHERE id = ?`, [
    localUri,
    id,
  ]);
}

export async function setAttachmentState(
  exec: SqlExecutor,
  id: string,
  state: AttachmentState,
): Promise<void> {
  await exec.execute(`UPDATE attachment SET state = ? WHERE id = ?`, [state, id]);
}
