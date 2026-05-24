import type { ConnectionSide } from './types.js';

/**
 * Lexicographically compare two byte arrays (left-to-right, first
 * difference wins; shorter-prefix-with-shared-bytes is "smaller").
 * Returns -1 if `a < b`, +1 if `a > b`, 0 if equal.
 */
export function compareBytes(a: Uint8Array, b: Uint8Array): -1 | 0 | 1 {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] as number;
    const bv = b[i] as number;
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  if (a.length === b.length) return 0;
  return a.length < b.length ? -1 : 1;
}

/**
 * Decide which connection side I am, given my long-term pubkey and the
 * partner's. The convention matches `apps/mobile/src/features/pairing/
 * persistence.ts`: the lexicographically smaller pubkey is partner_a,
 * the larger is partner_b. Both partners arrive at the same answer
 * without an extra round trip, which is what makes the symmetric
 * ratchet chains line up across devices.
 */
export function deriveConnectionSide(args: {
  selfPub: Uint8Array;
  peerPub: Uint8Array;
}): ConnectionSide {
  if (compareBytes(args.selfPub, args.peerPub) === 0) {
    throw new Error('selfPub and peerPub are equal — pairing should have prevented this');
  }
  return compareBytes(args.selfPub, args.peerPub) < 0 ? 'a' : 'b';
}
