import { bytesToHex, getSodium } from './sodium.js';

/**
 * SHA-256 of the input bytes, returned as a 32-byte Uint8Array. Backed by
 * libsodium's crypto_hash_sha256 so the same primitive works in Node tests
 * (sodium-native via createRequire) and on React Native (react-native-libsodium).
 */
export async function sha256(message: Uint8Array): Promise<Uint8Array> {
  const sodium = await getSodium();
  return sodium.crypto_hash_sha256(message);
}

export async function sha256Hex(message: Uint8Array): Promise<string> {
  return bytesToHex(await sha256(message));
}
