import type { SqlExecutor } from '../../db/executor';

/**
 * Tables wiped wholesale on a sever (children before parents so the deletes
 * are FK-safe even with foreign_keys=ON; `connection` is last and its FK
 * cascades to `connection_ratchet`, but we clear that explicitly too for
 * clarity + order-independence).
 *
 * `note` and `saved_post` are deliberately NOT in this list — a sever keeps
 * the device's public footprint, so they get filtered/kept in
 * wipeConnectionData below rather than blunt-deleted here.
 *
 * Also EXCLUDED (survive a sever so the device can re-pair): `profiles`,
 * `post_cache`, `app_setting`, `entitlement`, `session`, and the keychain
 * `device_master` (+ its derived identity / SQLCipher keys).
 */
const CONNECTION_SCOPED_TABLES = [
  'secret_unlock_reflection',
  'secret_unlock',
  'attachment',
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
 * Erase the current connection from this device so it can re-pair fresh —
 * secrets, unlock attempts, Couple Points, the ratchet, the connection row,
 * and all queued/seen sync state — plus attachment files on disk. Points are
 * E2E, so deleting `ledger_entry` is the whole story; there is no server to
 * notify.
 *
 * The device's PUBLIC footprint is deliberately preserved (item J):
 *   - `saved_post` rows (your saves of others' public posts) are kept in full;
 *   - `note` rows that were published to the global feed
 *     (`published_global_post_id IS NOT NULL`) are kept as the local trace of
 *     a post that still lives on the server feed — only the couple-private
 *     (unpublished) notes are wiped.
 * The couple's notes should be exported/archived before this runs; that's
 * offered from the sever-schedule UI, not here. This function only deletes.
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
    // Public footprint stays: keep published notes (wipe only the
    // couple-private, unpublished ones); saved_post is kept entirely.
    await exec.execute(`DELETE FROM note WHERE published_global_post_id IS NULL`);
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
