import type {
  RoleplayGratitudeStepOp,
  RoleplayRatingOp,
  RoleplayStartOp,
} from '@secretnotebook/couple-protocol';
import { bytesToHex } from '@secretnotebook/crypto';

import type { SqlExecutor } from '../../db/executor';
import { randomUuidV4 } from '../couple-channel/uuid';
import { applyCrdtOp } from '../couple-channel/projector';
import type { SyncEngine } from '../couple-channel/sync-engine';
import { awardCouplePoints, LEDGER_REASON, POINTS_LOOP_COMPLETED } from '../ledger/couple-points';
import { findRoleplaySession, isRoleplayLoopComplete } from './store';

export interface StartRoleplayArgs {
  readonly exec: SqlExecutor;
  readonly engine: SyncEngine;
  /** 32-byte pubkey of the partner trying the act (the recipient of
   *  the unlocked post). Typically self when fired from "I tried it". */
  readonly enactorPubkey: Uint8Array;
  /** 32-byte pubkey of the partner who saved the post (the rater). */
  readonly curatorPubkey: Uint8Array;
  readonly savedPostId: string;
  /** The gratitude prompt the starter picked. Travels in the op so
   *  both sides render the same words. */
  readonly gratitudePromptKey: string;
  readonly gratitudePromptTitle: string;
  readonly gratitudePromptBody: string;
  readonly now?: () => number;
  readonly idFactory?: () => Promise<string>;
}

export interface StartRoleplayResult {
  readonly sessionId: string;
  readonly op: RoleplayStartOp;
}

export async function startRoleplay(args: StartRoleplayArgs): Promise<StartRoleplayResult> {
  if (args.enactorPubkey.length !== 32) throw new Error('enactorPubkey must be 32 bytes');
  if (args.curatorPubkey.length !== 32) throw new Error('curatorPubkey must be 32 bytes');
  const id = await (args.idFactory ?? randomUuidV4)();
  const startedAt = (args.now ?? ((): number => Math.floor(Date.now() / 1000)))();
  const op: RoleplayStartOp = {
    v: 1,
    kind: 'roleplay.start',
    id,
    enactorPubkey: bytesToHex(args.enactorPubkey),
    curatorPubkey: bytesToHex(args.curatorPubkey),
    savedPostId: args.savedPostId,
    gratitudePromptKey: args.gratitudePromptKey,
    gratitudePromptTitle: args.gratitudePromptTitle,
    gratitudePromptBody: args.gratitudePromptBody,
    startedAt,
  };
  await applyCrdtOp(args.exec, op);
  await args.engine.enqueue(op);
  return { sessionId: id, op };
}

export interface SetRatingArgs {
  readonly exec: SqlExecutor;
  readonly engine: SyncEngine;
  readonly sessionId: string;
  /** 32 bytes — must be the curator's pubkey or the projector
   *  silently no-ops. */
  readonly actorPubkey: Uint8Array;
  readonly rating: number;
  readonly now?: () => number;
}

/**
 * Private 1..10 rating. The op DOES travel through the encrypted
 * couple channel (so both partners can see the rating) but is
 * structurally forbidden from leaving the relay — see the
 * server-cannot-decrypt invariant on the ratchet, and the Phase-3
 * BlockchainAdapter schema gate which will reject any payload that
 * mentions a rating field.
 */
export async function setRoleplayRating(args: SetRatingArgs): Promise<RoleplayRatingOp> {
  if (args.actorPubkey.length !== 32) throw new Error('actorPubkey must be 32 bytes');
  if (!Number.isInteger(args.rating) || args.rating < 1 || args.rating > 10) {
    throw new Error(`rating must be an integer 1..10, got ${args.rating}`);
  }
  const at = (args.now ?? ((): number => Math.floor(Date.now() / 1000)))();
  const op: RoleplayRatingOp = {
    v: 1,
    kind: 'roleplay.rating',
    id: args.sessionId,
    rating: args.rating,
    actorPubkey: bytesToHex(args.actorPubkey),
    at,
  };
  await applyCrdtOp(args.exec, op);
  await args.engine.enqueue(op);
  return op;
}

export interface MarkGratitudeArgs {
  readonly exec: SqlExecutor;
  readonly engine: SyncEngine;
  readonly sessionId: string;
  readonly side: 'enactor' | 'curator';
  readonly actorPubkey: Uint8Array;
  readonly now?: () => number;
}

export interface MarkGratitudeResult {
  readonly op: RoleplayGratitudeStepOp;
  /** True when this tap completed the loop (both sides now done) AND
   *  the +25 award was emitted from this device. Idempotent — even if
   *  the partner also fires from their side, the deterministic ledger
   *  id collapses both attempts. */
  readonly loopAwarded: boolean;
}

/**
 * Mark one side of the gratitude prompt done. If the other side is
 * already done locally (i.e. the loop just completed), fire the +25
 * Couple Points award as well. The ledger id derives deterministically
 * from (reason='roleplay-loop-completed', refId=sessionId) so a
 * concurrent fire from the partner collapses into a single +25.
 *
 * If the partner's side isn't visible yet (sync hasn't propagated),
 * we don't fire. The sweeper (loop-sweeper.ts) covers that case on
 * the next pull cycle.
 */
export async function markGratitudeStep(args: MarkGratitudeArgs): Promise<MarkGratitudeResult> {
  if (args.actorPubkey.length !== 32) throw new Error('actorPubkey must be 32 bytes');
  const at = (args.now ?? ((): number => Math.floor(Date.now() / 1000)))();
  const op: RoleplayGratitudeStepOp = {
    v: 1,
    kind: 'roleplay.gratitude-step',
    id: args.sessionId,
    side: args.side,
    actorPubkey: bytesToHex(args.actorPubkey),
    at,
  };
  await applyCrdtOp(args.exec, op);
  await args.engine.enqueue(op);

  const row = await findRoleplaySession(args.exec, args.sessionId);
  let loopAwarded = false;
  if (row && isRoleplayLoopComplete(row)) {
    await awardCouplePoints({
      exec: args.exec,
      engine: args.engine,
      delta: POINTS_LOOP_COMPLETED,
      reason: LEDGER_REASON.loopCompleted,
      refId: args.sessionId,
      now: args.now,
    });
    loopAwarded = true;
  }
  return { op, loopAwarded };
}
