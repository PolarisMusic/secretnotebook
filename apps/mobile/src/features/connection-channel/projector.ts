import type { CrdtOp } from '@secretnotebook/connection-protocol';
import { hexToBytes } from '@secretnotebook/crypto';

import type { SqlExecutor } from '../../db/executor';

/**
 * Apply a decrypted CRDT op to the local SQLite tables.
 *
 * Idempotency story per kind:
 *   - `saved_post.add` / `ledger_entry.add`: add-only set, the row PK is
 *     the dedup token. INSERT OR IGNORE collapses replays + late
 *     deliveries.
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
