import { getSodium } from './sodium.js';

/**
 * Standard base64 (with `+/` and `=` padding) encode/decode, backed by
 * libsodium's `to_base64` / `from_base64` so the same primitive works in
 * Node tests and on React Native without depending on the `Buffer`
 * global. Matches the regex in shared-types/SyncEnvelopeSchema.
 */
export async function bytesToBase64(bytes: Uint8Array): Promise<string> {
  const sodium = await getSodium();
  return sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);
}

export async function base64ToBytes(s: string): Promise<Uint8Array> {
  const sodium = await getSodium();
  return sodium.from_base64(s, sodium.base64_variants.ORIGINAL);
}
