import { concatBytes } from './sodium.js';
import { hmacSha256 } from './hmac.js';

const HASH_LEN = 32;

export async function hkdfSha256Extract(
  salt: Uint8Array | null,
  ikm: Uint8Array,
): Promise<Uint8Array> {
  const actualSalt = salt && salt.length > 0 ? salt : new Uint8Array(HASH_LEN);
  return hmacSha256(actualSalt, ikm);
}

export async function hkdfSha256Expand(
  prk: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  if (length <= 0) throw new Error('hkdf length must be > 0');
  if (length > 255 * HASH_LEN) throw new Error('hkdf length must be <= 255 * 32');

  const n = Math.ceil(length / HASH_LEN);
  const okm = new Uint8Array(n * HASH_LEN);
  let prev: Uint8Array = new Uint8Array(0);
  for (let i = 1; i <= n; i++) {
    const counter = new Uint8Array([i]);
    const t = await hmacSha256(prk, concatBytes(prev, info, counter));
    okm.set(t, (i - 1) * HASH_LEN);
    prev = t;
  }
  return okm.subarray(0, length);
}

export async function hkdfSha256(
  ikm: Uint8Array,
  salt: Uint8Array | null,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const prk = await hkdfSha256Extract(salt, ikm);
  return hkdfSha256Expand(prk, info, length);
}
