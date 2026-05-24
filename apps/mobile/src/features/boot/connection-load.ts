import type { SqlExecutor } from '../../db/executor';
import type { ConnectionStatus } from '../../state/connection';

const VALID_STATUSES: readonly ConnectionStatus[] = [
  'unpaired',
  'awaiting_safeword',
  'paired',
  'severed',
];

export interface ActiveConnection {
  readonly connectionId: string;
  readonly status: ConnectionStatus;
}

/**
 * Phase 1 has at most one connection row per device. Reads it (if any) and
 * returns the id + status so the boot pipeline can populate the connection
 * store. Returns null on a fresh install (no row) or if the stored
 * status is unexpected (defensive — a corrupt row shouldn't crash boot).
 */
export async function loadActiveConnection(exec: SqlExecutor): Promise<ActiveConnection | null> {
  const rows = await exec.query<{ id: string; status: string }>(
    'SELECT id, status FROM connection ORDER BY paired_at DESC LIMIT 1',
  );
  const row = rows[0];
  if (!row) return null;
  if (!(VALID_STATUSES as readonly string[]).includes(row.status)) return null;
  return { connectionId: row.id, status: row.status as ConnectionStatus };
}
