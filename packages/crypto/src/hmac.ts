import { hmac as nobleHmac } from '@noble/hashes/hmac';
import { sha256 as nobleSha256 } from '@noble/hashes/sha256';

/**
 * HMAC-SHA-256.
 *
 * Backed by @noble/hashes (pure-JS, well-audited) rather than libsodium
 * because `react-native-libsodium` does not expose the
 * `crypto_auth_hmacsha256_*` family — only `crypto_auth` (which is
 * HMAC-SHA-512, not SHA-256). The streaming
 * `init/update/final` calls used previously evaluated to `undefined`
 * on iOS and threw "undefined is not a function" at boot during
 * deriveSqlcipherKey → hkdfSha256 → hmacSha256.
 *
 * Output is byte-for-byte identical to libsodium's HMAC-SHA-256, so
 * this change does not invalidate any persisted ratchet state, derived
 * keys, or test vectors.
 */
export async function hmacSha256(key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  return nobleHmac(nobleSha256, key, message);
}

export async function hmacSha256Verify(
  key: Uint8Array,
  message: Uint8Array,
  tag: Uint8Array,
): Promise<boolean> {
  const computed = await hmacSha256(key, message);
  return constantTimeEqual(computed, tag);
}

export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= (a[i] as number) ^ (b[i] as number);
  }
  return diff === 0;
}
