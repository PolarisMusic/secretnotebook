import type { SqlExecutor } from '../../db/executor';
import type { CoupleStatus } from '../../state/couple';

const VALID_STATUSES: readonly CoupleStatus[] = [
  'unpaired',
  'awaiting_safeword',
  'paired',
  'severed',
];

export interface ActiveCouple {
  readonly coupleId: string;
  readonly status: CoupleStatus;
}

/**
 * Phase 1 has at most one couple row per device. Reads it (if any) and
 * returns the id + status so the boot pipeline can populate the couple
 * store. Returns null on a fresh install (no row) or if the stored
 * status is unexpected (defensive — a corrupt row shouldn't crash boot).
 */
export async function loadActiveCouple(exec: SqlExecutor): Promise<ActiveCouple | null> {
  const rows = await exec.query<{ id: string; status: string }>(
    'SELECT id, status FROM couple ORDER BY paired_at DESC LIMIT 1',
  );
  const row = rows[0];
  if (!row) return null;
  if (!(VALID_STATUSES as readonly string[]).includes(row.status)) return null;
  return { coupleId: row.id, status: row.status as CoupleStatus };
}
