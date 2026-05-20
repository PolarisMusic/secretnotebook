import { hkdfSha256 } from '@secretnotebook/crypto';

export const SQLCIPHER_KEY_BYTES = 32;

const SQLCIPHER_KEY_INFO = new TextEncoder().encode('secretnotebook/sqlcipher/v1');

/**
 * Derive the SQLCipher master key from the device_master via HKDF-SHA-256.
 * Domain-separated via the `secretnotebook/sqlcipher/v1` info string so the
 * device_master can be reused for other purposes (ratchet root, MMKV key)
 * without leaking material between domains.
 */
export async function deriveSqlcipherKey(deviceMaster: Uint8Array): Promise<Uint8Array> {
  if (deviceMaster.length !== 32) {
    throw new Error('device_master must be 32 bytes');
  }
  return hkdfSha256(deviceMaster, null, SQLCIPHER_KEY_INFO, SQLCIPHER_KEY_BYTES);
}
