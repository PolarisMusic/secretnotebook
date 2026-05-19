import { getSodium } from './sodium.js';

export interface X25519KeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export async function generateX25519KeyPair(): Promise<X25519KeyPair> {
  const sodium = await getSodium();
  const kp = sodium.crypto_kx_keypair();
  return { publicKey: kp.publicKey, privateKey: kp.privateKey };
}

export async function x25519PublicKey(privateKey: Uint8Array): Promise<Uint8Array> {
  const sodium = await getSodium();
  if (privateKey.length !== sodium.crypto_scalarmult_SCALARBYTES) {
    throw new Error(`x25519 private key must be ${sodium.crypto_scalarmult_SCALARBYTES} bytes`);
  }
  return sodium.crypto_scalarmult_base(privateKey);
}

export async function x25519DH(
  privateKey: Uint8Array,
  peerPublicKey: Uint8Array,
): Promise<Uint8Array> {
  const sodium = await getSodium();
  if (privateKey.length !== sodium.crypto_scalarmult_SCALARBYTES) {
    throw new Error(`x25519 private key must be ${sodium.crypto_scalarmult_SCALARBYTES} bytes`);
  }
  if (peerPublicKey.length !== sodium.crypto_scalarmult_BYTES) {
    throw new Error(`x25519 public key must be ${sodium.crypto_scalarmult_BYTES} bytes`);
  }
  return sodium.crypto_scalarmult(privateKey, peerPublicKey);
}
