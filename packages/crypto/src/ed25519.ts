import { getSodium } from './sodium.js';

export interface Ed25519KeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export async function generateEd25519KeyPair(): Promise<Ed25519KeyPair> {
  const sodium = await getSodium();
  const kp = sodium.crypto_sign_keypair();
  return { publicKey: kp.publicKey, privateKey: kp.privateKey };
}

export async function ed25519KeyPairFromSeed(seed: Uint8Array): Promise<Ed25519KeyPair> {
  const sodium = await getSodium();
  if (seed.length !== sodium.crypto_sign_SEEDBYTES) {
    throw new Error(`ed25519 seed must be ${sodium.crypto_sign_SEEDBYTES} bytes`);
  }
  const kp = sodium.crypto_sign_seed_keypair(seed);
  return { publicKey: kp.publicKey, privateKey: kp.privateKey };
}

export async function ed25519Sign(
  message: Uint8Array,
  privateKey: Uint8Array,
): Promise<Uint8Array> {
  const sodium = await getSodium();
  return sodium.crypto_sign_detached(message, privateKey);
}

export async function ed25519Verify(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
): Promise<boolean> {
  const sodium = await getSodium();
  try {
    return sodium.crypto_sign_verify_detached(signature, message, publicKey);
  } catch {
    return false;
  }
}
