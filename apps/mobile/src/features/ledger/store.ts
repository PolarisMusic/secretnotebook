import type { LedgerEntryAddOp } from '@secretnotebook/connection-protocol';

import type { SqlExecutor } from '../../db/executor';
import { randomUuidV4 } from '../connection-channel/uuid';

export interface LedgerEntry {
  id: string;
  kind: 'couple_points';
  delta: number;
  reason: string;
  refId: string | null;
  createdAt: number;
}

interface RawLedgerRow {
  id: string;
  kind: string;
  delta: number;
  reason: string;
  ref_id: string | null;
  created_at: number;
}

function rowOf(r: RawLedgerRow): LedgerEntry {
  return {
    id: r.id,
    kind: r.kind as 'couple_points',
    delta: r.delta,
    reason: r.reason,
    refId: r.ref_id,
    createdAt: r.created_at,
  };
}

/** Phase-1 Connection Level. Derived view — just `SUM(delta)`. */
export async function sumConnectionPoints(exec: SqlExecutor): Promise<number> {
  const rows = await exec.query<{ total: number }>(
    `SELECT COALESCE(SUM(delta), 0) AS total
       FROM ledger_entry WHERE kind = 'couple_points'`,
  );
  return rows[0]?.total ?? 0;
}

/** Recent activity, newest first. Powers the ConnectionHome activity list. */
export async function listRecentLedgerEntries(
  exec: SqlExecutor,
  limit = 20,
): Promise<LedgerEntry[]> {
  if (limit <= 0) return [];
  const rows = await exec.query<RawLedgerRow>(
    `SELECT id, kind, delta, reason, ref_id, created_at
       FROM ledger_entry
      WHERE kind = 'couple_points'
      ORDER BY created_at DESC, ROWID DESC
      LIMIT ?`,
    [limit],
  );
  return rows.map(rowOf);
}

/** Count ledger entries that match a (reason, refId) pair — used by
 *  tests + invariants to assert idempotency. */
export async function countLedgerEntriesFor(
  exec: SqlExecutor,
  reason: string,
  refId: string,
): Promise<number> {
  const rows = await exec.query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ledger_entry
      WHERE kind = 'couple_points' AND reason = ? AND ref_id = ?`,
    [reason, refId],
  );
  return rows[0]?.n ?? 0;
}

/**
 * Everything the ledger writer needs from the host: SQL access, an
 * enqueue to push the add op onto the sync outbox, and a clock for tests.
 * Narrower than SyncEngine on purpose — a noop spy satisfies `enqueue`.
 */
export interface LedgerWriteDeps {
  readonly exec: SqlExecutor;
  readonly enqueue: (op: LedgerEntryAddOp) => Promise<void>;
  readonly now?: () => Date;
}

function nowSec(deps: LedgerWriteDeps): number {
  return Math.floor((deps.now ?? (() => new Date()))().getTime() / 1000);
}

/**
 * Award Couple Points. The R7 unlock loop calls this from the Author's
 * device only — the single, deterministic writer per attempt — so there
 * is exactly one source for each award and no cross-device double-count.
 *
 * Idempotent on (reason, refId): a second call for the same award is a
 * no-op (no row, no op). The (reason, refId) pair is the dedup key
 * because the ledger entry id is a random UUID (the op schema requires a
 * uuid), so we can't make the id itself deterministic — the pair stands
 * in for it. The local row + outbox op are written in one transaction so
 * a crash can't leave a counted-here-but-never-synced award; on the
 * recipient the projector INSERTs OR IGNOREs by id, collapsing replays
 * and the author's own echo into the one row.
 */
export async function awardCouplePoints(
  deps: LedgerWriteDeps,
  input: { delta: number; reason: string; refId: string },
): Promise<void> {
  // Outer guard: cheap short-circuit before doing any work.
  if ((await countLedgerEntriesFor(deps.exec, input.reason, input.refId)) > 0) return;
  const id = await randomUuidV4();
  const createdAt = nowSec(deps);
  await deps.exec.transaction(async () => {
    // Re-read inside the txn: two concurrent callers would both pass the
    // outer guard; the txn holds the write lock so this second check is
    // consistent with the INSERT and prevents a duplicate op on the wire.
    if ((await countLedgerEntriesFor(deps.exec, input.reason, input.refId)) > 0) return;
    await deps.exec.execute(
      `INSERT INTO ledger_entry (id, kind, delta, reason, ref_id, created_at)
       VALUES (?, 'couple_points', ?, ?, ?, ?)`,
      [id, input.delta, input.reason, input.refId, createdAt],
    );
    await deps.enqueue({
      v: 1,
      kind: 'ledger_entry.add',
      id,
      ledgerKind: 'couple_points',
      delta: input.delta,
      reason: input.reason,
      refId: input.refId,
      createdAt,
    });
  });
}
