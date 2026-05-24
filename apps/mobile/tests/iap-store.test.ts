import { describe, expect, it } from '@jest/globals';
import Database from 'better-sqlite3';

import { runMigrations } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import {
  cacheReceipt,
  getCachedEntitlement,
  requireCurrentEntitlement,
  type IapStoreDeps,
  type ValidatedReceipt,
} from '../src/features/iap/store';
import {
  buildReceiptWithExpiry,
  expiryEncodedValidator,
  fixedValidator,
  throwingValidator,
} from './helpers/iap-validators';
import { nodeExecutor } from './helpers/sqlite-executor';

const PRODUCT = 'sn.publish.monthly';
const FIXED_NOW = new Date('2026-05-23T10:00:00.000Z');
const FIXED_NOW_SEC = Math.floor(FIXED_NOW.getTime() / 1000);
const ONE_MONTH = 30 * 86_400;

async function freshExec(): Promise<ReturnType<typeof nodeExecutor>> {
  const db = new Database(':memory:');
  const exec = nodeExecutor(db);
  await runMigrations(exec, MIGRATIONS);
  return exec;
}

function depsWith(
  exec: ReturnType<typeof nodeExecutor>,
  validated: ValidatedReceipt,
): IapStoreDeps {
  return {
    exec,
    validator: fixedValidator(validated),
    now: () => FIXED_NOW,
  };
}

describe('IAP entitlement store', () => {
  describe('cacheReceipt', () => {
    it('validates the receipt and upserts the singleton row', async () => {
      const exec = await freshExec();
      const validated = { productId: PRODUCT, expiresAt: FIXED_NOW_SEC + ONE_MONTH };
      const receipt = new Uint8Array([1, 2, 3, 4]);

      const stored = await cacheReceipt(depsWith(exec, validated), receipt, 'ios');
      expect(stored).toEqual({
        productId: PRODUCT,
        expiresAt: validated.expiresAt,
        validatedAt: FIXED_NOW_SEC,
        platform: 'ios',
      });

      const fromDb = await getCachedEntitlement(exec);
      expect(fromDb).toEqual(stored);
    });

    it('overwrites the previous singleton on a fresh receipt', async () => {
      const exec = await freshExec();
      const v1 = { productId: PRODUCT, expiresAt: FIXED_NOW_SEC + 100 };
      const v2 = { productId: 'sn.publish.annual', expiresAt: FIXED_NOW_SEC + 1_000 };

      await cacheReceipt(depsWith(exec, v1), new Uint8Array([0xaa]), 'ios');
      await cacheReceipt(depsWith(exec, v2), new Uint8Array([0xbb]), 'android');

      const row = await getCachedEntitlement(exec);
      expect(row?.productId).toBe('sn.publish.annual');
      expect(row?.expiresAt).toBe(v2.expiresAt);
      expect(row?.platform).toBe('android');
    });

    it('leaves the local cache untouched when the validator throws', async () => {
      const exec = await freshExec();
      const goodDeps = depsWith(exec, { productId: PRODUCT, expiresAt: FIXED_NOW_SEC + 100 });
      await cacheReceipt(goodDeps, new Uint8Array([0xaa]), 'ios');
      const before = await getCachedEntitlement(exec);

      const badDeps: IapStoreDeps = {
        exec,
        validator: throwingValidator(new Error('tampered')),
        now: () => FIXED_NOW,
      };
      await expect(cacheReceipt(badDeps, new Uint8Array([0xcc, 0xdd]), 'ios')).rejects.toThrow(
        /tampered/,
      );

      const after = await getCachedEntitlement(exec);
      expect(after).toEqual(before);
    });
  });

  describe('getCachedEntitlement', () => {
    it('returns null on a fresh device', async () => {
      const exec = await freshExec();
      expect(await getCachedEntitlement(exec)).toBeNull();
    });
  });

  describe('requireCurrentEntitlement', () => {
    it('resolves with the cached row when expires_at is in the future', async () => {
      const exec = await freshExec();
      await cacheReceipt(
        depsWith(exec, { productId: PRODUCT, expiresAt: FIXED_NOW_SEC + 100 }),
        new Uint8Array([1]),
        'ios',
      );
      const e = await requireCurrentEntitlement(exec, () => FIXED_NOW);
      expect(e.productId).toBe(PRODUCT);
    });

    it('throws "no entitlement cached" on a fresh device', async () => {
      const exec = await freshExec();
      await expect(requireCurrentEntitlement(exec, () => FIXED_NOW)).rejects.toThrow(
        /no entitlement cached/,
      );
    });

    it('throws "subscription expired" when expires_at <= now', async () => {
      const exec = await freshExec();
      await cacheReceipt(
        depsWith(exec, { productId: PRODUCT, expiresAt: FIXED_NOW_SEC - 1 }),
        new Uint8Array([1]),
        'ios',
      );
      await expect(requireCurrentEntitlement(exec, () => FIXED_NOW)).rejects.toThrow(
        /subscription expired/,
      );
    });

    it('treats expires_at === now as expired (strict >, not >=)', async () => {
      // Border case: a receipt that expires exactly at the current
      // second is treated as expired so the gate fails closed.
      const exec = await freshExec();
      await cacheReceipt(
        depsWith(exec, { productId: PRODUCT, expiresAt: FIXED_NOW_SEC }),
        new Uint8Array([1]),
        'ios',
      );
      await expect(requireCurrentEntitlement(exec, () => FIXED_NOW)).rejects.toThrow(
        /subscription expired/,
      );
    });
  });

  describe('receipt-validation harness', () => {
    it('expiryEncodedValidator extracts the trailing 4-byte expiry from the receipt', async () => {
      const exec = await freshExec();
      const expiresAt = FIXED_NOW_SEC + 500;
      const receipt = buildReceiptWithExpiry(expiresAt);
      const deps: IapStoreDeps = {
        exec,
        validator: expiryEncodedValidator(PRODUCT),
        now: () => FIXED_NOW,
      };
      const stored = await cacheReceipt(deps, receipt, 'ios');
      expect(stored.expiresAt).toBe(expiresAt);
      expect(stored.productId).toBe(PRODUCT);
    });

    it('expiryEncodedValidator rejects receipts that are too short', async () => {
      const exec = await freshExec();
      const deps: IapStoreDeps = {
        exec,
        validator: expiryEncodedValidator(PRODUCT),
        now: () => FIXED_NOW,
      };
      await expect(cacheReceipt(deps, new Uint8Array([0x01, 0x02]), 'ios')).rejects.toThrow(
        /at least 4 bytes/,
      );
    });
  });
});
