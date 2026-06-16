import type { SqlExecutor } from '../../db/executor';

/**
 * Every table that belongs to the connection (this is a single-couple
 * app, so all rows in these tables are connection-scoped). Children
 * before parents so the deletes are FK-safe even with foreign_keys=ON;
 * `connection` is last and its FK cascades to `connection_ratchet`, but
 * we clear that explicitly too for clarity + order-independence.
 *
 * Deliberately EXCLUDED (survive a sever so the device can re-pair):
 * `profiles`, `post_cache`, `app_setting`, `entitlement`, `session`, and
 * the keychain `device_master` (+ its derived identity / SQLCipher keys).
 */
const CONNECTION_SCOPED_TABLES = [
  'secret_unlock_reflection',
  'secret_unlock',
  'attachment',
  'note',
  'saved_post',
  'ledger_entry',
  'safeword_trigger',
  'sync_outbox',
  'sync_seen',
  'connection_ratchet',
  'connection',
] as const;

export interface WipeOpts {
  /** Remove encrypted + cached attachment files from disk. Injected so the
   *  Node tests don't need a native filesystem; production passes the expo
   *  implementation (wipeAttachmentDirs in attachments/native.ts). */
  readonly deleteAttachmentFiles?: () => Promise<void>;
}

/**
 * Erase every trace of the current connection from this device — notes,
 * secrets, unlock attempts, Couple Points, saves, the ratchet, the
 * connection row, and all queued/seen sync state — plus attachment files
 * on disk. Points are E2E, so deleting `ledger_entry` is the whole story;
 * there is no server to notify.
 *
 * Row deletes run in one transaction (all-or-nothing). The file delete +
 * VACUUM run afterwards (best-effort) since neither is transactional; the
 * VACUUM zeroes freed SQLCipher pages so wiped content can't linger.
 */
export async function wipeConnectionData(exec: SqlExecutor, opts: WipeOpts = {}): Promise<void> {
  await exec.transaction(async () => {
    for (const table of CONNECTION_SCOPED_TABLES) {
      await exec.execute(`DELETE FROM ${table}`);
    }
  });
  if (opts.deleteAttachmentFiles) {
    try {
      await opts.deleteAttachmentFiles();
    } catch {
      // Best-effort: the files are ciphertext under a key we're orphaning
      // anyway, so a failed unlink isn't a correctness problem.
    }
  }
  try {
    await exec.execute('VACUUM');
  } catch {
    // VACUUM fails inside an open transaction; the rows are already gone.
  }
}
