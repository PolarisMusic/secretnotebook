import type { ReceiptBridge } from './restore';
import type { IapPlatform, ReceiptValidator, ValidatedReceipt } from './store';

/**
 * Dev-only IAP shim. Lets internal testers exercise the publish path
 * without a sandbox IAP purchase by handing the validator a known
 * sentinel receipt and having it accept exactly that sentinel.
 *
 * Gated at boot by `DEV_GRANT_ENTITLEMENT` (features/iap/config.ts).
 * Production builds must boot with the real `ReceiptBridge` /
 * `ReceiptValidator` pair so a tampered or replayed sentinel cannot
 * unlock publishing in a customer-facing build.
 *
 * The module deliberately avoids importing `react-native` so it can
 * be exercised in the Node-side Jest suite without a RN runtime.
 * Callers that need OS-aware platform tagging pass it explicitly
 * (boot/run.ts reads `Platform.OS` once and forwards).
 */

/** 16-byte sentinel. Anything but this exact byte sequence is
 *  rejected by `devGrantValidator`, so the dev path can't be
 *  accidentally satisfied by a real receipt. */
export const DEV_GRANT_SENTINEL: Uint8Array = new Uint8Array([
  0xde, 0xad, 0xbe, 0xef, 0xde, 0xad, 0xbe, 0xef, 0xde, 0xad, 0xbe, 0xef, 0xde, 0xad, 0xbe, 0xef,
]);

/** Product id stamped on the validated row. Distinct from any real
 *  store product so post-hoc inspection of an entitlement row makes
 *  it obvious which path populated it. */
export const DEV_GRANT_PRODUCT_ID = 'sn.publish.dev-grant';

/** Wall-clock seconds the dev grant is good for. One year mirrors
 *  the real subscription cadence and saves testers from
 *  re-validating mid-session. */
const DEV_GRANT_TTL_SECONDS = 365 * 86400;

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Returns a `ReceiptBridge` whose `fetchLatestReceipt()` always
 *  returns the sentinel. `platform` defaults to `'ios'` — the boot
 *  wiring (which knows the real OS) passes it explicitly. */
export function devGrantBridge(platform: IapPlatform = 'ios'): ReceiptBridge {
  return {
    platform,
    fetchLatestReceipt: async () => new Uint8Array(DEV_GRANT_SENTINEL),
  };
}

/** Validator paired with `devGrantBridge`. Accepts only the exact
 *  sentinel — any other byte sequence throws so this validator can
 *  never accidentally bless a real (or forged) receipt. */
export function devGrantValidator(): ReceiptValidator {
  return {
    validate: async (receipt: Uint8Array): Promise<ValidatedReceipt> => {
      if (!sameBytes(receipt, DEV_GRANT_SENTINEL)) {
        throw new Error('devGrantValidator: receipt does not match dev sentinel');
      }
      return {
        productId: DEV_GRANT_PRODUCT_ID,
        expiresAt: nowSec() + DEV_GRANT_TTL_SECONDS,
      };
    },
  };
}

/** Production seam — throws until the real react-native-iap +
 *  server-verify pipeline lands. Calling this means boot saw
 *  `DEV_GRANT_ENTITLEMENT=0` and is asking for the real validator;
 *  having it throw makes the unwired state loud rather than silent. */
export function productionValidator(): ReceiptValidator {
  return {
    validate: async () => {
      throw new Error(
        'productionValidator: real IAP not wired yet — ' +
          'rebuild with EXPO_PUBLIC_DEV_GRANT_ENTITLEMENT=1 for tester builds',
      );
    },
  };
}
