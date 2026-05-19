import { getSodium } from '@secretnotebook/crypto';

import type { KeychainAdapter } from './keychain';

export const DEVICE_MASTER_BYTES = 32;

/**
 * Random-bytes source signature. Injected so the bootstrap function is
 * deterministic in tests (libsodium's randombytes_buf in production).
 */
export type RandomBytes = (n: number) => Uint8Array | Promise<Uint8Array>;

/**
 * On first launch generate a fresh 32-byte device_master and seal it behind
 * biometric authentication in the keychain. On subsequent launches return
 * the existing value (which triggers the biometric prompt). The caller is
 * responsible for surfacing UX around the prompt.
 */
export async function getOrCreateDeviceMaster(
  keychain: KeychainAdapter,
  randomBytes: RandomBytes = defaultRandomBytes,
): Promise<Uint8Array> {
  const existing = await keychain.loadDeviceMaster();
  if (existing) {
    if (existing.length !== DEVICE_MASTER_BYTES) {
      throw new Error(`stored device_master has wrong length: ${existing.length}`);
    }
    return existing;
  }
  const fresh = await Promise.resolve(randomBytes(DEVICE_MASTER_BYTES));
  if (fresh.length !== DEVICE_MASTER_BYTES) {
    throw new Error(`randomBytes returned wrong length: ${fresh.length}`);
  }
  await keychain.saveDeviceMaster(fresh);
  return fresh;
}

async function defaultRandomBytes(n: number): Promise<Uint8Array> {
  const sodium = await getSodium();
  return sodium.randombytes_buf(n);
}
