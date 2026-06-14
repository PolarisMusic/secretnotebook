import { describe, expect, it } from '@jest/globals';
import Database from 'better-sqlite3';

import { runMigrations } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import { getAppSetting, setAppSetting } from '../src/features/settings/store';
import { nodeExecutor } from './helpers/sqlite-executor';

async function freshDb() {
  const db = new Database(':memory:');
  const exec = nodeExecutor(db);
  await runMigrations(exec, MIGRATIONS);
  return { exec };
}

describe('app settings store', () => {
  it('returns null for an unset key', async () => {
    const { exec } = await freshDb();
    expect(await getAppSetting(exec, 'intro_seen')).toBeNull();
  });

  it('persists and reads back a value', async () => {
    const { exec } = await freshDb();
    await setAppSetting(exec, 'intro_seen', '1');
    expect(await getAppSetting(exec, 'intro_seen')).toBe('1');
  });

  it('upserts (last write wins) on the same key', async () => {
    const { exec } = await freshDb();
    await setAppSetting(exec, 'k', 'a');
    await setAppSetting(exec, 'k', 'b');
    expect(await getAppSetting(exec, 'k')).toBe('b');
  });
});
