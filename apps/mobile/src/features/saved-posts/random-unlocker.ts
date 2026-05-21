import type { SavedPostUnlockOp } from '@secretnotebook/couple-protocol';

import type { SqlExecutor } from '../../db/executor';
import { applyCrdtOp } from '../couple-channel/projector';
import type { SyncEngine } from '../couple-channel/sync-engine';

export interface UnlockOneRandomArgs {
  readonly exec: SqlExecutor;
  readonly engine: SyncEngine;
  /**
   * Whose locked saved_posts we draw from — the assignee of the prompt
   * that just certified. The certifier (non-assignee) is the one
   * calling this; their local DB already has the partner's saved_post
   * rows because the save-for-partner ops replicated them.
   */
  readonly assigneePubkey: Uint8Array;
  /** The prompt.id whose certification triggers this unlock. Becomes
   *  saved_post.unlock_prompt_id and is the idempotency key. */
  readonly unlockPromptId: string;
  readonly now?: () => number;
  /**
   * Random source in [0, 1). Inject for deterministic tests; defaults
   * to Math.random. We pull a deterministic, ORDER-BY-id candidate
   * list and pick by index so SQL's non-deterministic RANDOM() never
   * enters the picture.
   */
  readonly random?: () => number;
}

export interface UnlockResult {
  /** The picked saved_post.id, now linked to unlockPromptId. */
  readonly savedPostId: string;
}

const MAX_CANDIDATES = 1000;

/**
 * Pick exactly one locked saved_post belonging to the assignee, mark it
 * unlocked locally, and enqueue a `saved_post.unlock` op so the partner
 * mirrors the row. Returns null if there's nothing to unlock — the
 * spec's "zero unlockable posts" edge case (prompt still certified,
 * UI nudges the assigner to save more).
 *
 * Idempotency lives at two layers:
 *   1. The presence check at the top — if any saved_post already has
 *      `unlock_prompt_id = unlockPromptId`, return null. Guards
 *      against a double-tap from the certifier (the React state
 *      transition can race the local DB update).
 *   2. The projector's `WHERE unlocked_at IS NULL` guard on the
 *      emitted op. Guards against the partner's local pick racing
 *      and landing first.
 */
export async function unlockOneRandomFor(args: UnlockOneRandomArgs): Promise<UnlockResult | null> {
  if (args.assigneePubkey.length !== 32) throw new Error('assigneePubkey must be 32 bytes');

  // Idempotency guard: if anything is already tied to this prompt's
  // unlock, skip. Cheap pre-check; the projector also guards.
  const existing = await args.exec.query<{ id: string }>(
    `SELECT id FROM saved_post WHERE unlock_prompt_id = ? LIMIT 1`,
    [args.unlockPromptId],
  );
  if (existing.length > 0) return null;

  // Pull the candidate set deterministically — ORDER BY id ASC so two
  // devices given the same random source pick the same row.
  const candidates = await args.exec.query<{ id: string }>(
    `SELECT id FROM saved_post
      WHERE saved_for_pubkey = ? AND unlocked_at IS NULL
      ORDER BY id ASC
      LIMIT ?`,
    [args.assigneePubkey, MAX_CANDIDATES],
  );
  if (candidates.length === 0) return null;

  const random = args.random ?? Math.random;
  const idx = Math.min(candidates.length - 1, Math.floor(random() * candidates.length));
  const picked = candidates[idx]!;

  const at = (args.now ?? ((): number => Math.floor(Date.now() / 1000)))();
  const op: SavedPostUnlockOp = {
    v: 1,
    kind: 'saved_post.unlock',
    savedPostId: picked.id,
    unlockPromptId: args.unlockPromptId,
    at,
  };
  // Apply locally first so the certifier's UI flips immediately;
  // enqueue for the partner to mirror on next pull.
  await applyCrdtOp(args.exec, op);
  await args.engine.enqueue(op);
  return { savedPostId: picked.id };
}
