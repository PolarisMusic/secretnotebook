import type { SqlExecutor } from '../../db/executor';

export interface RoleplaySessionRow {
  id: string;
  enactorPubkey: Uint8Array;
  curatorPubkey: Uint8Array;
  savedPostId: string | null;
  rating: number | null;
  startedAt: number;
  gratitudePromptKey: string | null;
  gratitudePromptTitle: string | null;
  gratitudePromptBody: string | null;
  gratitudeEnactorDoneAt: number | null;
  gratitudeCuratorDoneAt: number | null;
  endedAt: number | null;
}

interface RawRow {
  id: string;
  enactor_pubkey: Uint8Array | ArrayBufferLike;
  curator_pubkey: Uint8Array | ArrayBufferLike;
  saved_post_id: string | null;
  rating: number | null;
  started_at: number;
  gratitude_prompt_id: string | null;
  gratitude_prompt_title: string | null;
  gratitude_prompt_body: string | null;
  gratitude_enactor_done_at: number | null;
  gratitude_curator_done_at: number | null;
  ended_at: number | null;
}

function bytesFromRow(value: Uint8Array | ArrayBufferLike): Uint8Array {
  if (value instanceof Uint8Array) return value;
  return new Uint8Array(value as ArrayBufferLike);
}

function rowOf(r: RawRow): RoleplaySessionRow {
  return {
    id: r.id,
    enactorPubkey: bytesFromRow(r.enactor_pubkey),
    curatorPubkey: bytesFromRow(r.curator_pubkey),
    savedPostId: r.saved_post_id,
    rating: r.rating,
    startedAt: r.started_at,
    gratitudePromptKey: r.gratitude_prompt_id,
    gratitudePromptTitle: r.gratitude_prompt_title,
    gratitudePromptBody: r.gratitude_prompt_body,
    gratitudeEnactorDoneAt: r.gratitude_enactor_done_at,
    gratitudeCuratorDoneAt: r.gratitude_curator_done_at,
    endedAt: r.ended_at,
  };
}

const COLUMNS = `id, enactor_pubkey, curator_pubkey, saved_post_id, rating,
                 started_at, gratitude_prompt_id, gratitude_prompt_title,
                 gratitude_prompt_body, gratitude_enactor_done_at,
                 gratitude_curator_done_at, ended_at`;

export async function findRoleplaySession(
  exec: SqlExecutor,
  id: string,
): Promise<RoleplaySessionRow | null> {
  const rows = await exec.query<RawRow>(
    `SELECT ${COLUMNS} FROM roleplay_session WHERE id = ? LIMIT 1`,
    [id],
  );
  return rows[0] ? rowOf(rows[0]) : null;
}

/**
 * Find a session for a given unlocked saved_post (idempotency helper —
 * the entry-point "I tried it" action uses this to avoid creating a
 * second session for the same post).
 */
export async function findRoleplayBySavedPostId(
  exec: SqlExecutor,
  savedPostId: string,
): Promise<RoleplaySessionRow | null> {
  const rows = await exec.query<RawRow>(
    `SELECT ${COLUMNS} FROM roleplay_session WHERE saved_post_id = ? LIMIT 1`,
    [savedPostId],
  );
  return rows[0] ? rowOf(rows[0]) : null;
}

/** Sessions where I'm either side AND something is still pending. */
export async function listOpenRoleplaySessionsFor(
  exec: SqlExecutor,
  selfPubkey: Uint8Array,
): Promise<RoleplaySessionRow[]> {
  const rows = await exec.query<RawRow>(
    `SELECT ${COLUMNS} FROM roleplay_session
      WHERE (enactor_pubkey = ? OR curator_pubkey = ?)
        AND (gratitude_enactor_done_at IS NULL
             OR gratitude_curator_done_at IS NULL)
      ORDER BY started_at DESC, ROWID DESC`,
    [selfPubkey, selfPubkey],
  );
  return rows.map(rowOf);
}

/** Has the gratitude loop completed (both done_at columns set)? */
export function isRoleplayLoopComplete(row: RoleplaySessionRow): boolean {
  return row.gratitudeEnactorDoneAt != null && row.gratitudeCuratorDoneAt != null;
}
