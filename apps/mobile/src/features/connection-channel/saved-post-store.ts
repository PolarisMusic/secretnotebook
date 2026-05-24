import type { SqlExecutor } from '../../db/executor';

export interface SavedPostRow {
  id: string;
  globalPostId: string;
  savedByPubkey: Uint8Array;
  createdAt: number;
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
