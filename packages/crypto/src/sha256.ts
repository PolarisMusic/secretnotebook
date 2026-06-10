import { sha256 as nobleSha256 } from '@noble/hashes/sha256';

import { bytesToHex } from './sodium.js';

/**
 * SHA-256 of the input bytes, returned as a 32-byte Uint8Array.
 *
 * Backed by @noble/hashes (pure-JS, well-audited) rather than libsodium
 * because `react-native-libsodium` does not expose `crypto_hash_sha256`
 * to JSI — only `crypto_auth` (HMAC-SHA-512) and `crypto_generichash`
 * (BLAKE2b). Calling the missing function on device threw
 * "undefined is not a function" at boot during deriveSqlcipherKey.
 *
 * Output is byte-for-byte identical to libsodium's SHA-256, so this
 * change does not invalidate any persisted derived keys, signatures,
 * or test vectors.
 */
export async function sha256(message: Uint8Array): Promise<Uint8Array> {
  return nobleSha256(message);
}

export async function sha256Hex(message: Uint8Array): Promise<string> {
  return bytesToHex(await sha256(message));
}
