import type { SqlExecutor } from '../../db/executor';
import {
  cacheReceipt,
  type EntitlementRow,
  type IapPlatform,
  type ReceiptValidator,
} from './store';

/**
 * Platform-shaped seam the boot pipeline calls to repopulate the
 * entitlement cache from whatever the OS-side store knows. Concrete
 * implementations wrap react-native-iap (or equivalent) — they:
 *
 *   - return the most recent purchase receipt for the publish
 *     subscription product, OR
 *   - return null if there is no active purchase / no signed-in
 *     store account / IAP not yet available
 *
 * The bridge is responsible for blocking until StoreKit/Play
 * Billing has settled enough to give a meaningful answer; boot will
 * wait on it.
 */
export interface ReceiptBridge {
  /** OS the bridge speaks for. */
  readonly platform: IapPlatform;
  /** Latest receipt bytes, or null if there's nothing to restore. */
  fetchLatestReceipt(): Promise<Uint8Array | null>;
}

export interface RestoreEntitlementDeps {
  readonly exec: SqlExecutor;
  readonly validator: ReceiptValidator;
  readonly bridge: ReceiptBridge | null;
  /** Optional clock — tests pin it; production defaults to `new Date()`. */
  readonly now?: () => Date;
}

export interface RestoreEntitlementResult {
  /** What ended up in the entitlement cache, or null if nothing was
   *  restored (no bridge configured, or the bridge had no receipt). */
  readonly cached: EntitlementRow | null;
  /** Surface-level reason — useful for boot diagnostics + Sentry. */
  readonly reason: 'cached' | 'no-bridge' | 'no-receipt';
}

/**
 * R6.2 boot-time entitlement seam. Without this, the entitlement
 * table is permanently empty on every device — and the R5 publish
 * gate's only outcome is `EntitlementError('no-entitlement')`. The
 * seam is documented as a no-op when `bridge == null` so the rest
 * of boot doesn't depend on the IAP integration landing first.
 *
 * Once a real ReceiptBridge implementation lands (react-native-iap
 * wrapper, server-side verifyReceipt fan-out, etc.), boot/run.ts
 * wires it in as a single line:
 *
 *   await restoreEntitlementOnBoot({
 *     exec, validator: productionValidator(),
 *     bridge: rnIapBridge(),
 *   });
 *
 * Validator throws are swallowed and surfaced as `cached: null,
 * reason: 'no-receipt'` so a tampered or invalid receipt at boot
 * cannot block the rest of the app from coming up — the publish
 * gate will refuse later, which is the right user-facing place to
 * notice and surface the paywall.
 */
export async function restoreEntitlementOnBoot(
  deps: RestoreEntitlementDeps,
): Promise<RestoreEntitlementResult> {
  if (!deps.bridge) {
    return { cached: null, reason: 'no-bridge' };
  }
  const receipt = await deps.bridge.fetchLatestReceipt();
  if (!receipt) {
    return { cached: null, reason: 'no-receipt' };
  }
  try {
    const cached = await cacheReceipt(
      { exec: deps.exec, validator: deps.validator, now: deps.now },
      receipt,
      deps.bridge.platform,
    );
    return { cached, reason: 'cached' };
  } catch {
    // Validator rejected the receipt (tampered, network failure,
    // expired-and-receipt-server-says-no). Don't crash boot — the
    // publish gate will refuse downstream and the UI can surface
    // the paywall there.
    return { cached: null, reason: 'no-receipt' };
  }
}
