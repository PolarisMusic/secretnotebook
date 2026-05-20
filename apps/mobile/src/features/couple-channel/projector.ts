import type { CrdtOp } from '@secretnotebook/couple-protocol';
import { hexToBytes } from '@secretnotebook/crypto';

import type { SqlExecutor } from '../../db/executor';

/**
 * Apply a decrypted CRDT op to the local SQLite tables. Phase-1 ops are
 * all add-only — the row's primary key is the dedup token, and the
 * INSERT uses OR IGNORE so a duplicate delivery is a no-op rather than
 * an error. This is what makes the channel idempotent under replays
 * and out-of-order arrivals.
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
  }
}
