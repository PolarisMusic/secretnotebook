import type { IapPlatform, ReceiptValidator, ValidatedReceipt } from '../../src/features/iap/store';

/**
 * Receipt-validation harness. The production validator talks to a
 * verify-receipt server endpoint; for tests we substitute one of
 * these stubs to exercise the publish gate without a network.
 *
 * The contract is intentionally narrow: a ReceiptValidator either
 * returns a ValidatedReceipt or throws. Tests pick the variant that
 * matches the scenario they're exercising.
 */

/** Always returns the same canned ValidatedReceipt. The
 *  most common test shape: "assume the platform said this." */
export function fixedValidator(canned: ValidatedReceipt): ReceiptValidator {
  return {
    validate: async () => canned,
  };
}

/** Always throws with the given error. Useful for the
 *  "validator says no" path — tampered receipt, network
 *  failure, etc. */
export function throwingValidator(err: Error): ReceiptValidator {
  return {
    validate: async () => {
      throw err;
    },
  };
}

/** Validator that interprets the LAST 4 bytes of the receipt as
 *  a big-endian unsigned 32-bit unix-seconds expiry. Uses DataView
 *  for the decode so the result is correctly unsigned for any byte
 *  whose top bit is set (≥ 0x80) — the previous hand-rolled
 *  `(b<<24)|...` chain produced a signed int32 and relied on a
 *  trailing `>>> 0` to coerce back. DataView removes that
 *  fragility. */
export function expiryEncodedValidator(productId: string): ReceiptValidator {
  return {
    validate: async (receipt: Uint8Array, _platform: IapPlatform): Promise<ValidatedReceipt> => {
      if (receipt.length < 4) {
        throw new Error('expiryEncodedValidator: receipt must be at least 4 bytes');
      }
      const view = new DataView(receipt.buffer, receipt.byteOffset, receipt.byteLength);
      const expiresAt = view.getUint32(receipt.length - 4, false); // big-endian, unsigned
      return { productId, expiresAt };
    },
  };
}

/** Build a receipt blob whose last 4 bytes encode the expiresAt
 *  value for the expiryEncodedValidator. Uses DataView.setUint32
 *  so encode and decode share the same primitive — the round-trip
 *  is exact for any expiresAt in [0, 2^32-1] (year ~2106).
 *  Front-pads with a marker byte so receipts of different
 *  expiries don't collide on size. */
export function buildReceiptWithExpiry(expiresAt: number, marker = 0xa5): Uint8Array {
  const r = new Uint8Array(8);
  r[0] = marker;
  // r[1..3] left zero as padding.
  const view = new DataView(r.buffer, r.byteOffset, r.byteLength);
  view.setUint32(4, expiresAt, false); // big-endian, unsigned
  return r;
}
