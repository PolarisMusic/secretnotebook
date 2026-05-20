import { describe, expect, it } from '@jest/globals';
import Database from 'better-sqlite3';

import { runMigrations } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import { persistCouple } from '../src/features/pairing/persistence';
import { loadActiveCouple } from '../src/features/boot/couple-load';
import { nodeExecutor } from './helpers/sqlite-executor';

async function freshDb() {
  const db = new Database(':memory:');
  const exec = nodeExecutor(db);
  await runMigrations(exec, MIGRATIONS);
  return { db, exec };
}

describe('loadActiveCouple', () => {
  it('returns null on a fresh database (no couple yet)', async () => {
    const { exec } = await freshDb();
    expect(await loadActiveCouple(exec)).toBeNull();
  });

  it('returns the persisted couple row with its status', async () => {
    const { exec } = await freshDb();
    const rootKey = new Uint8Array(32).fill(0xaa);
    const selfPub = new Uint8Array(32).fill(0x01);
    const peerPub = new Uint8Array(32).fill(0x02);
    const { coupleId } = await persistCouple(exec, { rootKey, selfPub, peerPub });

    const active = await loadActiveCouple(exec);
    expect(active).not.toBeNull();
    expect(active?.coupleId).toBe(coupleId);
    expect(active?.status).toBe('awaiting_safeword');
  });

  it('ignores a row with an unexpected status (defensive against corruption)', async () => {
    // CHECK constraints enforce known statuses at INSERT/UPDATE time, so a
    // bogus value can only arrive via raw query results. Feed the loader a
    // fake executor that yields one to confirm it returns null instead of
    // crashing.
    const fakeExec = {
      executeBatch: async () => undefined,
      execute: async () => undefined,
      query: async () => [{ id: 'cid', status: 'gibberish' }] as never,
      transaction: async <T>(fn: () => Promise<T>) => fn(),
    };
    expect(await loadActiveCouple(fakeExec)).toBeNull();
  });
});
