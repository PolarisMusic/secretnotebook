import { bytesToHex, concatBytes, hmacSha256 } from '@secretnotebook/crypto';

const BLINDED_ID_INFO = new TextEncoder().encode('secretnotebook/blinded-recipient/v1');

export interface BlindedRecipientArgs {
  /** 32-byte couple root key derived during pairing. Never leaves either device. */
  readonly coupleRoot: Uint8Array;
  /** 32-byte Ed25519 / X25519 pubkey of the recipient partner. */
  readonly recipientPubkey: Uint8Array;
  /** UTC date the envelope is being addressed for. Defaults to today. */
  readonly date?: Date;
}

/**
 * UTC YYYY-MM-DD for a Date. Pulled out so tests can pin the bucket
 * without monkey-patching the clock.
 */
export function utcDayBucket(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Compute the daily-rotated blinded recipient ID for the couple channel.
 *
 *   blinded_id = HMAC-SHA256(couple_root,
 *                            "secretnotebook/blinded-recipient/v1"
 *                              || recipient_pubkey
 *                              || day_utc_yyyy_mm_dd)
 *
 * The day component rotates the value so an observer who watched the
 * relay for weeks can't link envelopes across days. Domain-separated by
 * a versioned info string so the couple root can be reused for other
 * derivations (ratchet root, etc.) without leaking material across
 * domains.
 *
 * Returned as a 32-byte Uint8Array; pair with `bytesToHex` for the
 * shared-types wire-format requirement of 64 lowercase hex chars.
 */
export async function computeBlindedRecipientId(args: BlindedRecipientArgs): Promise<Uint8Array> {
  if (args.coupleRoot.length !== 32) {
    throw new Error('coupleRoot must be 32 bytes');
  }
  if (args.recipientPubkey.length !== 32) {
    throw new Error('recipientPubkey must be 32 bytes');
  }
  const day = utcDayBucket(args.date ?? new Date());
  const message = concatBytes(BLINDED_ID_INFO, args.recipientPubkey, new TextEncoder().encode(day));
  return hmacSha256(args.coupleRoot, message);
}

export async function computeBlindedRecipientIdHex(args: BlindedRecipientArgs): Promise<string> {
  return bytesToHex(await computeBlindedRecipientId(args));
}
