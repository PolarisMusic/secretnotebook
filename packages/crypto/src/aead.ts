import { bytesToBase64 } from './base64.js';
import { getSodium } from './sodium.js';

export interface AeadCiphertext {
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}

/**
 * Convert AAD bytes to a string the underlying libsodium binding will accept
 * on both platforms.
 *
 * Node's libsodium-wrappers takes `Uint8Array | string | null` AAD and would
 * happily accept the raw bytes. react-native-libsodium@1.7.0's JSI binding
 * only accepts a string and uses its UTF-8 bytes (`.utf8(runtime)`) as the
 * libsodium-level AAD — passing a Uint8Array throws
 * "input type not yet implemented".
 *
 * Base64 is pure ASCII, so UTF-8(base64) equals the base64 char bytes; the
 * libsodium-level AAD bytes are therefore identical on Node (passes the
 * string → encoded as UTF-8 internally) and on RN (passes the string → JSI
 * does .utf8 → same bytes). That makes the ciphertext portable across
 * platforms even though the AAD is encoded once per call here.
 */
async function aadToSodiumString(aad: Uint8Array | null): Promise<string> {
  if (aad == null) return '';
  return bytesToBase64(aad);
}

export async function aeadKeyBytes(): Promise<number> {
  const sodium = await getSodium();
  return sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES;
}

export async function aeadNonceBytes(): Promise<number> {
  const sodium = await getSodium();
  return sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES;
}

export async function generateAeadNonce(): Promise<Uint8Array> {
  const sodium = await getSodium();
  return sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
}

export async function aeadEncrypt(
  plaintext: Uint8Array,
  key: Uint8Array,
  additionalData: Uint8Array | null,
  nonce?: Uint8Array,
): Promise<AeadCiphertext> {
  const sodium = await getSodium();
  if (key.length !== sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES) {
    throw new Error(`aead key must be ${sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES} bytes`);
  }
  const n = nonce ?? sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  if (n.length !== sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES) {
    throw new Error(
      `aead nonce must be ${sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES} bytes`,
    );
  }
  const aad = await aadToSodiumString(additionalData);
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    aad,
    null,
    n,
    key,
  );
  return { nonce: n, ciphertext };
}

export async function aeadDecrypt(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  key: Uint8Array,
  additionalData: Uint8Array | null,
): Promise<Uint8Array> {
  const sodium = await getSodium();
  const aad = await aadToSodiumString(additionalData);
  return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ciphertext, aad, nonce, key);
}
