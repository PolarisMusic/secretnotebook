import type { SqlExecutor } from '../../db/executor';

export type IapPlatform = 'ios' | 'android';

/** What the validator returns after checking a receipt. The platform
 *  surfaces these two attributes either directly (StoreKit / Play
 *  Billing) or via the verify-receipt server response — both shapes
 *  reduce to product id + expiry in seconds. */
export interface ValidatedReceipt {
  productId: string;
  expiresAt: number;
}

/**
 * Strategy for turning platform-signed receipt bytes into a
 * `ValidatedReceipt`. Production wiring posts the receipt to a
 * server endpoint that talks to Apple's `verifyReceipt` (and
 * Google's Play Billing equivalent) so the validation key never
 * leaves our backend. Tests inject a stub; the harness in
 * `tests/helpers/iap-validators.ts` ships fixed / throwing /
 * expiring variants.
 *
 * The validator is the ONLY place the raw signed bytes are
 * cryptographically inspected; everything downstream of here
 * trusts the `ValidatedReceipt` result.
 */
export interface ReceiptValidator {
  validate(receipt: Uint8Array, platform: IapPlatform): Promise<ValidatedReceipt>;
}

export interface EntitlementRow {
  productId: string;
  expiresAt: number;
  validatedAt: number;
  platform: IapPlatform;
}

interface RawEntitlementRow {
  product_id: string;
  expires_at: number;
  validated_at: number;
  platform: IapPlatform;
}

export interface IapStoreDeps {
  readonly exec: SqlExecutor;
  readonly validator: ReceiptValidator;
  readonly now?: () => Date;
}

/**
 * Stable failure codes for the publish gate. The UI translates these
 * to user-facing copy; tests assert on the `code` field so a change to
 * the developer-facing `.message` text doesn't ripple through.
 *
 * `no-entitlement` — the device has never cached a successful receipt
 *   (or its cache was wiped). UI: "Subscribe to publish."
 * `expired`        — there is a cached receipt but its expires_at has
 *   passed. UI: "Your subscription has lapsed. Renew to publish."
 */
export type EntitlementErrorCode = 'no-entitlement' | 'expired';

export class EntitlementError extends Error {
  readonly code: EntitlementErrorCode;
  constructor(code: EntitlementErrorCode, message: string) {
    super(message);
    this.name = 'EntitlementError';
    this.code = code;
  }
}

function nowSec(now: (() => Date) | undefined): number {
  return Math.floor((now ?? (() => new Date()))().getTime() / 1000);
}

/**
 * Hand a freshly-purchased receipt to the validator, then upsert the
 * result into the singleton entitlement row. Throws if the validator
 * rejects the receipt — the local cache is unchanged in that case
 * (no partial write, no stale state reactivated).
 */
export async function cacheReceipt(
  deps: IapStoreDeps,
  receipt: Uint8Array,
  platform: IapPlatform,
): Promise<EntitlementRow> {
  const validated = await deps.validator.validate(receipt, platform);
  const validatedAt = nowSec(deps.now);
  await deps.exec.execute(
    `INSERT OR REPLACE INTO entitlement (
       id, product_id, expires_at, validated_at, receipt, platform
     ) VALUES (1, ?, ?, ?, ?, ?)`,
    [validated.productId, validated.expiresAt, validatedAt, receipt, platform],
  );
  return {
    productId: validated.productId,
    expiresAt: validated.expiresAt,
    validatedAt,
    platform,
  };
}

/** Singleton-or-null read. Returns the cached validated state
 *  without re-checking with the validator — the caller decides
 *  whether the `expires_at` is fresh enough for their purposes. */
export async function getCachedEntitlement(exec: SqlExecutor): Promise<EntitlementRow | null> {
  const rows = await exec.query<RawEntitlementRow>(
    `SELECT product_id, expires_at, validated_at, platform
       FROM entitlement
      WHERE id = 1`,
  );
  const r = rows[0];
  if (!r) return null;
  return {
    productId: r.product_id,
    expiresAt: r.expires_at,
    validatedAt: r.validated_at,
    platform: r.platform,
  };
}

/**
 * Publish-side gate: resolves when the cached entitlement is
 * present and not yet expired, throws with a stable error message
 * otherwise. The caller (publishNote) forwards the throw to the
 * UI which surfaces the paywall.
 */
export async function requireCurrentEntitlement(
  exec: SqlExecutor,
  now: () => Date = () => new Date(),
): Promise<EntitlementRow> {
  const cached = await getCachedEntitlement(exec);
  if (!cached) {
    throw new EntitlementError(
      'no-entitlement',
      'requireCurrentEntitlement: no entitlement cached',
    );
  }
  if (cached.expiresAt <= Math.floor(now().getTime() / 1000)) {
    throw new EntitlementError('expired', 'requireCurrentEntitlement: subscription expired');
  }
  return cached;
}
