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

/**
 * Re-hydrate the root_key for a connection that is still mid-onboarding
 * (status='awaiting_safeword').
 *
 * The pairing flow stashes the root_key in memory (connection store
 * `pendingRootKey`) so DefineSafeWord can derive the Argon2id verifier. A
 * cold launch BEFORE the Safe Word is defined has no in-memory copy — the
 * store resets to null — which previously dead-ended DefineSafeWord on
 * "pairing state is missing" with no way back (forcing a reinstall). The
 * key was persisted to `channel_root_key_wrapped` at pairing time, so read
 * it back here. Returns null if the row/column is missing or the wrong
 * size (defensive — a bad value shouldn't crash boot).
 */
export async function loadConnectionRootKey(
  exec: SqlExecutor,
  connectionId: string,
): Promise<Uint8Array | null> {
  const rows = await exec.query<{
    channel_root_key_wrapped: Uint8Array | ArrayBufferLike | null;
  }>('SELECT channel_root_key_wrapped FROM connection WHERE id = ?', [connectionId]);
  const raw = rows[0]?.channel_root_key_wrapped;
  if (raw == null) return null;
  // op-sqlite returns BLOBs as Uint8Array; better-sqlite3 (Node tests) as
  // Buffer, which already satisfies the instanceof check. Coerce anything
  // else defensively.
  const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  return bytes.length === 32 ? bytes : null;
}
