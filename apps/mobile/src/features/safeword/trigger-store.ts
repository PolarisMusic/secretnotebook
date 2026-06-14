import type {
  ConnectionSafeWordAckOp,
  ConnectionSafeWordTriggerOp,
} from '@secretnotebook/connection-protocol';
import { bytesToHex } from '@secretnotebook/crypto';

import type { SqlExecutor } from '../../db/executor';
import { randomUuidV4 } from '../connection-channel/uuid';

/**
 * The active (unacknowledged) "safe word used" signal, if any.
 *  - inbound:  the partner fired it — surface a prominent alert until we ack.
 *  - outbound: we fired it — we're waiting for the partner to confirm receipt.
 */
export interface ActiveTrigger {
  readonly id: string;
  readonly triggeredBy: Uint8Array;
  readonly triggeredAt: number;
  readonly direction: 'inbound' | 'outbound';
}

type SafeWordTriggerOp = ConnectionSafeWordTriggerOp | ConnectionSafeWordAckOp;

export interface TriggerStoreDeps {
  readonly exec: SqlExecutor;
  readonly selfPubkey: Uint8Array;
  readonly enqueue: (op: SafeWordTriggerOp) => Promise<void>;
  readonly now?: () => Date;
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

function nowSec(deps: Pick<TriggerStoreDeps, 'now'>): number {
  return Math.floor((deps.now ?? (() => new Date()))().getTime() / 1000);
}

/**
 * Fire the safe word. Requires a confirmed term to exist (you trigger THE
 * agreed word). Inserts a local row and enqueues a
 * `connection.safeword.trigger` op; the partner sees it as an active alert
 * until they confirm receipt.
 */
export async function fireTrigger(deps: TriggerStoreDeps): Promise<string> {
  const rows = await deps.exec.query<{ id: string; safeword_confirmed_at: number | null }>(
    `SELECT id, safeword_confirmed_at FROM connection
      WHERE status != 'severed' ORDER BY paired_at DESC LIMIT 1`,
  );
  const conn = rows[0];
  if (!conn) throw new Error('fireTrigger: no active connection');
  if (conn.safeword_confirmed_at == null) {
    throw new Error('Set a roleplay term before triggering it');
  }

  const id = await randomUuidV4();
  const at = nowSec(deps);
  await deps.exec.transaction(async () => {
    await deps.exec.execute(
      `INSERT INTO safeword_trigger (id, triggered_by_pubkey, triggered_at, acked_at)
       VALUES (?, ?, ?, NULL)`,
      [id, deps.selfPubkey, at],
    );
    await deps.enqueue({
      v: 1,
      kind: 'connection.safeword.trigger',
      id,
      triggeredByPubkey: bytesToHex(deps.selfPubkey),
      triggeredAt: at,
    });
  });
  return id;
}

/**
 * Acknowledge receipt of a partner's trigger. Stamps acked_at locally
 * (first-ack-wins) and enqueues a `connection.safeword.ack` op so the alert
 * clears on both devices.
 */
export async function ackTrigger(deps: TriggerStoreDeps, id: string): Promise<void> {
  const at = nowSec(deps);
  await deps.exec.transaction(async () => {
    await deps.exec.execute(
      `UPDATE safeword_trigger SET acked_at = ? WHERE id = ? AND acked_at IS NULL`,
      [at, id],
    );
    await deps.enqueue({
      v: 1,
      kind: 'connection.safeword.ack',
      id,
      ackedByPubkey: bytesToHex(deps.selfPubkey),
      ackedAt: at,
    });
  });
}

/**
 * The most recent unacknowledged trigger, classified relative to `selfPubkey`.
 * Returns null when nothing is active.
 */
export async function getActiveTrigger(
  exec: SqlExecutor,
  selfPubkey: Uint8Array,
): Promise<ActiveTrigger | null> {
  const rows = await exec.query<{
    id: string;
    triggered_by_pubkey: Uint8Array | ArrayBufferLike;
    triggered_at: number;
  }>(
    `SELECT id, triggered_by_pubkey, triggered_at
       FROM safeword_trigger
      WHERE acked_at IS NULL
      ORDER BY triggered_at DESC, id DESC
      LIMIT 1`,
  );
  const row = rows[0];
  if (!row) return null;
  const by = bytesFromRow(row.triggered_by_pubkey);
  return {
    id: row.id,
    triggeredBy: by,
    triggeredAt: row.triggered_at,
    direction: sameBytes(by, selfPubkey) ? 'outbound' : 'inbound',
  };
}
