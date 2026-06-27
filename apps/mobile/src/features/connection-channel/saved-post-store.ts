import type { SavedPostAddOp } from '@secretnotebook/connection-protocol';
import { bytesToHex } from '@secretnotebook/crypto';

import type { SqlExecutor } from '../../db/executor';
import { randomUuidV4 } from './uuid';

export interface SavedPostRow {
  id: string;
  globalPostId: string;
  savedByPubkey: Uint8Array;
  createdAt: number;
}

export interface SavedPostStoreDeps {
  readonly exec: SqlExecutor;
  readonly selfPubkey: Uint8Array;
  readonly enqueue: (op: SavedPostAddOp) => Promise<void>;
  readonly now?: () => Date;
}

function nowSec(deps: Pick<SavedPostStoreDeps, 'now'>): number {
  return Math.floor((deps.now ?? (() => new Date()))().getTime() / 1000);
}

interface RawSavedPostRow {
  id: string;
  global_post_id: string;
  saved_by_pubkey: Uint8Array | ArrayBufferLike;
  created_at: number;
}

function bytesFromRow(value: Uint8Array | ArrayBufferLike): Uint8Array {
  if (value instanceof Uint8Array) return value;
  return new Uint8Array(value as ArrayBufferLike);
}

function rowOf(row: RawSavedPostRow): SavedPostRow {
  return {
    id: row.id,
    globalPostId: row.global_post_id,
    savedByPubkey: bytesFromRow(row.saved_by_pubkey),
    createdAt: row.created_at,
  };
}

/** Rows I created (saved_by_pubkey = me). Powers the "SavedByYou" screen. */
export async function listSavedByMe(
  exec: SqlExecutor,
  selfPubkey: Uint8Array,
): Promise<SavedPostRow[]> {
  const rows = await exec.query<RawSavedPostRow>(
    `SELECT id, global_post_id, saved_by_pubkey, created_at
       FROM saved_post
      WHERE saved_by_pubkey = ?
      ORDER BY created_at DESC, id DESC`,
    [selfPubkey],
  );
  return rows.map(rowOf);
}

/** Have I (selfPubkey) already saved this global post? Used to keep the
 *  "Save" action idempotent on a double-tap. */
export async function findSavedFor(
  exec: SqlExecutor,
  selfPubkey: Uint8Array,
  globalPostId: string,
): Promise<SavedPostRow | null> {
  const rows = await exec.query<RawSavedPostRow>(
    `SELECT id, global_post_id, saved_by_pubkey, created_at
       FROM saved_post
      WHERE saved_by_pubkey = ? AND global_post_id = ?
      LIMIT 1`,
    [selfPubkey, globalPostId],
  );
  const row = rows[0];
  return row ? rowOf(row) : null;
}

/**
 * Save a public-feed post to my couple's saved bookmarks. Idempotent: a
 * repeat save of the same global post is a no-op. Writes the local row +
 * enqueues a `saved_post.add` op inside one transaction so a crash can't
 * leave one without the other.
 *
 * The `saved_for_pubkey` slot mirrors `saved_by_pubkey` for now — saves are
 * personal bookmarks, not "saved-for-the-partner" gifts. The column exists
 * for a future "save FOR partner" affordance.
 */
export async function saveGlobalPost(
  deps: SavedPostStoreDeps,
  globalPostId: string,
): Promise<SavedPostRow> {
  const existing = await findSavedFor(deps.exec, deps.selfPubkey, globalPostId);
  if (existing) return existing;
  const id = await randomUuidV4();
  const createdAt = nowSec(deps);
  await deps.exec.transaction(async () => {
    // Re-check inside the txn: a concurrent caller landing between the outer
    // find and the INSERT can mean we'd double-insert + double-enqueue.
    const fresh = await findSavedFor(deps.exec, deps.selfPubkey, globalPostId);
    if (fresh) return;
    await deps.exec.execute(
      `INSERT INTO saved_post (
         id, global_post_id, saved_by_pubkey, saved_for_pubkey, created_at
       ) VALUES (?, ?, ?, ?, ?)`,
      [id, globalPostId, deps.selfPubkey, deps.selfPubkey, createdAt],
    );
    await deps.enqueue({
      v: 1,
      kind: 'saved_post.add',
      id,
      globalPostId,
      savedByPubkey: bytesToHex(deps.selfPubkey),
      savedForPubkey: bytesToHex(deps.selfPubkey),
      createdAt,
    });
  });
  return (await findSavedFor(deps.exec, deps.selfPubkey, globalPostId)) as SavedPostRow;
}

/** Drop a saved-post row from this device. Local-only — there's no
 *  `saved_post.remove` op yet, so removing on this device does NOT propagate
 *  to the partner's mirror; in a single-device-per-partner world that's
 *  fine for a first cut. */
export async function removeSavedPost(exec: SqlExecutor, savedPostId: string): Promise<void> {
  await exec.execute(`DELETE FROM saved_post WHERE id = ?`, [savedPostId]);
}
