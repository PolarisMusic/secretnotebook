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

    case 'note.publish':
      // First publish wins. Mirrors the author's local UPDATE so
      // both sides agree on published_at + published_global_post_id.
      // Replays and hostile re-publish attempts no-op against the
      // WHERE published_at IS NULL guard.
      await exec.execute(
        `UPDATE note
            SET published_at             = ?,
                published_global_post_id = ?
          WHERE id                       = ?
            AND published_at IS NULL`,
        [op.publishedAt, op.publishedGlobalPostId, op.id],
      );
      return;

    case 'connection.role.set': {
      // Last-write-wins. Two UPDATEs run; the one whose pubkey
      // doesn't match either partner is a 0-row no-op, so a setter
      // outside this connection (a hostile op with a non-matching
      // pubkey) cannot touch either column.
      const setter = hexToBytes(op.setterPubkey);
      await exec.execute(`UPDATE connection SET partner_a_role = ? WHERE partner_a_pubkey = ?`, [
        op.role,
        setter,
      ]);
      await exec.execute(`UPDATE connection SET partner_b_role = ? WHERE partner_b_pubkey = ?`, [
        op.role,
        setter,
      ]);
      return;
    }
  }
}
