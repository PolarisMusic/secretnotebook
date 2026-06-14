import { bytesToHex, hmacSha256 } from '@secretnotebook/crypto';
import type { ConnectionSide } from '@secretnotebook/connection-protocol';

import type { SqlExecutor } from '../../db/executor';
import { initAndSaveRatchet } from '../connection-channel/ratchet-store';

export interface CompletedPairing {
  readonly rootKey: Uint8Array;
  readonly selfPub: Uint8Array;
  readonly peerPub: Uint8Array;
}

export interface PersistedConnection {
  readonly connectionId: string;
  /** Which side of the channel this device is. Stable across cold starts. */
  readonly selfSide: ConnectionSide;
}

/**
 * Persist a freshly paired connection row with status='paired'.
 *
 * The Safe Word is no longer an onboarding gate (it's being redesigned into
 * an optional roleplay term), so pairing lands directly in 'paired' and the
 * caller builds the SyncEngine immediately.
 *
 * The id is derived deterministically so both devices compute the same
 * value without an extra exchange:
 *   connection.id = HMAC-SHA256(root_key, partner_a_pub || partner_b_pub)
 *     truncated to 16 bytes (32 hex chars)
 * where partner_a is the lexicographically smaller of the two pubkeys.
 *
 * channel_root_key_wrapped is the raw 32-byte root_key. The "wrapped"
 * name is from the Phase 2 plan where it will be encrypted under
 * device_master + safeword — for Phase 1 the SQLCipher layer is the only
 * envelope. Recorded here so the column constraint (NOT NULL BLOB) is
 * already satisfied and the migration to wrapped storage in S2 is local
 * to this file.
 */
export async function persistConnection(
  exec: SqlExecutor,
  pairing: CompletedPairing,
  now: () => number = Date.now,
): Promise<PersistedConnection> {
  if (pairing.rootKey.length !== 32) throw new Error('rootKey must be 32 bytes');
  if (pairing.selfPub.length !== 32) throw new Error('selfPub must be 32 bytes');
  if (pairing.peerPub.length !== 32) throw new Error('peerPub must be 32 bytes');

  const [partnerA, partnerB] = canonicalOrder(pairing.selfPub, pairing.peerPub);
  const connectionId = await deriveConnectionId(pairing.rootKey, partnerA, partnerB);
  const pairedAt = Math.floor(now() / 1000);

  await exec.execute(
    `INSERT INTO connection (
       id, partner_a_pubkey, partner_b_pubkey,
       channel_root_key_wrapped, paired_at, status
     ) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
    [connectionId, partnerA, partnerB, pairing.rootKey, pairedAt, 'paired'],
  );

  // Seed the connection_ratchet row in the same logical step. Idempotent
  // through ON CONFLICT, so re-running persistConnection after a partial
  // failure picks up where it left off rather than blowing up.
  const { side } = await initAndSaveRatchet(
    exec,
    {
      connectionId,
      rootKey: pairing.rootKey,
      selfPub: pairing.selfPub,
      peerPub: pairing.peerPub,
    },
    now,
  );

  return { connectionId, selfSide: side };
}

function canonicalOrder(a: Uint8Array, b: Uint8Array): [Uint8Array, Uint8Array] {
  for (let i = 0; i < a.length && i < b.length; i++) {
    const av = a[i] as number;
    const bv = b[i] as number;
    if (av < bv) return [a, b];
    if (av > bv) return [b, a];
  }
  return a.length <= b.length ? [a, b] : [b, a];
}

async function deriveConnectionId(
  rootKey: Uint8Array,
  partnerA: Uint8Array,
  partnerB: Uint8Array,
): Promise<string> {
  const buf = new Uint8Array(partnerA.length + partnerB.length);
  buf.set(partnerA, 0);
  buf.set(partnerB, partnerA.length);
  const tag = await hmacSha256(rootKey, buf);
  // 16 bytes / 32 hex chars: 128 bits of identity is plenty when the
  // pubkeys themselves can't collide (X25519 is 256-bit).
  return bytesToHex(tag.subarray(0, 16));
}
