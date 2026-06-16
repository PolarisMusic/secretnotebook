import type {
  ConnectionSeverCancelOp,
  ConnectionSeverScheduleOp,
} from '@secretnotebook/connection-protocol';
import { bytesToHex } from '@secretnotebook/crypto';

import type { SqlExecutor } from '../../db/executor';
import { wipeConnectionData } from './wipe';

/** Grace window before a scheduled sever actually wipes: 7 days. */
export const SEVER_GRACE_SECONDS = 7 * 24 * 60 * 60;

export interface SeverState {
  connectionId: string;
  /** Pubkey of the partner who scheduled the sever (the only side that may
   *  cancel it), or null when no sever is pending. */
  initiatedBy: Uint8Array | null;
  /** Unix seconds when the wipe becomes due, or null when none is pending. */
  severAt: number | null;
}

interface RawSeverRow {
  id: string;
  sever_initiated_by: Uint8Array | ArrayBufferLike | null;
  sever_at: number | null;
}

function bytesFromRow(value: Uint8Array | ArrayBufferLike): Uint8Array {
  if (value instanceof Uint8Array) return value;
  return new Uint8Array(value as ArrayBufferLike);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export interface SeverStoreDeps {
  readonly exec: SqlExecutor;
  readonly selfPubkey: Uint8Array;
  readonly enqueue: (op: ConnectionSeverScheduleOp | ConnectionSeverCancelOp) => Promise<void>;
  readonly now?: () => Date;
}

function nowSec(deps: { now?: () => Date }): number {
  return Math.floor((deps.now ?? (() => new Date()))().getTime() / 1000);
}

async function loadConnection(exec: SqlExecutor): Promise<RawSeverRow | null> {
  const rows = await exec.query<RawSeverRow>(
    `SELECT id, sever_initiated_by, sever_at
       FROM connection
      WHERE status != 'severed'
      ORDER BY paired_at DESC
      LIMIT 1`,
  );
  return rows[0] ?? null;
}

/** Read the pending-sever state of the active connection (null if no row). */
export async function getSeverState(exec: SqlExecutor): Promise<SeverState | null> {
  const conn = await loadConnection(exec);
  if (!conn) return null;
  return {
    connectionId: conn.id,
    initiatedBy: conn.sever_initiated_by != null ? bytesFromRow(conn.sever_initiated_by) : null,
    severAt: conn.sever_at,
  };
}

export function isSeverDue(severAt: number | null, nowSeconds: number): boolean {
  return severAt != null && nowSeconds >= severAt;
}

/**
 * Schedule a unilateral sever: mark the connection locally and tell the
 * partner via a `connection.sever.schedule` op. Defaults to the 7-day
 * grace window; pass `graceSeconds: 0` for "end now". Local UPDATE +
 * outbox enqueue run in one transaction. Returns the resolved severAt.
 */
export async function scheduleSever(
  deps: SeverStoreDeps,
  opts: { graceSeconds?: number } = {},
): Promise<number> {
  const conn = await loadConnection(deps.exec);
  if (!conn) throw new Error('scheduleSever: no active connection');
  const severAt = nowSec(deps) + (opts.graceSeconds ?? SEVER_GRACE_SECONDS);
  await deps.exec.transaction(async () => {
    await deps.exec.execute(
      `UPDATE connection SET sever_initiated_by = ?, sever_at = ? WHERE id = ?`,
      [deps.selfPubkey, severAt, conn.id],
    );
    await deps.enqueue({
      v: 1,
      kind: 'connection.sever.schedule',
      byPubkey: bytesToHex(deps.selfPubkey),
      severAt,
    });
  });
  return severAt;
}

/**
 * Undo a pending sever. Initiator-only: the local row's
 * `sever_initiated_by` must be this device, otherwise the partner started
 * it and only they can call it off (you'd "end now" or schedule your own
 * instead). Clears the columns + tells the partner via a cancel op.
 */
export async function cancelSever(deps: SeverStoreDeps): Promise<void> {
  const conn = await loadConnection(deps.exec);
  if (!conn) throw new Error('cancelSever: no active connection');
  if (conn.sever_at == null) return; // nothing pending — idempotent
  if (
    conn.sever_initiated_by == null ||
    !sameBytes(bytesFromRow(conn.sever_initiated_by), deps.selfPubkey)
  ) {
    throw new Error('cancelSever: only the partner who started the sever can cancel it');
  }
  await deps.exec.transaction(async () => {
    await deps.exec.execute(
      `UPDATE connection SET sever_initiated_by = NULL, sever_at = NULL WHERE id = ?`,
      [conn.id],
    );
    await deps.enqueue({
      v: 1,
      kind: 'connection.sever.cancel',
      byPubkey: bytesToHex(deps.selfPubkey),
      canceledAt: nowSec(deps),
    });
  });
}

export interface FinalizeSeverDeps {
  readonly exec: SqlExecutor;
  readonly now?: () => Date;
  readonly deleteAttachmentFiles?: () => Promise<void>;
}

/**
 * If a pending sever is now due, wipe all connection-scoped data and
 * report `true` (the caller then resets the in-memory stores / engine).
 * Runs on every post-pull cycle and at boot, on BOTH devices, so each
 * side wipes independently once its clock passes `severAt` — no
 * coordination needed at expiry. A no-op (returns false) when nothing is
 * pending or the grace window hasn't elapsed.
 */
export async function maybeFinalizeSever(deps: FinalizeSeverDeps): Promise<boolean> {
  const state = await getSeverState(deps.exec);
  if (!state || !isSeverDue(state.severAt, nowSec(deps))) return false;
  await wipeConnectionData(deps.exec, { deleteAttachmentFiles: deps.deleteAttachmentFiles });
  return true;
}
