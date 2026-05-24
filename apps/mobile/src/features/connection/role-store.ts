import type { ConnectionRole, ConnectionRoleSetOp } from '@secretnotebook/connection-protocol';
import { bytesToHex } from '@secretnotebook/crypto';

import type { SqlExecutor } from '../../db/executor';

export type { ConnectionRole };

export interface ConnectionRoleSnapshot {
  /** Local row id; useful for callers that thread it elsewhere. */
  connectionId: string;
  partnerARole: ConnectionRole | null;
  partnerBRole: ConnectionRole | null;
}

interface RawConnectionRow {
  id: string;
  partner_a_pubkey: Uint8Array | ArrayBufferLike;
  partner_b_pubkey: Uint8Array | ArrayBufferLike;
  partner_a_role: ConnectionRole | null;
  partner_b_role: ConnectionRole | null;
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

export interface RoleStoreDeps {
  readonly exec: SqlExecutor;
  readonly selfPubkey: Uint8Array;
  readonly enqueue: (op: ConnectionRoleSetOp) => Promise<void>;
  readonly now?: () => Date;
}

function nowSec(deps: RoleStoreDeps): number {
  return Math.floor((deps.now ?? (() => new Date()))().getTime() / 1000);
}

async function loadConnectionForRoles(exec: SqlExecutor): Promise<RawConnectionRow | null> {
  // Phase-1.5 invariant: at most one active connection row per device.
  // We pick the most recently paired one as a defensive tie-break,
  // matching loadActiveConnection's ordering. Filter out 'severed'
  // explicitly so a residual row from before a wipe can't catch a
  // role.set; 'unpaired' and 'awaiting_safeword' are accepted because
  // the partner pubkeys exist on the row from the moment pairing
  // writes it, even before safeword bootstrap completes.
  const rows = await exec.query<RawConnectionRow>(
    `SELECT id, partner_a_pubkey, partner_b_pubkey, partner_a_role, partner_b_role
       FROM connection
      WHERE status != 'severed'
      ORDER BY paired_at DESC
      LIMIT 1`,
  );
  return rows[0] ?? null;
}

/**
 * Self-declare a role on the connection. Inserts the role into the
 * column matching the caller's side (a or b) and enqueues a
 * `connection.role.set` op so the partner sees the value after the
 * next sync cycle. Local UPDATE + outbox enqueue run inside one
 * transaction so a crash between them can't leave the partner with
 * a value the local row doesn't reflect (or vice versa).
 *
 * Throws when no connection exists locally, or when self-pubkey
 * doesn't match either side of the connection (i.e. boot ran a
 * setMyRole call before the local connection row was inserted, or
 * with a wrong identity).
 */
export async function setMyRole(deps: RoleStoreDeps, role: ConnectionRole): Promise<void> {
  const conn = await loadConnectionForRoles(deps.exec);
  if (!conn) throw new Error('setMyRole: no active connection');

  const aPub = bytesFromRow(conn.partner_a_pubkey);
  const bPub = bytesFromRow(conn.partner_b_pubkey);
  const isA = sameBytes(deps.selfPubkey, aPub);
  const isB = sameBytes(deps.selfPubkey, bPub);
  if (!isA && !isB) {
    throw new Error(`setMyRole: self pubkey does not match either partner on this connection`);
  }

  const setAt = nowSec(deps);
  await deps.exec.transaction(async () => {
    await deps.exec.execute(
      isA
        ? `UPDATE connection SET partner_a_role = ? WHERE id = ?`
        : `UPDATE connection SET partner_b_role = ? WHERE id = ?`,
      [role, conn.id],
    );
    await deps.enqueue({
      v: 1,
      kind: 'connection.role.set',
      setterPubkey: bytesToHex(deps.selfPubkey),
      role,
      setAt,
    });
  });
}

/** Snapshot of both partners' roles + the connection id. Returns
 *  null on a fresh device (no connection row yet). */
export async function getConnectionRoles(
  exec: SqlExecutor,
): Promise<ConnectionRoleSnapshot | null> {
  const conn = await loadConnectionForRoles(exec);
  if (!conn) return null;
  return {
    connectionId: conn.id,
    partnerARole: conn.partner_a_role,
    partnerBRole: conn.partner_b_role,
  };
}
