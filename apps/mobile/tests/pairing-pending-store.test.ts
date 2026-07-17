import { describe, expect, it } from '@jest/globals';
import Database from 'better-sqlite3';

import { runMigrations } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import type { SqlExecutor } from '../src/db/executor';
import {
  clearPendingPairing,
  getPendingPairing,
  setPendingPairing,
} from '../src/features/pairing/pending-store';
import { nodeExecutor } from './helpers/sqlite-executor';

async function freshExec(): Promise<SqlExecutor> {
  const db = new Database(':memory:');
  const exec = nodeExecutor(db);
  await runMigrations(exec, MIGRATIONS);
  return exec;
}

const NOW = 1_800_000_000_000;

describe('pending pairing store', () => {
  it('returns null when nothing is stored', async () => {
    const exec = await freshExec();
    expect(await getPendingPairing(exec, NOW)).toBeNull();
  });

  it('round-trips a non-expired pending pairing', async () => {
    const exec = await freshExec();
    await setPendingPairing(exec, { code: 'k7qh92rt', deadline: NOW + 60_000 });
    expect(await getPendingPairing(exec, NOW)).toEqual({
      code: 'k7qh92rt',
      deadline: NOW + 60_000,
    });
  });

  it('drops (and clears) an expired pending pairing', async () => {
    const exec = await freshExec();
    await setPendingPairing(exec, { code: 'k7qh92rt', deadline: NOW - 1 });
    expect(await getPendingPairing(exec, NOW)).toBeNull();
    // The read cleared it, so a later read at an earlier clock still sees nothing.
    expect(await getPendingPairing(exec, NOW - 100_000)).toBeNull();
  });

  it('clearPendingPairing removes a live entry', async () => {
    const exec = await freshExec();
    await setPendingPairing(exec, { code: 'k7qh92rt', deadline: NOW + 60_000 });
    await clearPendingPairing(exec);
    expect(await getPendingPairing(exec, NOW)).toBeNull();
  });
});
