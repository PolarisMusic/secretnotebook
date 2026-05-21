import type { PromptTransitionOp } from '@secretnotebook/couple-protocol';
import { bytesToHex } from '@secretnotebook/crypto';

import type { SqlExecutor } from '../../db/executor';
import { applyCrdtOp } from '../couple-channel/projector';
import type { SyncEngine } from '../couple-channel/sync-engine';

export interface TransitionArgs {
  readonly exec: SqlExecutor;
  readonly engine: SyncEngine;
  readonly promptId: string;
  /** 32-byte pubkey of whoever fired the transition (typically self). */
  readonly actorPubkey: Uint8Array;
  readonly now?: () => number;
}

/**
 * "I did it" — the assignee marks their own prompt complete. Writes the
 * transition through the projector locally (so the UI flips immediately)
 * AND enqueues a `prompt.transition` op so the partner's projector
 * mirrors the change on next pull. The projector's WHERE-clause guard
 * keeps a wrong-actor or wrong-state call from corrupting the row.
 */
export async function markPromptCompleted(args: TransitionArgs): Promise<PromptTransitionOp> {
  if (args.actorPubkey.length !== 32) throw new Error('actorPubkey must be 32 bytes');
  const at = (args.now ?? ((): number => Math.floor(Date.now() / 1000)))();
  const op: PromptTransitionOp = {
    v: 1,
    kind: 'prompt.transition',
    id: args.promptId,
    toState: 'completed',
    actorPubkey: bytesToHex(args.actorPubkey),
    at,
  };
  await applyCrdtOp(args.exec, op);
  await args.engine.enqueue(op);
  return op;
}

/**
 * "I confirm they did it" — the non-assignee certifies the partner's
 * completion. Same local-then-enqueue pattern. The projector's guard
 * silently no-ops if the row isn't in `completed` state yet, or if
 * the actor is the assignee (only the non-assignee can certify).
 */
export async function certifyPromptCompletion(args: TransitionArgs): Promise<PromptTransitionOp> {
  if (args.actorPubkey.length !== 32) throw new Error('actorPubkey must be 32 bytes');
  const at = (args.now ?? ((): number => Math.floor(Date.now() / 1000)))();
  const op: PromptTransitionOp = {
    v: 1,
    kind: 'prompt.transition',
    id: args.promptId,
    toState: 'certified',
    actorPubkey: bytesToHex(args.actorPubkey),
    at,
  };
  await applyCrdtOp(args.exec, op);
  await args.engine.enqueue(op);
  return op;
}
