import { getSodium } from './sodium.js';

export async function hmacSha256(key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const sodium = await getSodium();
  const state = sodium.crypto_auth_hmacsha256_init(key);
  sodium.crypto_auth_hmacsha256_update(state, message);
  return sodium.crypto_auth_hmacsha256_final(state);
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
