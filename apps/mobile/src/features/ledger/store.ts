import type { SqlExecutor } from '../../db/executor';

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
