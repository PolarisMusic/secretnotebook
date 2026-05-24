import { describe, expect, it } from '@jest/globals';
import {
  aeadDecrypt,
  aeadEncrypt,
  aeadKeyBytes,
  aeadNonceBytes,
  generateAeadNonce,
} from '../src/aead.js';
import { getSodium } from '../src/sodium.js';

describe('xchacha20-poly1305 aead', () => {
  it('round-trips plaintext with associated data', async () => {
    const sodium = await getSodium();
    const key = sodium.randombytes_buf(await aeadKeyBytes());
    const pt = new TextEncoder().encode('hello connection');
    const aad = new TextEncoder().encode('header-v1');

    const { nonce, ciphertext } = await aeadEncrypt(pt, key, aad);
    const decrypted = await aeadDecrypt(ciphertext, nonce, key, aad);

    expect(new TextDecoder().decode(decrypted)).toBe('hello connection');
  });

  it('round-trips with null associated data', async () => {
    const sodium = await getSodium();
    const key = sodium.randombytes_buf(await aeadKeyBytes());
    const pt = new TextEncoder().encode('no aad');

    const { nonce, ciphertext } = await aeadEncrypt(pt, key, null);
    const decrypted = await aeadDecrypt(ciphertext, nonce, key, null);
    expect(new TextDecoder().decode(decrypted)).toBe('no aad');
  });

  it('rejects decryption with wrong key', async () => {
    const sodium = await getSodium();
    const key = sodium.randombytes_buf(await aeadKeyBytes());
    const wrongKey = sodium.randombytes_buf(await aeadKeyBytes());
    const pt = new TextEncoder().encode('secret');

    const { nonce, ciphertext } = await aeadEncrypt(pt, key, null);
    await expect(aeadDecrypt(ciphertext, nonce, wrongKey, null)).rejects.toThrow();
  });

  it('rejects decryption with tampered ciphertext', async () => {
    const sodium = await getSodium();
    const key = sodium.randombytes_buf(await aeadKeyBytes());
    const pt = new TextEncoder().encode('secret');

    const { nonce, ciphertext } = await aeadEncrypt(pt, key, null);
    ciphertext[0] ^= 0x01;
    await expect(aeadDecrypt(ciphertext, nonce, key, null)).rejects.toThrow();
  });

  it('rejects decryption when associated data differs', async () => {
    const sodium = await getSodium();
    const key = sodium.randombytes_buf(await aeadKeyBytes());
    const pt = new TextEncoder().encode('hi');
    const aad = new TextEncoder().encode('aad-A');

    const { nonce, ciphertext } = await aeadEncrypt(pt, key, aad);
    await expect(
      aeadDecrypt(ciphertext, nonce, key, new TextEncoder().encode('aad-B')),
    ).rejects.toThrow();
  });

  it('accepts a caller-supplied nonce', async () => {
    const sodium = await getSodium();
    const key = sodium.randombytes_buf(await aeadKeyBytes());
    const customNonce = sodium.randombytes_buf(await aeadNonceBytes());
    const pt = new TextEncoder().encode('custom-nonce');

    const { nonce, ciphertext } = await aeadEncrypt(pt, key, null, customNonce);
    expect(nonce).toEqual(customNonce);
    expect(new TextDecoder().decode(await aeadDecrypt(ciphertext, nonce, key, null))).toBe(
      'custom-nonce',
    );
  });

  it('rejects bad key and nonce sizes', async () => {
    const pt = new Uint8Array(1);
    await expect(aeadEncrypt(pt, new Uint8Array(8), null)).rejects.toThrow(/key/);
    const validKey = new Uint8Array(await aeadKeyBytes());
    await expect(aeadEncrypt(pt, validKey, null, new Uint8Array(8))).rejects.toThrow(/nonce/);
  });

  it('exposes nonce-generation helper', async () => {
    const n = await generateAeadNonce();
    expect(n.length).toBe(await aeadNonceBytes());
  });
});
