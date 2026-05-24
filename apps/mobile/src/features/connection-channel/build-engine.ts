import type { SqlExecutor } from '../../db/executor';
import type { ApiClient } from '../api/client';
import { loadRatchet } from './ratchet-store';
import { SyncEngine } from './sync-engine';

interface ConnectionSyncRow {
  id: string;
  partner_a_pubkey: Uint8Array | ArrayBufferLike;
  partner_b_pubkey: Uint8Array | ArrayBufferLike;
  channel_root_key_wrapped: Uint8Array | ArrayBufferLike;
  status: string;
}

function bytesFromRow(value: Uint8Array | ArrayBufferLike): Uint8Array {
  if (value instanceof Uint8Array) return value;
  return new Uint8Array(value as ArrayBufferLike);
}

export interface ConnectionSyncMaterial {
  readonly connectionId: string;
  readonly connectionRoot: Uint8Array;
  readonly partnerA: Uint8Array;
  readonly partnerB: Uint8Array;
}

/**
 * Read the connection-row fields the sync engine needs. Returns null if no
 * connection exists yet or the status isn't `paired` — pairing in progress
 * is not allowed to mutate the connection channel (Safe Word must land
 * first per the Phase-1 spec).
 */
export async function loadConnectionSyncMaterial(
  exec: SqlExecutor,
  connectionId: string,
): Promise<ConnectionSyncMaterial | null> {
  const rows = await exec.query<ConnectionSyncRow>(
    `SELECT id, partner_a_pubkey, partner_b_pubkey,
            channel_root_key_wrapped, status
       FROM connection WHERE id = ?`,
    [connectionId],
  );
  const row = rows[0];
  if (!row) return null;
  if (row.status !== 'paired') return null;
  return {
    connectionId: row.id,
    connectionRoot: bytesFromRow(row.channel_root_key_wrapped),
    partnerA: bytesFromRow(row.partner_a_pubkey),
    partnerB: bytesFromRow(row.partner_b_pubkey),
  };
}

export interface BuildEngineDeps {
  readonly exec: SqlExecutor;
  readonly api: ApiClient;
  readonly connectionId: string;
}

/**
 * Try to construct a SyncEngine from current persisted state. Returns
 * null if the connection isn't paired yet, or the connection_ratchet row isn't
 * populated (boot hit the FS faster than pairing completed, severed
 * connection, etc.). The caller — runBoot or the post-pairing route —
 * decides what to do with null (typically: ignore, retry later).
 */
export async function tryBuildSyncEngine(deps: BuildEngineDeps): Promise<SyncEngine | null> {
  const material = await loadConnectionSyncMaterial(deps.exec, deps.connectionId);
  if (!material) return null;
  const ratchet = await loadRatchet(deps.exec, deps.connectionId);
  if (!ratchet) return null;
  const selfPub = ratchet.side === 'a' ? material.partnerA : material.partnerB;
  const peerPub = ratchet.side === 'a' ? material.partnerB : material.partnerA;
  return new SyncEngine({
    exec: deps.exec,
    api: deps.api,
    connectionId: material.connectionId,
    connectionRoot: material.connectionRoot,
    selfPub,
    peerPub,
    side: ratchet.side,
  });
}
