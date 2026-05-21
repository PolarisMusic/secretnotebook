import type { LedgerEntryAddOp } from '@secretnotebook/couple-protocol';
import { sha256 } from '@secretnotebook/crypto';

import type { SqlExecutor } from '../../db/executor';
import { applyCrdtOp } from '../couple-channel/projector';
import type { SyncEngine } from '../couple-channel/sync-engine';

/**
 * Phase-1 Couple Points accrual rules per the spec:
 *   - +2  when you save a global post for your partner.
 *   - +10 when a prompt you assigned reaches `certified` (the
 *     certifier's tap fires the award).
 *   - +25 when both partners finish their gratitude step on a
 *     role-play loop (S8 push B, fired by whoever marks the second
 *     step).
 *
 * The values live here so the UI / ledger view can render labels
 * consistently and the tests can assert exact sums.
 */
export const POINTS_SAVE_FOR_PARTNER = 2;
export const POINTS_PROMPT_CERTIFIED = 10;
export const POINTS_LOOP_COMPLETED = 25;

/**
 * Reason strings stored on `ledger_entry.reason`. Stable identifiers —
 * the UI maps them to display labels. Adding a new accrual reason
 * means adding a constant here AND bumping the prompt-library schema
 * if it touches that path.
 */
export const LEDGER_REASON = {
  saveForPartner: 'save-for-partner',
  promptCertified: 'prompt-certified',
  loopCompleted: 'roleplay-loop-completed',
} as const;
export type LedgerReason = (typeof LEDGER_REASON)[keyof typeof LEDGER_REASON];

/**
 * Derive a deterministic UUID-shaped ledger_entry id from
 * `(reason, refId)`. Both partners produce the same id when they fire
 * the same award independently, so the projector's INSERT OR IGNORE
 * collapses the second arrival and the same event can't double-count
 * across replays / retries / cross-device emits.
 *
 * Format is a UUID-v5-style layout (version nibble = 5, variant
 * nibble = 8..b) backed by sha256 instead of sha1 — the bits aren't
 * load-bearing semantically; what matters is the format passes
 * `z.string().uuid()` and the input space (reason + refId) maps
 * 1-to-1 onto an id with overwhelming probability.
 */
export async function deriveLedgerEntryId(reason: string, refId: string): Promise<string> {
  const digest = await sha256(new TextEncoder().encode(`${reason}:${refId}`));
  const b = new Uint8Array(digest.subarray(0, 16));
  b[6] = ((b[6] as number) & 0x0f) | 0x50; // version 5
  b[8] = ((b[8] as number) & 0x3f) | 0x80; // variant 10xx
  const hex: string[] = [];
  for (let i = 0; i < 16; i++) hex.push((b[i] as number).toString(16).padStart(2, '0'));
  return (
    `${hex.slice(0, 4).join('')}-` +
    `${hex.slice(4, 6).join('')}-` +
    `${hex.slice(6, 8).join('')}-` +
    `${hex.slice(8, 10).join('')}-` +
    `${hex.slice(10, 16).join('')}`
  );
}

export interface AwardCouplePointsArgs {
  readonly exec: SqlExecutor;
  readonly engine: SyncEngine;
  readonly delta: number;
  readonly reason: string;
  /** UUID of the entity that triggered the award (savedPostId,
   *  promptId, or roleplaySessionId). Doubles as the dedup key. */
  readonly refId: string;
  readonly now?: () => number;
}

/**
 * Single shared entry point for every Couple Points award. Writes the
 * local ledger row through the projector, enqueues the matching
 * `ledger_entry.add` op so the partner mirrors it on next pull, and
 * returns the op for inspection.
 *
 * Idempotency lives at two layers:
 *   - The ledger row id derives from (reason, refId), so a re-emit
 *     applies as INSERT OR IGNORE in the projector.
 *   - `applyCrdtOp` is a no-op on a duplicate row regardless of how
 *     it got there.
 */
export async function awardCouplePoints(args: AwardCouplePointsArgs): Promise<LedgerEntryAddOp> {
  if (!Number.isInteger(args.delta)) throw new Error('delta must be an integer');
  if (args.reason.length === 0 || args.reason.length > 120) {
    throw new Error(`reason must be 1..120 chars, got ${args.reason.length}`);
  }
  const id = await deriveLedgerEntryId(args.reason, args.refId);
  const createdAt = (args.now ?? ((): number => Math.floor(Date.now() / 1000)))();
  const op: LedgerEntryAddOp = {
    v: 1,
    kind: 'ledger_entry.add',
    id,
    ledgerKind: 'couple_points',
    delta: args.delta,
    reason: args.reason,
    refId: args.refId,
    createdAt,
  };
  await applyCrdtOp(args.exec, op);
  await args.engine.enqueue(op);
  return op;
}
