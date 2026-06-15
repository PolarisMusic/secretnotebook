import {
  ATTACHMENT_MAX_BYTES,
  type AttachmentDescriptor,
} from '@secretnotebook/connection-protocol';
import {
  bytesToHex,
  chunkedDecrypt,
  chunkedEncrypt,
  generateContentKey,
} from '@secretnotebook/crypto';

import type { SqlExecutor } from '../../db/executor';
import { randomUuidV4 } from '../connection-channel/uuid';
import { getAttachment, markAttachmentReady, setAttachmentState } from './store';
import type { AttachmentRow, FileStore, PickedMedia, PreparedAttachment } from './types';

export interface PrepareAttachmentDeps {
  readonly fileStore: FileStore;
  /** Uploads opaque ciphertext to the blob store; returns the server handle. */
  readonly uploadBlob: (ciphertext: Uint8Array) => Promise<{ id: string }>;
  /** Override the id generator for deterministic tests. */
  readonly randomUuid?: () => Promise<string>;
}

/**
 * Author side: read a picked/captured media file, chunk-encrypt it under a
 * fresh content key, upload the ciphertext, and persist a local encrypted
 * copy. Returns the on-wire descriptor + the local file URI for the note
 * store to write the row. Runs entirely OUTSIDE any DB transaction — the
 * network upload may take seconds.
 *
 * Failure semantics: encrypt → upload → write-local-copy, in that order. If
 * the upload fails nothing is persisted; if the local write fails the blob
 * is already on the server (it TTLs out) but we still throw, so the caller
 * aborts the note rather than referencing a copy it can't view.
 */
export async function prepareAttachment(
  deps: PrepareAttachmentDeps,
  picked: PickedMedia,
): Promise<PreparedAttachment> {
  const plaintext = await deps.fileStore.readFile(picked.uri);
  if (plaintext.length === 0) {
    throw new Error('prepareAttachment: media file is empty');
  }
  if (plaintext.length > ATTACHMENT_MAX_BYTES) {
    throw new Error('prepareAttachment: media exceeds the size cap');
  }

  const key = await generateContentKey();
  const enc = await chunkedEncrypt(plaintext, key);
  const id = await (deps.randomUuid ?? randomUuidV4)();
  const { id: blobId } = await deps.uploadBlob(enc.ciphertext);
  const localUri = await deps.fileStore.writeEncryptedFile(`${id}.enc`, enc.ciphertext);

  const descriptor: AttachmentDescriptor = {
    id,
    blobId,
    mediaType: picked.mediaType,
    mimeType: picked.mimeType,
    byteSize: enc.byteSize,
    contentHash: bytesToHex(enc.contentHash),
    contentKey: bytesToHex(key),
    noncePrefix: bytesToHex(enc.noncePrefix),
    chunkSize: enc.chunkSize,
    ...(picked.width != null ? { width: picked.width } : {}),
    ...(picked.height != null ? { height: picked.height } : {}),
    ...(picked.durationMs != null ? { durationMs: picked.durationMs } : {}),
  };
  return { descriptor, localUri };
}

export interface DownloadAttachmentDeps {
  readonly exec: SqlExecutor;
  readonly fileStore: FileStore;
  /** Fetches opaque ciphertext for a blob handle. */
  readonly downloadBlob: (blobId: string) => Promise<Uint8Array>;
}

/**
 * Partner side: fetch a 'remote' attachment's ciphertext and cache it as a
 * local encrypted file. Idempotent — a 'ready' row with a local file short-
 * circuits. On failure the row flips to 'failed' (retryable) and the error
 * propagates.
 */
export async function downloadAttachment(
  deps: DownloadAttachmentDeps,
  attachmentId: string,
): Promise<AttachmentRow> {
  const row = await getAttachment(deps.exec, attachmentId);
  if (!row) throw new Error(`downloadAttachment: no attachment ${attachmentId}`);
  if (row.state === 'ready' && row.localUri) return row;
  if (!row.blobId) {
    throw new Error(`downloadAttachment: attachment ${attachmentId} has no blobId`);
  }

  await setAttachmentState(deps.exec, attachmentId, 'downloading');
  try {
    const ciphertext = await deps.downloadBlob(row.blobId);
    const localUri = await deps.fileStore.writeEncryptedFile(`${row.id}.enc`, ciphertext);
    await markAttachmentReady(deps.exec, attachmentId, localUri);
  } catch (e) {
    await setAttachmentState(deps.exec, attachmentId, 'failed');
    throw e;
  }
  return (await getAttachment(deps.exec, attachmentId)) as AttachmentRow;
}

export interface OpenAttachmentDeps {
  readonly exec: SqlExecutor;
  readonly fileStore: FileStore;
}

export interface OpenedAttachment {
  /** URI of the DECRYPTED file in the lock-cleared cache dir. */
  uri: string;
  mimeType: string;
  mediaType: AttachmentRow['mediaType'];
}

/**
 * Decrypt a locally-cached attachment to a plaintext cache file for the
 * renderer. The chunked-AEAD decrypt verifies every chunk + the whole-file
 * hash, so a tampered or truncated blob throws here rather than rendering
 * garbage. Cache files live in the lock-cleared dir — they never persist
 * past a session.
 */
export async function openAttachment(
  deps: OpenAttachmentDeps,
  attachmentId: string,
): Promise<OpenedAttachment> {
  const row = await getAttachment(deps.exec, attachmentId);
  if (!row) throw new Error(`openAttachment: no attachment ${attachmentId}`);
  if (!row.localUri) {
    throw new Error(`openAttachment: attachment ${attachmentId} is not downloaded`);
  }
  const ciphertext = await deps.fileStore.readFile(row.localUri);
  const plaintext = await chunkedDecrypt(ciphertext, row.contentKey, {
    noncePrefix: row.noncePrefix,
    contentHash: row.contentHash,
    byteSize: row.byteSize,
  });
  const uri = await deps.fileStore.writeCacheFile(row.id, plaintext);
  return { uri, mimeType: row.mimeType, mediaType: row.mediaType };
}
