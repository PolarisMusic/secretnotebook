import type {
  NoteSecretAnnounceOp,
  NoteSecretRevealOp,
  NoteShareAddOp,
} from '@secretnotebook/connection-protocol';
import { bytesToHex } from '@secretnotebook/crypto';

import type { SqlExecutor } from '../../db/executor';
import { randomUuidV4 } from '../connection-channel/uuid';

export type NoteKind = 'shared' | 'secret';

export interface NoteRow {
  id: string;
  kind: NoteKind;
  authorPubkey: Uint8Array;
  /** NULL for secret notes that have been announced but not yet
   *  revealed to this device. Always non-NULL for shared notes and
   *  for the author's own secrets. */
  body: string | null;
  createdAt: number;
  /** Set once a reveal op has been applied. Stays NULL on the
   *  author's local row until they call revealSecretNote(). */
  revealedAt: number | null;
}

interface RawNoteRow {
  id: string;
  kind: NoteKind;
  author_pubkey: Uint8Array | ArrayBufferLike;
  body: string | null;
  created_at: number;
  revealed_at: number | null;
}

function bytesFromRow(value: Uint8Array | ArrayBufferLike): Uint8Array {
  if (value instanceof Uint8Array) return value;
  return new Uint8Array(value as ArrayBufferLike);
}

function rowOf(r: RawNoteRow): NoteRow {
  return {
    id: r.id,
    kind: r.kind,
    authorPubkey: bytesFromRow(r.author_pubkey),
    body: r.body,
    createdAt: r.created_at,
    revealedAt: r.revealed_at,
  };
}

/**
 * Anything the note store needs from the host: SQL access for the
 * local row, the author's pubkey to stamp the op with, an enqueue
 * function to push it onto the sync outbox, and a clock so tests
 * can pin createdAt.
 *
 * Kept narrower than `SyncEngine` so the store doesn't pick up an
 * incidental dependency on flush/pull — anything that satisfies
 * `enqueue` will do, including a noop spy for unit tests.
 */
export interface NoteStoreDeps {
  readonly exec: SqlExecutor;
  readonly selfPubkey: Uint8Array;
  readonly enqueue: (
    op: NoteShareAddOp | NoteSecretAnnounceOp | NoteSecretRevealOp,
  ) => Promise<void>;
  readonly now?: () => Date;
}

function nowSec(deps: NoteStoreDeps): number {
  return Math.floor((deps.now ?? (() => new Date()))().getTime() / 1000);
}

async function getNoteInternal(exec: SqlExecutor, id: string): Promise<NoteRow | null> {
  const rows = await exec.query<RawNoteRow>(
    `SELECT id, kind, author_pubkey, body, created_at, revealed_at
       FROM note
      WHERE id = ?`,
    [id],
  );
  const row = rows[0];
  return row ? rowOf(row) : null;
}

/**
 * Create a shared note. Body travels with the announce op so the
 * partner sees the substance as soon as the op is applied.
 *
 * Local row is written + outbox op enqueued inside one transaction
 * so a crash between the two can't leave a row the partner will
 * never hear about (or vice versa: an op for a row that doesn't
 * exist locally).
 */
export async function writeSharedNote(deps: NoteStoreDeps, body: string): Promise<NoteRow> {
  if (body.length === 0) throw new Error('writeSharedNote: body required');
  const id = await randomUuidV4();
  const createdAt = nowSec(deps);
  await deps.exec.transaction(async () => {
    await deps.exec.execute(
      `INSERT INTO note (id, kind, author_pubkey, body, created_at)
       VALUES (?, 'shared', ?, ?, ?)`,
      [id, deps.selfPubkey, body, createdAt],
    );
    await deps.enqueue({
      v: 1,
      kind: 'note.share.add',
      id,
      authorPubkey: bytesToHex(deps.selfPubkey),
      body,
      createdAt,
    });
  });
  // Row was just inserted; cast away the null.
  return (await getNoteInternal(deps.exec, id)) as NoteRow;
}

/**
 * Create a secret note. Body lands in the LOCAL row immediately
 * (author always knows their own secret) but the outgoing op only
 * announces existence — id, author, createdAt. The body stays off
 * the wire until the author calls revealSecretNote().
 *
 * Same transaction story as writeSharedNote.
 */
export async function writeSecretNote(deps: NoteStoreDeps, body: string): Promise<NoteRow> {
  if (body.length === 0) throw new Error('writeSecretNote: body required');
  const id = await randomUuidV4();
  const createdAt = nowSec(deps);
  await deps.exec.transaction(async () => {
    await deps.exec.execute(
      `INSERT INTO note (id, kind, author_pubkey, body, created_at)
       VALUES (?, 'secret', ?, ?, ?)`,
      [id, deps.selfPubkey, body, createdAt],
    );
    await deps.enqueue({
      v: 1,
      kind: 'note.secret.announce',
      id,
      authorPubkey: bytesToHex(deps.selfPubkey),
      createdAt,
    });
  });
  return (await getNoteInternal(deps.exec, id)) as NoteRow;
}

/**
 * Publish the body of a previously-announced secret note. Only the
 * author can call this meaningfully — if the local row's body is
 * NULL (partner-side, pre-reveal), there's nothing to publish and
 * the call throws.
 *
 * Idempotent: a second call on an already-revealed row is a no-op
 * (no UPDATE, no enqueue). That matters because UI surfaces can
 * fire the action twice on a slow connection without flooding the
 * outbox with redundant reveal ops.
 */
export async function revealSecretNote(deps: NoteStoreDeps, id: string): Promise<void> {
  const row = await getNoteInternal(deps.exec, id);
  if (!row) throw new Error(`revealSecretNote: no note with id ${id}`);
  if (row.kind !== 'secret') throw new Error(`revealSecretNote: note ${id} is not secret`);
  if (row.body == null) {
    throw new Error(`revealSecretNote: cannot reveal a note whose body is not local`);
  }
  if (row.revealedAt != null) return; // already revealed → idempotent no-op
  const revealedAt = nowSec(deps);
  await deps.exec.transaction(async () => {
    await deps.exec.execute(
      `UPDATE note SET revealed_at = ? WHERE id = ? AND revealed_at IS NULL`,
      [revealedAt, id],
    );
    await deps.enqueue({
      v: 1,
      kind: 'note.secret.reveal',
      id,
      body: row.body as string,
      revealedAt,
    });
  });
}

/** Newest first, both kinds. Powers the (forthcoming) Notes screen. */
export async function listNotes(exec: SqlExecutor): Promise<NoteRow[]> {
  const rows = await exec.query<RawNoteRow>(
    `SELECT id, kind, author_pubkey, body, created_at, revealed_at
       FROM note
      ORDER BY created_at DESC, id DESC`,
  );
  return rows.map(rowOf);
}

export async function getNote(exec: SqlExecutor, id: string): Promise<NoteRow | null> {
  return getNoteInternal(exec, id);
}
