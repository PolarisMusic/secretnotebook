import { bytesToHex, hmacSha256 } from '@secretnotebook/crypto';

import type { SqlExecutor } from '../../db/executor';

export interface CompletedPairing {
  readonly rootKey: Uint8Array;
  readonly selfPub: Uint8Array;
  readonly peerPub: Uint8Array;
}

export interface PersistedCouple {
  readonly coupleId: string;
}

/**
 * Persist a freshly paired couple row with status='awaiting_safeword'.
 *
 * The id is derived deterministically so both devices compute the same
 * value without an extra exchange:
 *   couple.id = HMAC-SHA256(root_key, partner_a_pub || partner_b_pub)
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
export async function persistCouple(
  exec: SqlExecutor,
  pairing: CompletedPairing,
  now: () => number = Date.now,
): Promise<PersistedCouple> {
  if (pairing.rootKey.length !== 32) throw new Error('rootKey must be 32 bytes');
  if (pairing.selfPub.length !== 32) throw new Error('selfPub must be 32 bytes');
  if (pairing.peerPub.length !== 32) throw new Error('peerPub must be 32 bytes');

  const [partnerA, partnerB] = canonicalOrder(pairing.selfPub, pairing.peerPub);
  const coupleId = await deriveCoupleId(pairing.rootKey, partnerA, partnerB);
  const pairedAt = Math.floor(now() / 1000);

  await exec.execute(
    `INSERT INTO couple (
       id, partner_a_pubkey, partner_b_pubkey,
       channel_root_key_wrapped, paired_at, status
     ) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
    [coupleId, partnerA, partnerB, pairing.rootKey, pairedAt, 'awaiting_safeword'],
  );

  return { coupleId };
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

async function deriveCoupleId(
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
