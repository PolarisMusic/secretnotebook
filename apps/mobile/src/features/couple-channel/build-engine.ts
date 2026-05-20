import type { SqlExecutor } from '../../db/executor';
import type { ApiClient } from '../api/client';
import { loadRatchet } from './ratchet-store';
import { SyncEngine } from './sync-engine';

interface CoupleSyncRow {
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

export interface CoupleSyncMaterial {
  readonly coupleId: string;
  readonly coupleRoot: Uint8Array;
  readonly partnerA: Uint8Array;
  readonly partnerB: Uint8Array;
}

/**
 * Read the couple-row fields the sync engine needs. Returns null if no
 * couple exists yet or the status isn't `paired` — pairing in progress
 * is not allowed to mutate the couple channel (Safe Word must land
 * first per the Phase-1 spec).
 */
export async function loadCoupleSyncMaterial(
  exec: SqlExecutor,
  coupleId: string,
): Promise<CoupleSyncMaterial | null> {
  const rows = await exec.query<CoupleSyncRow>(
    `SELECT id, partner_a_pubkey, partner_b_pubkey,
            channel_root_key_wrapped, status
       FROM couple WHERE id = ?`,
    [coupleId],
  );
  const row = rows[0];
  if (!row) return null;
  if (row.status !== 'paired') return null;
  return {
    coupleId: row.id,
    coupleRoot: bytesFromRow(row.channel_root_key_wrapped),
    partnerA: bytesFromRow(row.partner_a_pubkey),
    partnerB: bytesFromRow(row.partner_b_pubkey),
  };
}

export interface BuildEngineDeps {
  readonly exec: SqlExecutor;
  readonly api: ApiClient;
  readonly coupleId: string;
}

/**
 * Try to construct a SyncEngine from current persisted state. Returns
 * null if the couple isn't paired yet, or the couple_ratchet row isn't
 * populated (boot hit the FS faster than pairing completed, severed
 * couple, etc.). The caller — runBoot or the post-pairing route —
 * decides what to do with null (typically: ignore, retry later).
 */
export async function tryBuildSyncEngine(deps: BuildEngineDeps): Promise<SyncEngine | null> {
  const material = await loadCoupleSyncMaterial(deps.exec, deps.coupleId);
  if (!material) return null;
  const ratchet = await loadRatchet(deps.exec, deps.coupleId);
  if (!ratchet) return null;
  const selfPub = ratchet.side === 'a' ? material.partnerA : material.partnerB;
  const peerPub = ratchet.side === 'a' ? material.partnerB : material.partnerA;
  return new SyncEngine({
    exec: deps.exec,
    api: deps.api,
    coupleId: material.coupleId,
    coupleRoot: material.coupleRoot,
    selfPub,
    peerPub,
    side: ratchet.side,
  });
}
