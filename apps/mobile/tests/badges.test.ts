import { describe, expect, it } from '@jest/globals';
import Database from 'better-sqlite3';

import { runMigrations } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import type { SqlExecutor } from '../src/db/executor';
import {
  BADGE_MILESTONES,
  collectNewlyEarnedBadges,
  earnedBadges,
  highestBadge,
  nextBadge,
} from '../src/features/ledger/badges';
import { nodeExecutor } from './helpers/sqlite-executor';

async function freshExec(): Promise<SqlExecutor> {
  const db = new Database(':memory:');
  const exec = nodeExecutor(db);
  await runMigrations(exec, MIGRATIONS);
  return exec;
}

describe('badge milestones', () => {
  it('is sorted ascending and reaches at least a million', () => {
    const thresholds = BADGE_MILESTONES.map((b) => b.threshold);
    expect(thresholds).toEqual([...thresholds].sort((a, b) => a - b));
    expect(Math.max(...thresholds)).toBeGreaterThanOrEqual(1_000_000);
  });

  it('earnedBadges returns everything at or below the total', () => {
    expect(earnedBadges(0)).toHaveLength(0);
    expect(earnedBadges(99)).toHaveLength(0);
    expect(earnedBadges(100).map((b) => b.name)).toEqual(['First Spark']);
    expect(earnedBadges(1_500).map((b) => b.threshold)).toEqual([100, 500, 1_000]);
    expect(earnedBadges(10_000_000)).toHaveLength(BADGE_MILESTONES.length);
  });

  it('nextBadge points at the first unearned milestone (null when maxed)', () => {
    expect(nextBadge(0)?.threshold).toBe(100);
    expect(nextBadge(100)?.threshold).toBe(500);
    expect(nextBadge(999)?.threshold).toBe(1_000);
    expect(nextBadge(10_000_000)).toBeNull();
  });

  it('highestBadge returns the top earned, or null below the first', () => {
    expect(highestBadge(50)).toBeNull();
    expect(highestBadge(2_500)?.name).toBe('Steady Flame');
  });
});

describe('collectNewlyEarnedBadges', () => {
  it('reports each milestone once, then nothing until the next is crossed', async () => {
    const exec = await freshExec();
    // First check at 1,200 earns 100/500/1000 at once.
    const first = await collectNewlyEarnedBadges(exec, 1_200);
    expect(first.map((b) => b.threshold)).toEqual([100, 500, 1_000]);
    // Same total again → nothing new.
    expect(await collectNewlyEarnedBadges(exec, 1_200)).toHaveLength(0);
    // Cross the next threshold → just that one.
    const next = await collectNewlyEarnedBadges(exec, 2_000);
    expect(next.map((b) => b.threshold)).toEqual([2_000]);
  });

  it('reports nothing below the first threshold', async () => {
    const exec = await freshExec();
    expect(await collectNewlyEarnedBadges(exec, 99)).toHaveLength(0);
  });
});
