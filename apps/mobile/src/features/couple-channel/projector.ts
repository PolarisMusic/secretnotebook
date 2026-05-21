import type { CrdtOp } from '@secretnotebook/couple-protocol';
import { hexToBytes } from '@secretnotebook/crypto';

import type { SqlExecutor } from '../../db/executor';

/**
 * Apply a decrypted CRDT op to the local SQLite tables.
 *
 * Idempotency story per kind:
 *   - `saved_post.add` / `ledger_entry.add`: add-only set, the row PK is
 *     the dedup token. INSERT OR IGNORE collapses replays + late
 *     deliveries.
 *   - `prompt.assign`: same pattern as the add-only sets — the prompt
 *     row's id is shared between assigner + assignee, INSERT OR IGNORE
 *     handles the self-delivery case.
 *   - `prompt.transition`: state-machine transition with WHERE-clause
 *     guards. The UPDATE only fires when (a) the current state is the
 *     legal predecessor (assigned → completed, completed → certified,
 *     either → expired) AND (b) the actor matches the spec rule
 *     (assignee only for `completed`, NON-assignee only for `certified`).
 *     Illegal transitions are silent no-ops rather than errors so a
 *     racing partner's op can't crash the projector.
 *   - `saved_post.unlock`: WHERE unlocked_at IS NULL guard collapses
 *     replays + concurrent picks of the same row. The certifier picks
 *     and emits; both partners apply via the projector, with the
 *     loser's op landing as a no-op when the row's already unlocked.
 */
export async function applyCrdtOp(exec: SqlExecutor, op: CrdtOp): Promise<void> {
  switch (op.kind) {
    case 'saved_post.add':
      await exec.execute(
        `INSERT OR IGNORE INTO saved_post (
           id, global_post_id, saved_by_pubkey, saved_for_pubkey, created_at
         ) VALUES (?, ?, ?, ?, ?)`,
        [
          op.id,
          op.globalPostId,
          hexToBytes(op.savedByPubkey),
          hexToBytes(op.savedForPubkey),
          op.createdAt,
        ],
      );
      return;

    case 'ledger_entry.add':
      await exec.execute(
        `INSERT OR IGNORE INTO ledger_entry (
           id, kind, delta, reason, ref_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
        [op.id, op.ledgerKind, op.delta, op.reason, op.refId, op.createdAt],
      );
      return;

    case 'prompt.assign':
      await exec.execute(
        `INSERT OR IGNORE INTO prompt (
           id, library_key, title, body,
           assigned_to_pubkey, assigned_by_pubkey, state
         ) VALUES (?, ?, ?, ?, ?, ?, 'assigned')`,
        [
          op.id,
          op.libraryKey,
          op.title,
          op.body,
          hexToBytes(op.assignedToPubkey),
          hexToBytes(op.assignedByPubkey),
        ],
      );
      return;

    case 'prompt.transition': {
      const actor = hexToBytes(op.actorPubkey);
      if (op.toState === 'completed') {
        // Only the assignee can mark complete; only from `assigned`.
        await exec.execute(
          `UPDATE prompt
              SET state = 'completed', completed_at = ?
            WHERE id = ?
              AND state = 'assigned'
              AND assigned_to_pubkey = ?`,
          [op.at, op.id, actor],
        );
        return;
      }
      if (op.toState === 'certified') {
        // Only the NON-assignee can certify; only from `completed`.
        await exec.execute(
          `UPDATE prompt
              SET state = 'certified', certified_at = ?
            WHERE id = ?
              AND state = 'completed'
              AND assigned_to_pubkey != ?`,
          [op.at, op.id, actor],
        );
        return;
      }
      if (op.toState === 'expired') {
        // Either side can expire, but only from non-terminal states.
        await exec.execute(
          `UPDATE prompt
              SET state = 'expired'
            WHERE id = ?
              AND state IN ('assigned', 'completed')`,
          [op.id],
        );
        return;
      }
      return;
    }

    case 'saved_post.unlock':
      await exec.execute(
        `UPDATE saved_post
            SET unlocked_at = ?, unlock_prompt_id = ?
          WHERE id = ?
            AND unlocked_at IS NULL`,
        [op.at, op.unlockPromptId, op.savedPostId],
      );
      return;
  }
}
