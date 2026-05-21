import { bytesToHex, hexToBytes } from '@secretnotebook/crypto';
import type { SavedPostAddOp } from '@secretnotebook/couple-protocol';

import type { SqlExecutor } from '../../db/executor';
import { awardCouplePoints, LEDGER_REASON, POINTS_SAVE_FOR_PARTNER } from '../ledger/couple-points';
import { randomUuidV4 } from './uuid';
import type { SyncEngine } from './sync-engine';

export interface SaveForPartnerArgs {
  /** Local SqlExecutor — we INSERT OR IGNORE locally first. */
  readonly exec: SqlExecutor;
  /** Sync engine to enqueue the CRDT op onto. */
  readonly engine: SyncEngine;
  /** UUID of the post in the global feed (the one the user just tapped Save on). */
  readonly globalPostId: string;
  /** 32 bytes — this device's couple pubkey (self_pubkey on the row). */
  readonly savedByPubkey: Uint8Array;
  /** 32 bytes — the partner's couple pubkey (saved_for on the row). */
  readonly savedForPubkey: Uint8Array;
  /** Defaults to Date.now in seconds. */
  readonly now?: () => number;
  /** Defaults to a libsodium-backed UUID v4. Inject for deterministic tests. */
  readonly idFactory?: () => Promise<string>;
}

export interface SaveForPartnerResult {
  readonly savedPostId: string;
  /** Returns the op that was enqueued so the caller can assert in tests. */
  readonly op: SavedPostAddOp;
}

/**
 * "Save a global post for the partner". Two things happen in one logical
 * step:
 *   1. INSERT OR IGNORE into the local `saved_post` table so the sender
 *      sees their own save immediately (no UI lag waiting for the
 *      partner-side pull cycle).
 *   2. enqueue a `saved_post.add` CRDT op so the partner-side projector
 *      will write the mirror row on next sync.
 *
 * The same UUID is shared between local + remote so the projector's
 * INSERT OR IGNORE collapses to a no-op when the sender pulls back
 * their own envelope (which can't happen with the daily blinded ID
 * design but stays correct under any future rotation scheme).
 *
 * Pure-ish: no I/O outside the supplied exec + engine. Easy to drive
 * from tests and from the PostDetail route alike.
 */
export async function saveForPartner(args: SaveForPartnerArgs): Promise<SaveForPartnerResult> {
  if (args.savedByPubkey.length !== 32) throw new Error('savedByPubkey must be 32 bytes');
  if (args.savedForPubkey.length !== 32) throw new Error('savedForPubkey must be 32 bytes');
  const id = await (args.idFactory ?? randomUuidV4)();
  const createdAt = (args.now ?? ((): number => Math.floor(Date.now() / 1000)))();

  await args.exec.execute(
    `INSERT OR IGNORE INTO saved_post (
       id, global_post_id, saved_by_pubkey, saved_for_pubkey, created_at
     ) VALUES (?, ?, ?, ?, ?)`,
    [id, args.globalPostId, args.savedByPubkey, args.savedForPubkey, createdAt],
  );

  const op: SavedPostAddOp = {
    v: 1,
    kind: 'saved_post.add',
    id,
    globalPostId: args.globalPostId,
    savedByPubkey: bytesToHex(args.savedByPubkey),
    savedForPubkey: bytesToHex(args.savedForPubkey),
    createdAt,
  };
  await args.engine.enqueue(op);

  // S8 accrual: +2 Couple Points per save-for-partner. The ledger row
  // id derives from (reason, refId=savedPostId), so a duplicate save
  // attempt collapses idempotently — only one +2 ever lands.
  await awardCouplePoints({
    exec: args.exec,
    engine: args.engine,
    delta: POINTS_SAVE_FOR_PARTNER,
    reason: LEDGER_REASON.saveForPartner,
    refId: id,
    now: args.now,
  });

  return { savedPostId: id, op };
}

/** Convenience for callers that already have hex pubkeys. */
export async function saveForPartnerByHex(
  base: Omit<SaveForPartnerArgs, 'savedByPubkey' | 'savedForPubkey'> & {
    savedByPubkeyHex: string;
    savedForPubkeyHex: string;
  },
): Promise<SaveForPartnerResult> {
  return saveForPartner({
    ...base,
    savedByPubkey: hexToBytes(base.savedByPubkeyHex),
    savedForPubkey: hexToBytes(base.savedForPubkeyHex),
  });
}
