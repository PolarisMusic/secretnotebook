import { describe, expect, it } from '@jest/globals';
import Database from 'better-sqlite3';

import { runMigrations } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import {
  DEV_GRANT_PRODUCT_ID,
  DEV_GRANT_SENTINEL,
  devGrantBridge,
  devGrantValidator,
  productionValidator,
} from '../src/features/iap/dev-grant';
import { restoreEntitlementOnBoot } from '../src/features/iap/restore';
import { requireCurrentEntitlement } from '../src/features/iap/store';
import { nodeExecutor } from './helpers/sqlite-executor';

describe('devGrantValidator', () => {
  it('accepts exactly the dev sentinel and stamps the dev product id', async () => {
    const v = devGrantValidator();
    const result = await v.validate(new Uint8Array(DEV_GRANT_SENTINEL), 'ios');
    expect(result.productId).toBe(DEV_GRANT_PRODUCT_ID);
    expect(result.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000) + 86400);
  });

  it('rejects any receipt that is not the sentinel', async () => {
    const v = devGrantValidator();
    const tampered = new Uint8Array(DEV_GRANT_SENTINEL);
    tampered[0] ^= 0x01;
    await expect(v.validate(tampered, 'ios')).rejects.toThrow(/does not match/);
    await expect(v.validate(new Uint8Array([0x00]), 'android')).rejects.toThrow(/does not match/);
  });
});

describe('devGrantBridge', () => {
  it('returns the sentinel as the latest receipt', async () => {
    const b = devGrantBridge('android');
    expect(b.platform).toBe('android');
    const r = await b.fetchLatestReceipt();
    expect(r).toEqual(new Uint8Array(DEV_GRANT_SENTINEL));
  });
});

describe('productionValidator', () => {
  it('throws a recognisable error so unwired boots fail loud', async () => {
    const v = productionValidator();
    await expect(v.validate(new Uint8Array([1, 2, 3]), 'ios')).rejects.toThrow(
      /real IAP not wired/,
    );
  });
});

describe('boot integration with dev-grant', () => {
  it('caches an entitlement that satisfies requireCurrentEntitlement', async () => {
    const db = new Database(':memory:');
    const exec = nodeExecutor(db);
    await runMigrations(exec, MIGRATIONS);

    const result = await restoreEntitlementOnBoot({
      exec,
      validator: devGrantValidator(),
      bridge: devGrantBridge('ios'),
    });
    expect(result.reason).toBe('cached');
    expect(result.cached?.productId).toBe(DEV_GRANT_PRODUCT_ID);

    const current = await requireCurrentEntitlement(exec);
    expect(current.productId).toBe(DEV_GRANT_PRODUCT_ID);
  });
});
