import { describe, expect, it } from '@jest/globals';
import Database from 'better-sqlite3';

import { runMigrations } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import type { SqlExecutor } from '../src/db/executor';
import {
  getPointsVisible,
  roleDefaultPointsVisible,
  setPointsVisible,
} from '../src/features/settings/points-visibility';
import { nodeExecutor } from './helpers/sqlite-executor';

async function freshExec(): Promise<SqlExecutor> {
  const db = new Database(':memory:');
  const exec = nodeExecutor(db);
  await runMigrations(exec, MIGRATIONS);
  return exec;
}

describe('points-visibility', () => {
  it('role default: hidden for feminine, shown otherwise', () => {
    expect(roleDefaultPointsVisible('masculine')).toBe(true);
    expect(roleDefaultPointsVisible('neutral')).toBe(true);
    expect(roleDefaultPointsVisible(null)).toBe(true);
    expect(roleDefaultPointsVisible('feminine')).toBe(false);
  });

  it('falls back to the role default when unset', async () => {
    const exec = await freshExec();
    expect(await getPointsVisible(exec, 'masculine')).toBe(true);
    expect(await getPointsVisible(exec, 'feminine')).toBe(false);
  });

  it('an explicit choice overrides the role default either way', async () => {
    const exec = await freshExec();
    // Feminine default is hidden; turning it on wins.
    await setPointsVisible(exec, true);
    expect(await getPointsVisible(exec, 'feminine')).toBe(true);
    // Masculine default is shown; turning it off wins.
    await setPointsVisible(exec, false);
    expect(await getPointsVisible(exec, 'masculine')).toBe(false);
  });
});
