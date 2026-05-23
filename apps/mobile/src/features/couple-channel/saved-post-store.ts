import type { SqlExecutor } from '../../db/executor';

export interface SavedPostRow {
  id: string;
  globalPostId: string;
  savedByPubkey: Uint8Array;
  savedForPubkey: Uint8Array;
  createdAt: number;
  unlockedAt: number | null;
  unlockPromptId: string | null;
}

interface RawSavedPostRow {
  id: string;
  global_post_id: string;
  saved_by_pubkey: Uint8Array | ArrayBufferLike;
  saved_for_pubkey: Uint8Array | ArrayBufferLike;
  created_at: number;
  unlocked_at: number | null;
  unlock_prompt_id: string | null;
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
    savedForPubkey: bytesFromRow(row.saved_for_pubkey),
    createdAt: row.created_at,
    unlockedAt: row.unlocked_at,
    unlockPromptId: row.unlock_prompt_id,
  };
}

/** Rows I created (saved_by_pubkey = me). Powers the "SavedByYou" screen. */
export async function listSavedByMe(
  exec: SqlExecutor,
  selfPubkey: Uint8Array,
): Promise<SavedPostRow[]> {
  const rows = await exec.query<RawSavedPostRow>(
    `SELECT id, global_post_id, saved_by_pubkey, saved_for_pubkey,
            created_at, unlocked_at, unlock_prompt_id
       FROM saved_post
      WHERE saved_by_pubkey = ?
      ORDER BY created_at DESC, id DESC`,
    [selfPubkey],
  );
  return rows.map(rowOf);
}

/** Rows my partner saved for me (saved_for_pubkey = me). */
export async function listSavedForMe(
  exec: SqlExecutor,
  selfPubkey: Uint8Array,
): Promise<SavedPostRow[]> {
  const rows = await exec.query<RawSavedPostRow>(
    `SELECT id, global_post_id, saved_by_pubkey, saved_for_pubkey,
            created_at, unlocked_at, unlock_prompt_id
       FROM saved_post
      WHERE saved_for_pubkey = ?
      ORDER BY created_at DESC, id DESC`,
    [selfPubkey],
  );
  return rows.map(rowOf);
}

export interface SavedForMeSummary {
  total: number;
  locked: number;
  unlocked: number;
}

/**
 * Counts only — the spec for Phase-1 SavedForYou says "locked-count
 * tile only — actual post hidden until unlocked", so a count helper is
 * what the route needs. SavedByYou uses listSavedByMe directly.
 */
export async function summariseSavedForMe(
  exec: SqlExecutor,
  selfPubkey: Uint8Array,
): Promise<SavedForMeSummary> {
  const rows = await exec.query<{ total: number; unlocked: number }>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN unlocked_at IS NOT NULL THEN 1 ELSE 0 END) AS unlocked
       FROM saved_post WHERE saved_for_pubkey = ?`,
    [selfPubkey],
  );
  const row = rows[0];
  const total = row?.total ?? 0;
  const unlocked = row?.unlocked ?? 0;
  return { total, locked: total - unlocked, unlocked };
}

/**
 * Rows my partner saved for me AND are now unlocked. Powers the S7
 * "browse unlocked" list. Newest-unlock first.
 */
export async function listUnlockedForMe(
  exec: SqlExecutor,
  selfPubkey: Uint8Array,
): Promise<SavedPostRow[]> {
  const rows = await exec.query<RawSavedPostRow>(
    `SELECT id, global_post_id, saved_by_pubkey, saved_for_pubkey,
            created_at, unlocked_at, unlock_prompt_id
       FROM saved_post
      WHERE saved_for_pubkey = ? AND unlocked_at IS NOT NULL
      ORDER BY unlocked_at DESC, id DESC`,
    [selfPubkey],
  );
  return rows.map(rowOf);
}
