import type { CrdtOp } from '@secretnotebook/connection-protocol';
import { hexToBytes } from '@secretnotebook/crypto';

import type { SqlExecutor } from '../../db/executor';

/**
 * Apply a decrypted CRDT op to the local SQLite tables.
 *
 * Idempotency story per kind:
 *   - `saved_post.add` / `ledger_entry.add` / `note.share.add` /
 *     `note.secret.announce`: add-only set, the row PK is the dedup
 *     token. INSERT OR IGNORE collapses replays + late deliveries.
 *   - `note.secret.reveal`: UPDATE WHERE revealed_at IS NULL — first
 *     reveal wins; replays no-op.
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

    case 'note.share.add':
      await exec.execute(
        `INSERT OR IGNORE INTO note (
           id, kind, author_pubkey, body, created_at
         ) VALUES (?, 'shared', ?, ?, ?)`,
        [op.id, hexToBytes(op.authorPubkey), op.body, op.createdAt],
      );
      return;

    case 'note.secret.announce':
      await exec.execute(
        `INSERT OR IGNORE INTO note (
           id, kind, author_pubkey, body, created_at
         ) VALUES (?, 'secret', ?, NULL, ?)`,
        [op.id, hexToBytes(op.authorPubkey), op.createdAt],
      );
      return;

    case 'note.secret.reveal':
      // First reveal wins. The WHERE clause makes the projector a
      // no-op on replays AND on the author's own reveal echoing back
      // through the ratchet (the row already has body filled because
      // the author wrote it locally before enqueueing).
      await exec.execute(
        `UPDATE note
            SET body        = ?,
                revealed_at = ?
          WHERE id          = ?
            AND kind        = 'secret'
            AND revealed_at IS NULL`,
        [op.body, op.revealedAt, op.id],
      );
      return;
  }
}
