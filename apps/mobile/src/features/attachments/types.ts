import type {
  AttachmentDescriptor,
  AttachmentMediaType,
} from '@secretnotebook/connection-protocol';

/**
 * Lifecycle of an attachment's bytes on THIS device:
 *   - 'pending'      author encrypted it locally, blob upload not yet done
 *   - 'ready'        ciphertext is on disk (own copy, or fetched from blob)
 *   - 'remote'       descriptor known (from the note op), blob still on server
 *   - 'downloading'  a fetch is in flight
 *   - 'failed'       last fetch errored; retryable
 */
export type AttachmentState = 'pending' | 'ready' | 'remote' | 'downloading' | 'failed';

export interface AttachmentRow {
  id: string;
  noteId: string;
  mediaType: AttachmentMediaType;
  mimeType: string;
  byteSize: number;
  contentHash: Uint8Array;
  contentKey: Uint8Array;
  noncePrefix: Uint8Array;
  chunkSize: number;
  /** Opaque server handle; NULL only momentarily before upload completes. */
  blobId: string | null;
  /** Encrypted file on this device; NULL until fetched (partner-side). */
  localUri: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  state: AttachmentState;
  createdAt: number;
}

/**
 * What an image/audio picker or in-app capture hands back: a local file URI
 * for the PLAINTEXT source plus light metadata. The pipeline reads the bytes,
 * encrypts, uploads, and discards the plaintext source.
 */
export interface PickedMedia {
  uri: string;
  mediaType: AttachmentMediaType;
  mimeType: string;
  width?: number;
  height?: number;
  durationMs?: number;
}

/**
 * Injected media-access seam. Production wiring (native.ts) backs this with
 * expo-image-picker / expo-camera / expo-av; tests pass an in-memory fake.
 * Each method resolves null when the user cancels.
 */
export interface MediaSource {
  pickImage(): Promise<PickedMedia | null>;
  captureImage(): Promise<PickedMedia | null>;
  pickAudio(): Promise<PickedMedia | null>;
  recordAudio(): Promise<PickedMedia | null>;
}

/**
 * Injected filesystem seam. Production wiring backs this with
 * expo-file-system; tests pass an in-memory fake. Encrypted blobs live in a
 * persistent dir; decrypted previews go to a cache dir that is cleared when
 * the app locks/backgrounds.
 */
export interface FileStore {
  /** Read an entire file's bytes (callers cap size before calling). */
  readFile(uri: string): Promise<Uint8Array>;
  /** Persist ciphertext under a stable name; returns its URI. */
  writeEncryptedFile(name: string, bytes: Uint8Array): Promise<string>;
  /** Write decrypted bytes to the (lock-cleared) cache dir; returns its URI. */
  writeCacheFile(name: string, bytes: Uint8Array): Promise<string>;
  /** Best-effort delete; never throws for a missing file. */
  remove(uri: string): Promise<void>;
}

/**
 * An attachment the author has encrypted + uploaded, ready to be persisted
 * against a note and announced/revealed to the partner. Pairs the on-wire
 * descriptor with the local encrypted file URI so the note store can write
 * the row without re-deriving anything.
 */
export interface PreparedAttachment {
  descriptor: AttachmentDescriptor;
  localUri: string;
}
