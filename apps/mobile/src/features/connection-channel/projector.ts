import type { CrdtOp } from '@secretnotebook/connection-protocol';
import { bytesToHex, hexToBytes } from '@secretnotebook/crypto';

import type { SqlExecutor } from '../../db/executor';

/**
 * Apply a decrypted CRDT op to the local SQLite tables.
 *
 * `senderPubkey` is the pubkey that owns the ratchet half this op
 * arrived on — i.e. on side A, every op B sends is decrypted with
 * B's key, so `senderPubkey === peerPub`. For ops that carry an
 * author / setter identity field (note.share.add, note.secret.announce,
 * connection.role.set, saved_post.add), the projector enforces that
 * the on-wire identity matches `senderPubkey`. Without that check, a
 * malicious B can craft `{kind: 'connection.role.set', setterPubkey:
 * A_PUB, role: 'feminine'}` and the projector would happily apply it
 * — flipping A's own role on A's device. The check closes that gap
 * at the boundary where decryption meets local state.
 *
 * Idempotency story per kind:
 *   - `saved_post.add` / `note.share.add` / `note.secret.announce`:
 *     add-only set, the row PK is the dedup token. INSERT OR IGNORE
 *     collapses replays + late deliveries.
 *   - `note.secret.reveal` / `note.publish`: UPDATE WHERE (target
 *     column) IS NULL — first wins; replays no-op.
 *   - `connection.role.set`: last-write-wins by ratchet order
 *     (sync_seen + outbox-delete-on-success make replays practically
 *     impossible).
 *   - `ledger_entry.add`: retired in R6.2, projector no-ops so stale
 *     envelopes from pre-R6.2 clients can be deleted on the relay
 *     without inserting unsourced rows.
 */
export async function applyCrdtOp(
  exec: SqlExecutor,
  op: CrdtOp,
  senderPubkey: Uint8Array,
): Promise<void> {
  const senderHex = bytesToHex(senderPubkey);

  switch (op.kind) {
    case 'saved_post.add':
      // The save action belongs to the sender; reject ops that
      // claim someone else did the saving.
      if (op.savedByPubkey !== senderHex) {
        throw new Error(
          `applyCrdtOp: saved_post.add savedByPubkey does not match sender — refusing to apply`,
        );
      }
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
      // Deprecated in R6.2 — the only writer was retired with R0's
      // couple-loop cleanup, so any incoming op is stale or hostile.
      // We swallow it as a no-op rather than INSERT (no provenance,
      // no idempotency authority) or throw (would prevent the
      // envelope from being deleted on the relay and burn a retry
      // every cycle). New code MUST NOT emit this op.
      return;

    case 'note.share.add':
      if (op.authorPubkey !== senderHex) {
        throw new Error(
          `applyCrdtOp: note.share.add authorPubkey does not match sender — refusing to apply`,
        );
      }
      await exec.execute(
        `INSERT OR IGNORE INTO note (
           id, kind, author_pubkey, body, created_at
         ) VALUES (?, 'shared', ?, ?, ?)`,
        [op.id, hexToBytes(op.authorPubkey), op.body, op.createdAt],
      );
      return;

    case 'note.secret.announce':
      if (op.authorPubkey !== senderHex) {
        throw new Error(
          `applyCrdtOp: note.secret.announce authorPubkey does not match sender — refusing to apply`,
        );
      }
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
      // the author wrote it locally before enqueueing). No author
      // field on this op — the reveal is keyed to the note's id and
      // we trust the kind-shape contract; the announce that
      // preceded it carried the authorPubkey check.
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
      // WHERE published_at IS NULL guard. As with reveal, no author
      // field — the announce/share op already established who wrote
      // the note, and the publish doesn't change authorship.
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
      // Author identity check: the setter MUST be the sender. This
      // is what prevents partner B from spoofing role.set ops with
      // `setterPubkey = A_PUB` and flipping A's own role on A's
      // device. Without the check, the WHERE-pubkey-matches UPDATE
      // below would apply hostile ops with no defense.
      if (op.setterPubkey !== senderHex) {
        throw new Error(
          `applyCrdtOp: connection.role.set setterPubkey does not match sender — refusing to apply`,
        );
      }
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

    default: {
      // Exhaustiveness guard: if a new op kind is added to the
      // CrdtOp discriminated union without a branch here, this
      // assignment fails to typecheck. Throwing at runtime is the
      // belt to the type-level brace — a forgotten branch
      // otherwise silently drops the op (sync_seen would mark the
      // envelope processed, and the substance is lost).
      const _exhaustive: never = op;
      throw new Error(`applyCrdtOp: unhandled CRDT op kind ${JSON.stringify(_exhaustive)}`);
    }
  }
}
