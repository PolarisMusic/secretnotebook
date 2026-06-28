import { describe, expect, it } from '@jest/globals';
import type { LedgerEntryAddOp } from '@secretnotebook/connection-protocol';
import Database from 'better-sqlite3';

import { runMigrations } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import {
  awardCouplePoints,
  countLedgerEntriesFor,
  listRecentLedgerEntries,
  sumConnectionPoints,
  type LedgerWriteDeps,
} from '../src/features/ledger/store';
import { nodeExecutor } from './helpers/sqlite-executor';

const FIXED_NOW = new Date('2026-05-21T08:00:00.000Z');
const FIXED_NOW_SEC = Math.floor(FIXED_NOW.getTime() / 1000);
const REF = '11111111-1111-4111-8111-111111111111';

interface Harness {
  deps: LedgerWriteDeps;
  enqueued: LedgerEntryAddOp[];
}

async function freshHarness(): Promise<Harness> {
  const db = new Database(':memory:');
  const exec = nodeExecutor(db);
  await runMigrations(exec, MIGRATIONS);
  const enqueued: LedgerEntryAddOp[] = [];
  const deps: LedgerWriteDeps = {
    exec,
    now: () => FIXED_NOW,
    enqueue: async (op) => {
      enqueued.push(op);
    },
  };
  return { deps, enqueued };
}

describe('ledger — awardCouplePoints (R7 revived writer)', () => {
  it('inserts a couple_points row and enqueues a ledger_entry.add op', async () => {
    const { deps, enqueued } = await freshHarness();
    await awardCouplePoints(deps, { delta: 50, reason: 'unlock_verified', refId: REF });

    expect(await sumConnectionPoints(deps.exec)).toBe(50);
    const recent = await listRecentLedgerEntries(deps.exec);
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({
      kind: 'couple_points',
      delta: 50,
      reason: 'unlock_verified',
      refId: REF,
      createdAt: FIXED_NOW_SEC,
    });

    expect(enqueued).toHaveLength(1);
    const op = enqueued[0];
    expect(op.kind).toBe('ledger_entry.add');
    expect(op.id).toBe(recent[0].id); // local row + op share the id
    expect(op.delta).toBe(50);
    expect(op.reason).toBe('unlock_verified');
    expect(op.refId).toBe(REF);
  });

  it('is idempotent on (reason, refId): a second call is a no-op', async () => {
    const { deps, enqueued } = await freshHarness();
    await awardCouplePoints(deps, { delta: 50, reason: 'unlock_verified', refId: REF });
    enqueued.length = 0;

    await awardCouplePoints(deps, { delta: 50, reason: 'unlock_verified', refId: REF });
    expect(enqueued).toHaveLength(0);
    expect(await sumConnectionPoints(deps.exec)).toBe(50);
    expect(await countLedgerEntriesFor(deps.exec, 'unlock_verified', REF)).toBe(1);
  });

  it('treats verify and reflection awards on the same attempt as distinct (different reason)', async () => {
    const { deps } = await freshHarness();
    await awardCouplePoints(deps, { delta: 50, reason: 'unlock_verified', refId: REF });
    await awardCouplePoints(deps, { delta: 50, reason: 'unlock_reflected', refId: REF });
    expect(await sumConnectionPoints(deps.exec)).toBe(100);
  });

  it('R7 race: a concurrent caller writing between the outer read and the txn body does not double-insert', async () => {
    const { deps, enqueued } = await freshHarness();
    const realTxn = deps.exec.transaction.bind(deps.exec);
    let raced = false;
    const racingExec = {
      ...deps.exec,
      transaction: async <T>(fn: () => Promise<T>): Promise<T> => {
        if (!raced) {
          raced = true;
          // Simulate the other device's award landing first.
          await deps.exec.execute(
            `INSERT INTO ledger_entry (id, kind, delta, reason, ref_id, created_at)
             VALUES (?, 'couple_points', ?, ?, ?, ?)`,
            ['22222222-2222-4222-8222-222222222222', 50, 'unlock_verified', REF, FIXED_NOW_SEC - 1],
          );
        }
        return realTxn(fn);
      },
    };
    await awardCouplePoints(
      { ...deps, exec: racingExec },
      {
        delta: 50,
        reason: 'unlock_verified',
        refId: REF,
      },
    );
    // Inner re-read short-circuits: no second row, no op.
    expect(await countLedgerEntriesFor(deps.exec, 'unlock_verified', REF)).toBe(1);
    expect(enqueued).toHaveLength(0);
  });
});
