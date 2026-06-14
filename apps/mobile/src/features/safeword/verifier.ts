import {
  constantTimeEqual,
  deriveSafeWordVerifier as argon2idVerifier,
  DEFAULT_SAFEWORD_PARAMS,
  hkdfSha256,
  type SafeWordParams,
  SAFEWORD_SALT_BYTES,
  SAFEWORD_VERIFIER_BYTES,
} from '@secretnotebook/crypto';

import type { SqlExecutor } from '../../db/executor';

/**
 * Safe Word verifier — Phase 1 implementation.
 *
 * Both partners share a 32-byte connection root_key from the S1 pairing
 * handshake. The salt for Argon2id is derived deterministically from the
 * root_key so it does not need to be exchanged separately:
 *   safeword_salt = HKDF-SHA-256(root_key,
 *                                info = "secretnotebook/safeword-salt/v1",
 *                                L    = 16)
 *
 * The verifier is then Argon2id(safeword, safeword_salt) at the documented
 * mobile parameters (m=64 MB, t=3, p=1; libsodium fixes p=1).
 *
 * Because both sides start from the same root_key and the same Safe Word,
 * both derive byte-identical verifiers locally. There is no on-wire
 * exchange of the verifier itself in Phase 1 — typo mismatches surface
 * the next time either device verifies and the connection can re-pair.
 *
 * On successful local derivation the connection row is updated atomically:
 *   safeword_verifier := verifier
 *   safeword_salt     := salt
 *   status            := 'paired'
 */

const SAFEWORD_SALT_INFO = new TextEncoder().encode('secretnotebook/safeword-salt/v1');

export interface SafeWordMaterial {
  readonly salt: Uint8Array;
  readonly verifier: Uint8Array;
}

export async function deriveSafeWordSalt(rootKey: Uint8Array): Promise<Uint8Array> {
  if (rootKey.length !== 32) throw new Error('rootKey must be 32 bytes');
  return hkdfSha256(rootKey, null, SAFEWORD_SALT_INFO, SAFEWORD_SALT_BYTES);
}

export async function deriveConnectionSafeWord(
  rootKey: Uint8Array,
  safeword: string,
  params: SafeWordParams = DEFAULT_SAFEWORD_PARAMS,
): Promise<SafeWordMaterial> {
  const salt = await deriveSafeWordSalt(rootKey);
  const verifier = await argon2idVerifier(safeword, salt, params);
  return { salt, verifier };
}

export async function saveSafeWord(
  exec: SqlExecutor,
  connectionId: string,
  material: SafeWordMaterial,
): Promise<void> {
  if (material.salt.length !== SAFEWORD_SALT_BYTES) {
    throw new Error(`salt must be ${SAFEWORD_SALT_BYTES} bytes`);
  }
  if (material.verifier.length !== SAFEWORD_VERIFIER_BYTES) {
    throw new Error(`verifier must be ${SAFEWORD_VERIFIER_BYTES} bytes`);
  }
  // The Safe Word is no longer an onboarding gate, so saving it does not
  // change the connection status (pairing already lands in 'paired'). It
  // simply persists the verifier/salt for the optional roleplay-term flow.
  await exec.execute(
    `UPDATE connection
        SET safeword_verifier = ?,
            safeword_salt     = ?
      WHERE id = ?`,
    [material.verifier, material.salt, connectionId],
  );
}

interface StoredConnection {
  safeword_verifier: Uint8Array | null;
  safeword_salt: Uint8Array | null;
  status: string;
}

/**
 * Verify a candidate Safe Word against the stored row. Re-derives Argon2id
 * with the stored salt and constant-time-compares. Returns false on any
 * shape error (connection missing, row not yet finalised, verifier corrupt)
 * — the caller should treat any false as a generic "wrong word" so the
 * lockout policy applies uniformly.
 */
export async function verifyConnectionSafeWord(
  exec: SqlExecutor,
  connectionId: string,
  candidate: string,
  params: SafeWordParams = DEFAULT_SAFEWORD_PARAMS,
): Promise<boolean> {
  if (candidate.length === 0) return false;
  const rows = await exec.query<StoredConnection>(
    `SELECT safeword_verifier, safeword_salt, status FROM connection WHERE id = ?`,
    [connectionId],
  );
  const row = rows[0];
  if (!row || row.status !== 'paired') return false;
  const stored = toBytes(row.safeword_verifier);
  const salt = toBytes(row.safeword_salt);
  if (!stored || !salt) return false;
  if (stored.length !== SAFEWORD_VERIFIER_BYTES || salt.length !== SAFEWORD_SALT_BYTES) {
    return false;
  }
  const candidateVerifier = await argon2idVerifier(candidate, salt, params);
  return constantTimeEqual(candidateVerifier, stored);
}

function toBytes(v: Uint8Array | null): Uint8Array | null {
  if (v == null) return null;
  if (v instanceof Uint8Array) return v;
  // better-sqlite3 returns Buffer, op-sqlite returns Uint8Array; both already
  // satisfy the instanceof check above, but defensively coerce anything else.
  return new Uint8Array(v);
}
