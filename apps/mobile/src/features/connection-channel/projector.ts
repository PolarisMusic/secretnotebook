import type { CrdtOp } from '@secretnotebook/connection-protocol';
import { bytesToHex, hexToBytes } from '@secretnotebook/crypto';

import type { SqlExecutor } from '../../db/executor';
import { insertAttachmentFromDescriptor } from '../attachments/store';

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
 *   - `ledger_entry.add`: revived in R7 — add-only set keyed on id,
 *     INSERT OR IGNORE so the Author's award echo + replays collapse
 *     into one row (the Author's device is the only writer).
 *   - `secret_unlock.*`: the unlock-loop state machine. `start` is an
 *     add-only row create; `submit`/`reject`/`verify`/`cancel` are
 *     guarded state transitions keyed on the attempt id; `reflect` is an
 *     add-only set keyed (attempt_id, by_pubkey). Each carries the actor
 *     pubkey, checked against the ratchet sender.
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
      // Revived in R7. Add-only set keyed on id: the Author's device is
      // the sole writer (awardCouplePoints), and the recipient collapses
      // the author's own echo + any replay into one row. No author field
      // on this op — provenance is the ratchet (only the partner can put
      // an envelope on this half), and the (reason, refId) idempotency
      // lives on the writer side.
      await exec.execute(
        `INSERT OR IGNORE INTO ledger_entry (
           id, kind, delta, reason, ref_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
        [op.id, op.ledgerKind, op.delta, op.reason, op.refId, op.createdAt],
      );
      return;

    case 'note.share.add':
      if (op.authorPubkey !== senderHex) {
        throw new Error(
          `applyCrdtOp: note.share.add authorPubkey does not match sender — refusing to apply`,
        );
      }
      await exec.execute(
        `INSERT OR IGNORE INTO note (
           id, kind, author_pubkey, title, body, created_at
         ) VALUES (?, 'shared', ?, ?, ?, ?)`,
        [op.id, hexToBytes(op.authorPubkey), op.title ?? null, op.body ?? null, op.createdAt],
      );
      // Media rides as descriptors on the op; project them as 'remote'
      // rows (no local file yet). INSERT OR IGNORE on the descriptor id
      // keeps replays idempotent alongside the note row itself.
      for (const attachment of op.attachments ?? []) {
        await insertAttachmentFromDescriptor(exec, op.id, attachment, {
          state: 'remote',
          localUri: null,
          createdAt: op.createdAt,
        });
      }
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
            SET title          = COALESCE(?, title),
                body           = ?,
                revealed_at    = ?,
                reveal_comment = ?
          WHERE id             = ?
            AND kind           = 'secret'
            AND revealed_at IS NULL`,
        [op.title ?? null, op.body ?? null, op.revealedAt, op.revealComment ?? null, op.id],
      );
      // Secret-note media appears only on the reveal (never the announce).
      // Project the descriptors as 'remote' rows; INSERT OR IGNORE keeps
      // replays + the author's own echo idempotent.
      for (const attachment of op.attachments ?? []) {
        await insertAttachmentFromDescriptor(exec, op.id, attachment, {
          state: 'remote',
          localUri: null,
          createdAt: op.revealedAt,
        });
      }
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

    case 'note.edit': {
      // First-line: the editor claim must match the ratchet sender. That
      // alone is enough for shared notes (either partner is a valid
      // editor). For secret notes we further require editor === original
      // author — look up the row to enforce.
      if (op.editorPubkey !== senderHex) {
        throw new Error(
          `applyCrdtOp: note.edit editorPubkey does not match sender — refusing to apply`,
        );
      }
      const rows = await exec.query<{
        kind: 'shared' | 'secret';
        author_pubkey: Uint8Array | ArrayBufferLike;
      }>(`SELECT kind, author_pubkey FROM note WHERE id = ? AND deleted_at IS NULL`, [op.id]);
      const row = rows[0];
      // No live row to edit — could be a tombstone or a not-yet-seen note.
      // No-op: tombstone wins over a late edit; the announce/share that's
      // arriving later will re-create the body separately.
      if (!row) return;
      if (row.kind === 'secret') {
        const authorBytes = row.author_pubkey;
        const authorHex = bytesToHex(
          authorBytes instanceof Uint8Array ? authorBytes : new Uint8Array(authorBytes),
        );
        if (authorHex !== op.editorPubkey) {
          throw new Error(
            `applyCrdtOp: note.edit on a secret note must come from the original author — refusing to apply`,
          );
        }
      }
      // LWW: apply only when editedAt is strictly newer than the row's
      // current last_edited_at (NULL on first-ever edit). The check lives
      // in the WHERE clause so it's atomic with the UPDATE — a slightly
      // older edit racing a slightly newer one cannot transiently overwrite.
      await exec.execute(
        `UPDATE note
            SET body = ?, last_edited_at = ?, last_edited_by = ?
          WHERE id = ?
            AND deleted_at IS NULL
            AND (last_edited_at IS NULL OR last_edited_at < ?)`,
        [op.body, op.editedAt, hexToBytes(op.editorPubkey), op.id, op.editedAt],
      );
      return;
    }

    case 'note.delete': {
      // Tombstone. Author-only for both kinds: enforce
      // deleterPubkey === senderHex AND deleterPubkey === note.author_pubkey.
      // The author identity is taken from the row, not the op (the op's
      // claim wouldn't be authoritative without this).
      if (op.deleterPubkey !== senderHex) {
        throw new Error(
          `applyCrdtOp: note.delete deleterPubkey does not match sender — refusing to apply`,
        );
      }
      const rows = await exec.query<{ author_pubkey: Uint8Array | ArrayBufferLike }>(
        `SELECT author_pubkey FROM note WHERE id = ?`,
        [op.id],
      );
      const row = rows[0];
      // No row to tombstone — partner deleted before any add/announce got
      // applied here. Insert a tombstone so a future announce can't
      // resurrect the row: we INSERT OR IGNORE with deleted_at set, kind
      // defaulting to 'shared' (kind is unknown without an announce — the
      // value doesn't matter because deleted_at filtering hides it).
      if (!row) {
        await exec.execute(
          `INSERT OR IGNORE INTO note (id, kind, author_pubkey, body, created_at, deleted_at)
           VALUES (?, 'shared', ?, NULL, ?, ?)`,
          [op.id, hexToBytes(op.deleterPubkey), op.deletedAt, op.deletedAt],
        );
        return;
      }
      const authorBytes = row.author_pubkey;
      const authorHex = bytesToHex(
        authorBytes instanceof Uint8Array ? authorBytes : new Uint8Array(authorBytes),
      );
      if (authorHex !== op.deleterPubkey) {
        throw new Error(
          `applyCrdtOp: note.delete must come from the original author — refusing to apply`,
        );
      }
      // First-delete-wins via WHERE deleted_at IS NULL; body cleared so a
      // tombstoned row holds no plaintext, even if SQLCipher protects at
      // rest. Replays no-op.
      await exec.execute(
        `UPDATE note
            SET deleted_at = ?, body = NULL
          WHERE id = ?
            AND deleted_at IS NULL`,
        [op.deletedAt, op.id],
      );
      return;
    }

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

    case 'connection.safeword.propose': {
      // Author identity check, as with role.set: the proposer MUST be the
      // sender, so a peer can't spoof a proposal as coming from the local
      // user and flip their pending state.
      if (op.proposerPubkey !== senderHex) {
        throw new Error(
          `applyCrdtOp: connection.safeword.propose proposerPubkey does not match sender — refusing to apply`,
        );
      }
      const proposer = hexToBytes(op.proposerPubkey);
      // Receiver side: stash the incoming verifier AND — when the op carries
      // it — the plaintext term, so the UI can show it on the partner's side
      // and let them tap "Accept" without re-typing. An older-build proposer
      // sends no term; the receiver falls back to type-it-to-confirm.
      await exec.execute(
        `UPDATE connection
            SET safeword_proposal_verifier = ?,
                safeword_proposal_by       = ?,
                safeword_proposal_at       = ?,
                safeword_proposal_term     = ?
          WHERE partner_a_pubkey = ? OR partner_b_pubkey = ?`,
        [hexToBytes(op.verifier), proposer, op.proposedAt, op.term ?? null, proposer, proposer],
      );
      return;
    }

    case 'connection.safeword.confirm': {
      if (op.confirmerPubkey !== senderHex) {
        throw new Error(
          `applyCrdtOp: connection.safeword.confirm confirmerPubkey does not match sender — refusing to apply`,
        );
      }
      const confirmer = hexToBytes(op.confirmerPubkey);
      // Proposer side: the partner confirmed our pending proposal. Promote
      // it to the active term (term + verifier from the proposal we stashed
      // locally; salt was written at propose time). The guards make a
      // replayed confirm — or a confirm echoing the confirmer's OWN
      // proposal (proposal_by == confirmer) — a no-op, so first-confirm-wins.
      await exec.execute(
        `UPDATE connection
            SET safeword_verifier          = safeword_proposal_verifier,
                safeword_term              = safeword_proposal_term,
                safeword_confirmed_at      = ?,
                safeword_proposal_verifier = NULL,
                safeword_proposal_by       = NULL,
                safeword_proposal_at       = NULL,
                safeword_proposal_term     = NULL
          WHERE (partner_a_pubkey = ? OR partner_b_pubkey = ?)
            AND safeword_proposal_by IS NOT NULL
            AND safeword_proposal_by != ?`,
        [op.confirmedAt, confirmer, confirmer, confirmer],
      );
      return;
    }

    case 'connection.safeword.trigger':
      // The trigger belongs to the sender; reject ops claiming someone
      // else fired it. Add-only — INSERT OR IGNORE collapses replays.
      if (op.triggeredByPubkey !== senderHex) {
        throw new Error(
          `applyCrdtOp: connection.safeword.trigger triggeredByPubkey does not match sender — refusing to apply`,
        );
      }
      await exec.execute(
        `INSERT OR IGNORE INTO safeword_trigger (
           id, triggered_by_pubkey, triggered_at, acked_at
         ) VALUES (?, ?, ?, NULL)`,
        [op.id, hexToBytes(op.triggeredByPubkey), op.triggeredAt],
      );
      return;

    case 'connection.safeword.ack':
      if (op.ackedByPubkey !== senderHex) {
        throw new Error(
          `applyCrdtOp: connection.safeword.ack ackedByPubkey does not match sender — refusing to apply`,
        );
      }
      // First-ack-wins. Only the OTHER side acknowledges a trigger, so the
      // triggered_by != acker guard rejects a crafted self-ack on top of
      // the IS NULL replay guard.
      await exec.execute(
        `UPDATE safeword_trigger
            SET acked_at = ?
          WHERE id = ?
            AND acked_at IS NULL
            AND triggered_by_pubkey != ?`,
        [op.ackedAt, op.id, hexToBytes(op.ackedByPubkey)],
      );
      return;

    case 'connection.safeword.withdraw': {
      // Proposer-only: the withdrawer MUST be the sender. The WHERE pin
      // (safeword_proposal_by == withdrawer) makes a replay or a hostile
      // withdraw from the OTHER partner a safe no-op.
      if (op.withdrawerPubkey !== senderHex) {
        throw new Error(
          `applyCrdtOp: connection.safeword.withdraw withdrawerPubkey does not match sender — refusing to apply`,
        );
      }
      const withdrawer = hexToBytes(op.withdrawerPubkey);
      await exec.execute(
        `UPDATE connection
            SET safeword_proposal_verifier = NULL,
                safeword_proposal_by       = NULL,
                safeword_proposal_at       = NULL,
                safeword_proposal_term     = NULL
          WHERE (partner_a_pubkey = ? OR partner_b_pubkey = ?)
            AND safeword_proposal_by = ?`,
        [withdrawer, withdrawer, withdrawer],
      );
      return;
    }

    case 'secret_unlock.start':
      // The Unlocker is the actor; reject ops claiming someone else
      // started it. Add-only row create — INSERT OR IGNORE collapses
      // replays. author_pubkey is the recipient (this device); we trust
      // the kind-shape contract and the ratchet for that side.
      if (op.unlockerPubkey !== senderHex) {
        throw new Error(
          `applyCrdtOp: secret_unlock.start unlockerPubkey does not match sender — refusing to apply`,
        );
      }
      await exec.execute(
        `INSERT OR IGNORE INTO secret_unlock (
           id, author_pubkey, unlocker_pubkey, prompt_key, state, created_at
         ) VALUES (?, ?, ?, ?, 'assigned', ?)`,
        [
          op.id,
          hexToBytes(op.authorPubkey),
          hexToBytes(op.unlockerPubkey),
          op.promptKey,
          op.createdAt,
        ],
      );
      return;

    case 'secret_unlock.submit':
      // Unlocker-only transition. The WHERE pins the actor (unlocker
      // column == sender) and the source state, so a replay or a
      // hostile submit no-ops.
      if (op.unlockerPubkey !== senderHex) {
        throw new Error(
          `applyCrdtOp: secret_unlock.submit unlockerPubkey does not match sender — refusing to apply`,
        );
      }
      await exec.execute(
        `UPDATE secret_unlock SET state = 'submitted', submitted_at = ?
          WHERE id = ? AND unlocker_pubkey = ? AND state IN ('assigned', 'returned')`,
        [op.submittedAt, op.attemptId, hexToBytes(op.unlockerPubkey)],
      );
      return;

    case 'secret_unlock.reject':
      // Author send-back. submitted → returned; first-wins via the state
      // guard.
      if (op.authorPubkey !== senderHex) {
        throw new Error(
          `applyCrdtOp: secret_unlock.reject authorPubkey does not match sender — refusing to apply`,
        );
      }
      await exec.execute(
        `UPDATE secret_unlock SET state = 'returned', returned_at = ?
          WHERE id = ? AND author_pubkey = ? AND state = 'submitted'`,
        [op.rejectedAt, op.attemptId, hexToBytes(op.authorPubkey)],
      );
      return;

    case 'secret_unlock.verify':
      // Author verifies + reveals. On the Unlocker's device this both
      // advances the attempt and fills the drawn note's body/media so the
      // Unlocker can finally read the secret. First-verify-wins via the
      // attempt state guard; the note UPDATE is guarded by revealed_at IS
      // NULL so a replay can't overwrite an already-revealed body.
      if (op.authorPubkey !== senderHex) {
        throw new Error(
          `applyCrdtOp: secret_unlock.verify authorPubkey does not match sender — refusing to apply`,
        );
      }
      await exec.execute(
        `UPDATE secret_unlock
            SET state = 'revealed', verified_at = ?, revealed_note_id = ?
          WHERE id = ? AND author_pubkey = ? AND state = 'submitted'`,
        [op.verifiedAt, op.revealedNoteId, op.attemptId, hexToBytes(op.authorPubkey)],
      );
      await exec.execute(
        `UPDATE note
            SET body = ?, revealed_at = ?
          WHERE id = ? AND kind = 'secret' AND revealed_at IS NULL`,
        [op.body ?? null, op.verifiedAt, op.revealedNoteId],
      );
      for (const attachment of op.attachments ?? []) {
        await insertAttachmentFromDescriptor(exec, op.revealedNoteId, attachment, {
          state: 'remote',
          localUri: null,
          createdAt: op.verifiedAt,
        });
      }
      return;

    case 'secret_unlock.cancel':
      if (op.unlockerPubkey !== senderHex) {
        throw new Error(
          `applyCrdtOp: secret_unlock.cancel unlockerPubkey does not match sender — refusing to apply`,
        );
      }
      await exec.execute(
        `UPDATE secret_unlock SET state = 'canceled', canceled_at = ?
          WHERE id = ? AND unlocker_pubkey = ?
            AND state IN ('assigned', 'submitted', 'returned')`,
        [op.canceledAt, op.attemptId, hexToBytes(op.unlockerPubkey)],
      );
      return;

    case 'secret_unlock.reflect':
      // Add-only set keyed (attempt_id, by_pubkey): one reflection per
      // partner, INSERT OR IGNORE collapses replays + the author's own
      // echo. No award here — the projector has no outbox; the Author's
      // reconcileUnlockRewards pass writes the Couple-Points op.
      if (op.byPubkey !== senderHex) {
        throw new Error(
          `applyCrdtOp: secret_unlock.reflect byPubkey does not match sender — refusing to apply`,
        );
      }
      // The `stars` column from migration 015 is preserved (always NULL now)
      // rather than dropped — destructive SQL migrations would break any
      // existing reflection row whose write happened before this change.
      await exec.execute(
        `INSERT OR IGNORE INTO secret_unlock_reflection (
           attempt_id, by_pubkey, appreciate, uncomfortable, reflected_at
         ) VALUES (?, ?, ?, ?, ?)`,
        [op.attemptId, hexToBytes(op.byPubkey), op.appreciate, op.uncomfortable, op.reflectedAt],
      );
      return;

    case 'secret_unlock.reroll':
      // Unlocker replaces the prompt before submitting. Only the Unlocker
      // can reroll (unlockerPubkey must match sender). Update prompt_key
      // only while the attempt is still in an active, pre-submit state so
      // a replayed op can't overwrite an already-verified attempt.
      if (op.unlockerPubkey !== senderHex) {
        throw new Error(
          `applyCrdtOp: secret_unlock.reroll unlockerPubkey does not match sender — refusing to apply`,
        );
      }
      await exec.execute(
        `UPDATE secret_unlock SET prompt_key = ?
          WHERE id = ? AND unlocker_pubkey = ?
            AND state IN ('assigned', 'returned')`,
        [op.promptKey, op.attemptId, hexToBytes(op.unlockerPubkey)],
      );
      return;

    case 'secret_unlock.uncancel':
      // Unlocker undoes a cancel: canceled → assigned. Only the Unlocker
      // (unlockerPubkey must match sender). The state guard pins it to a
      // canceled row so a replay after the attempt moved on can't apply,
      // and clearing canceled_at leaves a clean active attempt.
      if (op.unlockerPubkey !== senderHex) {
        throw new Error(
          `applyCrdtOp: secret_unlock.uncancel unlockerPubkey does not match sender — refusing to apply`,
        );
      }
      await exec.execute(
        `UPDATE secret_unlock SET state = 'assigned', canceled_at = NULL
          WHERE id = ? AND unlocker_pubkey = ? AND state = 'canceled'`,
        [op.attemptId, hexToBytes(op.unlockerPubkey)],
      );
      return;

    case 'connection.sever.schedule': {
      // Either partner may schedule a sever; the actor must be the sender
      // (same author check as role.set). Last-write-wins: a newer schedule
      // (e.g. "end now") overwrites an earlier severAt. Targets the row
      // where the sender is a partner.
      if (op.byPubkey !== senderHex) {
        throw new Error(
          `applyCrdtOp: connection.sever.schedule byPubkey does not match sender — refusing to apply`,
        );
      }
      const by = hexToBytes(op.byPubkey);
      await exec.execute(
        `UPDATE connection
            SET sever_initiated_by = ?, sever_at = ?
          WHERE partner_a_pubkey = ? OR partner_b_pubkey = ?`,
        [by, op.severAt, by, by],
      );
      return;
    }

    case 'connection.sever.cancel': {
      // Undo. Only the partner who scheduled it can clear it: the WHERE
      // pins sever_initiated_by to the sender, so a cancel from the other
      // side (or a replay after a re-schedule) no-ops.
      if (op.byPubkey !== senderHex) {
        throw new Error(
          `applyCrdtOp: connection.sever.cancel byPubkey does not match sender — refusing to apply`,
        );
      }
      const by = hexToBytes(op.byPubkey);
      await exec.execute(
        `UPDATE connection
            SET sever_initiated_by = NULL, sever_at = NULL
          WHERE (partner_a_pubkey = ? OR partner_b_pubkey = ?)
            AND sever_initiated_by = ?`,
        [by, by, by],
      );
      return;
    }

    case 'prompt_preference.set': {
      // Per-user prompt-category preferences (R7 polish). Setter must
      // match the ratchet sender — same identity guard as role.set, so
      // a peer can't flip the local user's row. Last-write-wins by
      // `updatedAt`: the upsert below either inserts (no prior row) or
      // updates only when this op's stamp is strictly newer.
      if (op.setterPubkey !== senderHex) {
        throw new Error(
          `applyCrdtOp: prompt_preference.set setterPubkey does not match sender — refusing to apply`,
        );
      }
      const setter = hexToBytes(op.setterPubkey);
      const categoriesJson = JSON.stringify(op.categories);
      await exec.execute(
        `INSERT INTO prompt_preference (pubkey, categories, updated_at)
              VALUES (?, ?, ?)
              ON CONFLICT(pubkey) DO UPDATE
                SET categories = excluded.categories,
                    updated_at = excluded.updated_at
              WHERE excluded.updated_at > prompt_preference.updated_at`,
        [setter, categoriesJson, op.updatedAt],
      );
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
