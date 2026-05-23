import { ed25519KeyPairFromSeed, hkdfSha256, type Ed25519KeyPair } from '@secretnotebook/crypto';

const DEVICE_SIGNING_SEED_INFO = new TextEncoder().encode('secretnotebook/device-signing/v1');
const SEED_BYTES = 32;

/**
 * Derive a stable Ed25519 keypair for signing API requests, by HKDFing a
 * 32-byte seed from the device_master and feeding it to libsodium's
 * seed_keypair. Same input → same keypair, so we don't need a separate
 * keychain entry — the keypair regenerates from device_master on every
 * cold start.
 *
 * Domain-separated via the `secretnotebook/device-signing/v1` info string
 * so the device_master can also produce the SQLCipher key, ratchet root,
 * etc. without cross-contamination.
 */
export async function deriveDeviceSigningKey(deviceMaster: Uint8Array): Promise<Ed25519KeyPair> {
  if (deviceMaster.length !== 32) {
    throw new Error('device_master must be 32 bytes');
  }
  const seed = await hkdfSha256(deviceMaster, null, DEVICE_SIGNING_SEED_INFO, SEED_BYTES);
  return ed25519KeyPairFromSeed(seed);
}
