import { getSodium } from './sodium.js';
import { constantTimeEqual } from './hmac.js';

export const SAFEWORD_SALT_BYTES = 16;
export const SAFEWORD_VERIFIER_BYTES = 32;

export const SAFEWORD_OPSLIMIT = 3;
export const SAFEWORD_MEMLIMIT = 64 * 1024 * 1024;

export interface SafeWordParams {
  readonly opslimit: number;
  readonly memlimit: number;
}

export const DEFAULT_SAFEWORD_PARAMS: SafeWordParams = {
  opslimit: SAFEWORD_OPSLIMIT,
  memlimit: SAFEWORD_MEMLIMIT,
};

export async function generateSafeWordSalt(): Promise<Uint8Array> {
  const sodium = await getSodium();
  return sodium.randombytes_buf(SAFEWORD_SALT_BYTES);
}

export async function deriveSafeWordVerifier(
  safeword: string,
  salt: Uint8Array,
  params: SafeWordParams = DEFAULT_SAFEWORD_PARAMS,
): Promise<Uint8Array> {
  const sodium = await getSodium();
  if (safeword.length === 0) throw new Error('safeword must not be empty');
  if (salt.length !== SAFEWORD_SALT_BYTES) {
    throw new Error(`safeword salt must be ${SAFEWORD_SALT_BYTES} bytes`);
  }
  const normalized = safeword.normalize('NFKC');
  return sodium.crypto_pwhash(
    SAFEWORD_VERIFIER_BYTES,
    normalized,
    salt,
    params.opslimit,
    params.memlimit,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
}

export async function verifySafeWord(
  candidate: string,
  salt: Uint8Array,
  storedVerifier: Uint8Array,
  params: SafeWordParams = DEFAULT_SAFEWORD_PARAMS,
): Promise<boolean> {
  if (storedVerifier.length !== SAFEWORD_VERIFIER_BYTES) return false;
  const computed = await deriveSafeWordVerifier(candidate, salt, params);
  return constantTimeEqual(computed, storedVerifier);
}
