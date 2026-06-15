import { aeadDecrypt, aeadEncrypt } from './aead.js';
import { sha256 } from './sha256.js';
import { concatBytes, getSodium } from './sodium.js';

/**
 * Chunked AEAD for large binary attachments (images, voice notes).
 *
 * The couple channel's CRDT ops are small JSON encrypted whole; media is
 * megabytes and must never be held entirely in memory on the wire, nor ride
 * the ratchet. This module encrypts a payload as a sequence of independently
 * authenticated XChaCha20-Poly1305 chunks under a single random per-attachment
 * content key. The ciphertext stream is self-framing (each chunk is
 * length-prefixed), so decryption needs only the content key and the nonce
 * prefix — both of which travel inside the E2E-encrypted attachment descriptor
 * on the note op, never to the relay or blob server.
 *
 * Integrity properties (all enforced by AEAD, no extra MAC needed):
 *   - Tampering with any chunk byte  -> that chunk fails to decrypt.
 *   - Reordering / duplicating chunks -> the chunk index is bound into the AAD
 *     and the nonce, so a chunk decrypted at the wrong position fails.
 *   - Truncation (dropping trailing chunks) -> the final chunk carries a
 *     `final` marker in its AAD; the decryptor derives `final` from whether
 *     bytes remain, so a truncated stream's new "last" chunk was sealed as
 *     non-final and fails the tag check.
 * The whole-payload SHA-256 is additionally verified after reassembly as
 * defence in depth and to give callers a stable content identity.
 */

/** Default plaintext bytes per chunk. 64 KiB keeps peak memory bounded while
 *  amortising the 16-byte tag + 4-byte frame header to <0.1% overhead. */
export const ATTACHMENT_CHUNK_SIZE = 64 * 1024;

/** XChaCha20-Poly1305 authentication tag length. */
const TAG_BYTES = 16;
/** Random per-attachment nonce prefix; the remaining 8 bytes are the counter. */
const NONCE_PREFIX_BYTES = 16;
/** Big-endian chunk counter that fills the rest of the 24-byte XChaCha nonce. */
const COUNTER_BYTES = 8;
/** Length prefix on each framed chunk. */
const FRAME_HEADER_BYTES = 4;

const CHUNK_AAD_DOMAIN = new TextEncoder().encode('secretnotebook/attachment-chunk/v1');

export interface ChunkedEncryptResult {
  /** Self-framing ciphertext: repeated `u32be(len) || sealedChunk`. */
  ciphertext: Uint8Array;
  /** SHA-256 of the plaintext (32 bytes); verified on decrypt. */
  contentHash: Uint8Array;
  /** Plaintext length in bytes. */
  byteSize: number;
  /** Plaintext bytes per chunk used for this payload. */
  chunkSize: number;
  /** Random 16-byte nonce prefix; required (with the key) to decrypt. */
  noncePrefix: Uint8Array;
}

export interface ChunkedEncryptOptions {
  /** Override the chunk size (mainly for tests). */
  chunkSize?: number;
  /** Supply a deterministic nonce prefix (mainly for tests). */
  noncePrefix?: Uint8Array;
}

export interface ChunkedDecryptParams {
  /** The 16-byte nonce prefix produced by {@link chunkedEncrypt}. */
  noncePrefix: Uint8Array;
  /** Optional expected SHA-256 of the plaintext; verified after reassembly. */
  contentHash?: Uint8Array;
  /** Optional expected plaintext length; verified after reassembly. */
  byteSize?: number;
}

/** Generate a fresh 32-byte content key for a single attachment. */
export async function generateContentKey(): Promise<Uint8Array> {
  const sodium = await getSodium();
  return sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES);
}

/** Generate a fresh 16-byte nonce prefix for a single attachment. */
export async function generateNoncePrefix(): Promise<Uint8Array> {
  const sodium = await getSodium();
  return sodium.randombytes_buf(NONCE_PREFIX_BYTES);
}

/** 8-byte big-endian encoding of a non-negative chunk index (< 2^53). */
function counterBytes(index: number): Uint8Array {
  const out = new Uint8Array(COUNTER_BYTES);
  const view = new DataView(out.buffer);
  view.setUint32(0, Math.floor(index / 0x1_0000_0000));
  view.setUint32(4, index >>> 0);
  return out;
}

/** Per-chunk nonce = noncePrefix(16) || counter(8) = 24 bytes. */
function chunkNonce(noncePrefix: Uint8Array, index: number): Uint8Array {
  return concatBytes(noncePrefix, counterBytes(index));
}

/** Per-chunk AAD binds the chunk's position and whether it is the final one. */
function chunkAad(index: number, isFinal: boolean): Uint8Array {
  return concatBytes(CHUNK_AAD_DOMAIN, counterBytes(index), new Uint8Array([isFinal ? 1 : 0]));
}

/**
 * Encrypt `plaintext` into a self-framing chunked ciphertext under `key`.
 * The returned `noncePrefix` + `key` + the resulting ciphertext are all that is
 * needed to decrypt; pin `chunkSize`/`noncePrefix` via `opts` for deterministic
 * tests.
 */
export async function chunkedEncrypt(
  plaintext: Uint8Array,
  key: Uint8Array,
  opts: ChunkedEncryptOptions = {},
): Promise<ChunkedEncryptResult> {
  const chunkSize = opts.chunkSize ?? ATTACHMENT_CHUNK_SIZE;
  if (chunkSize <= 0) throw new Error('chunkSize must be > 0');
  const noncePrefix = opts.noncePrefix ?? (await generateNoncePrefix());
  if (noncePrefix.length !== NONCE_PREFIX_BYTES) {
    throw new Error(`noncePrefix must be ${NONCE_PREFIX_BYTES} bytes`);
  }

  const total = plaintext.length;
  const chunkCount = Math.ceil(total / chunkSize);
  const frames: Uint8Array[] = [];

  for (let i = 0; i < chunkCount; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, total);
    const slice = plaintext.subarray(start, end);
    const isFinal = i === chunkCount - 1;
    const { ciphertext } = await aeadEncrypt(
      slice,
      key,
      chunkAad(i, isFinal),
      chunkNonce(noncePrefix, i),
    );
    const header = new Uint8Array(FRAME_HEADER_BYTES);
    new DataView(header.buffer).setUint32(0, ciphertext.length);
    frames.push(header, ciphertext);
  }

  return {
    ciphertext: concatBytes(...frames),
    contentHash: await sha256(plaintext),
    byteSize: total,
    chunkSize,
    noncePrefix,
  };
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

/**
 * Decrypt a chunked ciphertext produced by {@link chunkedEncrypt}. Throws if any
 * chunk fails authentication (tamper / reorder / truncate) or if the optional
 * `contentHash` / `byteSize` checks do not match the reassembled plaintext.
 */
export async function chunkedDecrypt(
  ciphertext: Uint8Array,
  key: Uint8Array,
  params: ChunkedDecryptParams,
): Promise<Uint8Array> {
  if (params.noncePrefix.length !== NONCE_PREFIX_BYTES) {
    throw new Error(`noncePrefix must be ${NONCE_PREFIX_BYTES} bytes`);
  }

  const parts: Uint8Array[] = [];
  let offset = 0;
  let index = 0;

  while (offset < ciphertext.length) {
    if (offset + FRAME_HEADER_BYTES > ciphertext.length) {
      throw new Error('chunked ciphertext truncated mid-header');
    }
    const sealedLen = new DataView(
      ciphertext.buffer,
      ciphertext.byteOffset + offset,
      FRAME_HEADER_BYTES,
    ).getUint32(0);
    offset += FRAME_HEADER_BYTES;
    if (sealedLen < TAG_BYTES || offset + sealedLen > ciphertext.length) {
      throw new Error('chunked ciphertext frame length out of range');
    }
    const sealed = ciphertext.subarray(offset, offset + sealedLen);
    offset += sealedLen;
    const isFinal = offset >= ciphertext.length;
    parts.push(
      await aeadDecrypt(
        sealed,
        chunkNonce(params.noncePrefix, index),
        key,
        chunkAad(index, isFinal),
      ),
    );
    index += 1;
  }

  const plaintext = concatBytes(...parts);
  if (params.byteSize !== undefined && plaintext.length !== params.byteSize) {
    throw new Error('chunked plaintext length mismatch');
  }
  if (params.contentHash && !timingSafeEqual(await sha256(plaintext), params.contentHash)) {
    throw new Error('chunked plaintext hash mismatch');
  }
  return plaintext;
}
