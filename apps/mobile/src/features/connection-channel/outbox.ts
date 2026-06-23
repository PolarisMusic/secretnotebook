import type { SqlExecutor } from '../../db/executor';

export interface OutboxRow {
  id: string;
  envelope: string;
  recipientPubkey: Uint8Array;
  attempts: number;
  nextAttemptAt: number;
}

interface RawOutboxRow {
  id: string;
  envelope: string;
  recipient_pubkey: Uint8Array | ArrayBufferLike;
  attempts: number;
  next_attempt_at: number;
}

function bytesFromRow(value: Uint8Array | ArrayBufferLike): Uint8Array {
  if (value instanceof Uint8Array) return value;
  return new Uint8Array(value as ArrayBufferLike);
}

/**
 * Append an op (already serialised by the caller) to `sync_outbox`. The
 * id is supplied externally so the sender loop can correlate the row
 * with a successful POST and delete the right thing without a SELECT.
 *
 * `envelope` is plaintext on disk because (a) the device file is already
 * SQLCipher-encrypted at rest and (b) the row exists only between
 * enqueue and the first successful relay POST.
 */
export async function enqueueOutbox(
  exec: SqlExecutor,
  args: {
    id: string;
    envelope: string;
    recipientPubkey: Uint8Array;
    nextAttemptAt: number;
  },
): Promise<void> {
  await exec.execute(
    `INSERT INTO sync_outbox (
       id, envelope, recipient_pubkey, attempts, next_attempt_at
     ) VALUES (?, ?, ?, 0, ?)`,
    [args.id, args.envelope, args.recipientPubkey, args.nextAttemptAt],
  );
}

/**
 * Pull every outbox row whose retry timer has elapsed, ordered by the
 * order it was enqueued (`next_attempt_at` then `id`). Sender drains in
 * one pass; if a POST fails it bumps the attempts/timer and the row
 * stays in the outbox for the next cycle.
 */
export async function readPendingOutbox(exec: SqlExecutor, now: number): Promise<OutboxRow[]> {
  const rows = await exec.query<RawOutboxRow>(
    `SELECT id, envelope, recipient_pubkey, attempts, next_attempt_at
       FROM sync_outbox
      WHERE next_attempt_at <= ?
      ORDER BY next_attempt_at ASC, id ASC`,
    [now],
  );
  return rows.map((r) => ({
    id: r.id,
    envelope: r.envelope,
    recipientPubkey: bytesFromRow(r.recipient_pubkey),
    attempts: r.attempts,
    nextAttemptAt: r.next_attempt_at,
  }));
}

export async function deleteOutbox(exec: SqlExecutor, id: string): Promise<void> {
  await exec.execute('DELETE FROM sync_outbox WHERE id = ?', [id]);
}

/**
 * Total rows currently queued in `sync_outbox` (sent-but-unacked ops).
 * Diagnostics only — a depth that never returns to 0 means flush() can't
 * deliver (the relay POST is failing); see the in-app Sync diagnostics.
 */
export async function countOutbox(exec: SqlExecutor): Promise<number> {
  const rows = await exec.query<{ n: number }>(`SELECT COUNT(*) AS n FROM sync_outbox`, []);
  return Number(rows[0]?.n ?? 0);
}

export async function bumpOutboxAttempt(
  exec: SqlExecutor,
  args: { id: string; nextAttemptAt: number },
): Promise<void> {
  await exec.execute(
    `UPDATE sync_outbox
        SET attempts        = attempts + 1,
            next_attempt_at = ?
      WHERE id = ?`,
    [args.nextAttemptAt, args.id],
  );
}
