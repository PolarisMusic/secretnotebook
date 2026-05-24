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
 *  a big-endian unix-seconds expiry, returning the supplied
 *  productId. Lets a single test exercise both "current" and
 *  "expired" by constructing different receipt blobs without
 *  swapping validators. */
export function expiryEncodedValidator(productId: string): ReceiptValidator {
  return {
    validate: async (receipt: Uint8Array, _platform: IapPlatform): Promise<ValidatedReceipt> => {
      if (receipt.length < 4) {
        throw new Error('expiryEncodedValidator: receipt must be at least 4 bytes');
      }
      const off = receipt.length - 4;
      const expiresAt =
        ((receipt[off] as number) << 24) |
        ((receipt[off + 1] as number) << 16) |
        ((receipt[off + 2] as number) << 8) |
        (receipt[off + 3] as number);
      return { productId, expiresAt: expiresAt >>> 0 };
    },
  };
}

/** Build a receipt blob whose last 4 bytes encode the expiresAt
 *  value for the expiryEncodedValidator. Front-pads with a marker
 *  byte so receipts of different expiries don't collide on size. */
export function buildReceiptWithExpiry(expiresAt: number, marker = 0xa5): Uint8Array {
  const r = new Uint8Array(8);
  r[0] = marker;
  r[1] = 0x00;
  r[2] = 0x00;
  r[3] = 0x00;
  r[4] = (expiresAt >>> 24) & 0xff;
  r[5] = (expiresAt >>> 16) & 0xff;
  r[6] = (expiresAt >>> 8) & 0xff;
  r[7] = expiresAt & 0xff;
  return r;
}
