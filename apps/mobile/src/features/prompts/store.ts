import type { SqlExecutor } from '../../db/executor';

export type PromptState = 'assigned' | 'completed' | 'certified' | 'expired';

export interface PromptRow {
  id: string;
  libraryKey: string;
  title: string;
  body: string;
  assignedToPubkey: Uint8Array;
  assignedByPubkey: Uint8Array;
  state: PromptState;
  completedAt: number | null;
  certifiedAt: number | null;
}

interface RawPromptRow {
  id: string;
  library_key: string;
  title: string;
  body: string;
  assigned_to_pubkey: Uint8Array | ArrayBufferLike;
  assigned_by_pubkey: Uint8Array | ArrayBufferLike;
  state: string;
  completed_at: number | null;
  certified_at: number | null;
}

function bytesFromRow(value: Uint8Array | ArrayBufferLike): Uint8Array {
  if (value instanceof Uint8Array) return value;
  return new Uint8Array(value as ArrayBufferLike);
}

function rowOf(r: RawPromptRow): PromptRow {
  return {
    id: r.id,
    libraryKey: r.library_key,
    title: r.title,
    body: r.body,
    assignedToPubkey: bytesFromRow(r.assigned_to_pubkey),
    assignedByPubkey: bytesFromRow(r.assigned_by_pubkey),
    state: r.state as PromptState,
    completedAt: r.completed_at,
    certifiedAt: r.certified_at,
  };
}

const COLUMNS = `id, library_key, title, body,
                 assigned_to_pubkey, assigned_by_pubkey, state,
                 completed_at, certified_at`;

/** Prompts assigned TO me that I still need to act on (state='assigned'). */
export async function listMyActivePrompts(
  exec: SqlExecutor,
  selfPubkey: Uint8Array,
): Promise<PromptRow[]> {
  const rows = await exec.query<RawPromptRow>(
    `SELECT ${COLUMNS} FROM prompt
      WHERE assigned_to_pubkey = ? AND state = 'assigned'
      ORDER BY ROWID DESC`,
    [selfPubkey],
  );
  return rows.map(rowOf);
}

/** Prompts my partner completed and is waiting for me to certify. */
export async function listAwaitingMyCertification(
  exec: SqlExecutor,
  selfPubkey: Uint8Array,
): Promise<PromptRow[]> {
  const rows = await exec.query<RawPromptRow>(
    `SELECT ${COLUMNS} FROM prompt
      WHERE assigned_to_pubkey != ? AND state = 'completed'
      ORDER BY completed_at DESC, ROWID DESC`,
    [selfPubkey],
  );
  return rows.map(rowOf);
}

export async function findPromptById(exec: SqlExecutor, id: string): Promise<PromptRow | null> {
  const rows = await exec.query<RawPromptRow>(
    `SELECT ${COLUMNS} FROM prompt WHERE id = ? LIMIT 1`,
    [id],
  );
  return rows[0] ? rowOf(rows[0]) : null;
}

export interface PromptCounts {
  assignedToMe: number;
  awaitingMyCertification: number;
  certifiedTotal: number;
}

/** Small summary for the couple-home / nav badge. */
export async function summarisePromptsFor(
  exec: SqlExecutor,
  selfPubkey: Uint8Array,
): Promise<PromptCounts> {
  const [assigned, awaiting, certified] = await Promise.all([
    exec.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM prompt
        WHERE assigned_to_pubkey = ? AND state = 'assigned'`,
      [selfPubkey],
    ),
    exec.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM prompt
        WHERE assigned_to_pubkey != ? AND state = 'completed'`,
      [selfPubkey],
    ),
    exec.query<{ n: number }>(`SELECT COUNT(*) AS n FROM prompt WHERE state = 'certified'`),
  ]);
  return {
    assignedToMe: assigned[0]?.n ?? 0,
    awaitingMyCertification: awaiting[0]?.n ?? 0,
    certifiedTotal: certified[0]?.n ?? 0,
  };
}
