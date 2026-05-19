import { getSodium } from './sodium.js';

export interface AeadCiphertext {
  nonce: Uint8Array;
  ciphertext: Uint8Array;
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
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    additionalData,
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
  return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    ciphertext,
    additionalData,
    nonce,
    key,
  );
}
