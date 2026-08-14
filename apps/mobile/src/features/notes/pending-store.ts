import type { NoteSecretAnnounceOp, NoteShareAddOp } from '@secretnotebook/connection-protocol';
import { bytesToHex } from '@secretnotebook/crypto';

import type { SqlExecutor } from '../../db/executor';
import { randomUuidV4 } from '../connection-channel/uuid';
import { getNote, type NoteKind, type NoteRow, type NoteStoreDeps } from './store';

/**
 * Pre-pairing draft notes (item I). Authored with no connection yet — no
 * couple identity and no sync. On first pairing the user triages each draft:
 * `sharePendingNote` promotes it into the couple's notes, or it's exported
 * (see notes/export.ts) and dropped with `discardPendingNote`.
 */

export interface PendingNoteRow {
  id: string;
  kind: NoteKind;
  title: string | null;
  emoji: string | null;
  body: string;
  createdAt: number;
}

interface RawPendingNoteRow {
  id: string;
  kind: NoteKind;
  title: string | null;
  emoji: string | null;
  body: string;
  created_at: number;
}

function rowOf(r: RawPendingNoteRow): PendingNoteRow {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    emoji: r.emoji,
    body: r.body,
    createdAt: r.created_at,
  };
}

function nowSec(now?: () => Date): number {
  return Math.floor((now ?? (() => new Date()))().getTime() / 1000);
}

/** Author a draft note with no partner yet. Text-only (no identity, no sync).
 *  An optional short title is stored alongside the body. */
export async function writePendingNote(
  exec: SqlExecutor,
  input: { kind: NoteKind; body: string; title?: string; emoji?: string },
  now?: () => Date,
): Promise<PendingNoteRow> {
  const body = input.body.trim();
  if (body.length === 0) throw new Error('writePendingNote: body required');
  const title = input.title?.trim();
  const hasTitle = title != null && title.length > 0;
  const emoji = input.emoji?.trim();
  const hasEmoji = emoji != null && emoji.length > 0;
  const id = await randomUuidV4();
  const createdAt = nowSec(now);
  await exec.execute(
    `INSERT INTO pending_note (id, kind, title, emoji, body, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, input.kind, hasTitle ? title : null, hasEmoji ? emoji : null, body, createdAt],
  );
  return {
    id,
    kind: input.kind,
    title: hasTitle ? title : null,
    emoji: hasEmoji ? emoji : null,
    body,
    createdAt,
  };
}

/** Update a draft in place (used by the "Edit draft" flow). Device-local, no
 *  sync impact. Leaves created_at untouched so the draft keeps its position. */
export async function updatePendingNote(
  exec: SqlExecutor,
  id: string,
  input: { kind: NoteKind; body: string; title?: string; emoji?: string },
): Promise<void> {
  const body = input.body.trim();
  if (body.length === 0) throw new Error('updatePendingNote: body required');
  const title = input.title?.trim();
  const hasTitle = title != null && title.length > 0;
  const emoji = input.emoji?.trim();
  const hasEmoji = emoji != null && emoji.length > 0;
  await exec.execute(
    `UPDATE pending_note SET kind = ?, title = ?, emoji = ?, body = ? WHERE id = ?`,
    [input.kind, hasTitle ? title : null, hasEmoji ? emoji : null, body, id],
  );
}

export async function getPendingNote(
  exec: SqlExecutor,
  id: string,
): Promise<PendingNoteRow | null> {
  const rows = await exec.query<RawPendingNoteRow>(
    `SELECT id, kind, title, emoji, body, created_at FROM pending_note WHERE id = ?`,
    [id],
  );
  const row = rows[0];
  return row ? rowOf(row) : null;
}

/** All drafts, newest first — powers the first-connection triage list. */
export async function listPendingNotes(exec: SqlExecutor): Promise<PendingNoteRow[]> {
  const rows = await exec.query<RawPendingNoteRow>(
    `SELECT id, kind, title, emoji, body, created_at FROM pending_note ORDER BY created_at DESC, id DESC`,
  );
  return rows.map(rowOf);
}

export async function countPendingNotes(exec: SqlExecutor): Promise<number> {
  const rows = await exec.query<{ n: number }>(`SELECT COUNT(*) AS n FROM pending_note`);
  return rows[0]?.n ?? 0;
}

/** Drop a draft — used after it's been archived/exported, or to delete one. */
export async function discardPendingNote(exec: SqlExecutor, id: string): Promise<void> {
  await exec.execute(`DELETE FROM pending_note WHERE id = ?`, [id]);
}

/**
 * Promote a draft into the couple's notes once paired: stamp it with the
 * couple identity, enqueue the normal share/announce op, and drop the draft —
 * all in one transaction so a crash can't leave the note both shared and
 * pending. Mirrors writeSharedNote / writeSecretNote: a 'secret' keeps its
 * body local and only announces existence over the wire.
 */
export async function sharePendingNote(deps: NoteStoreDeps, id: string): Promise<NoteRow> {
  const pending = await getPendingNote(deps.exec, id);
  if (!pending) throw new Error(`sharePendingNote: no pending note ${id}`);
  const { kind, title, emoji, body, createdAt } = pending;
  const hasTitle = title != null && title.length > 0;
  const hasEmoji = emoji != null && emoji.length > 0;
  const noteId = await randomUuidV4();
  await deps.exec.transaction(async () => {
    await deps.exec.execute(
      `INSERT INTO note (id, kind, author_pubkey, title, emoji, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        noteId,
        kind,
        deps.selfPubkey,
        hasTitle ? title : null,
        hasEmoji ? emoji : null,
        body,
        createdAt,
      ],
    );
    if (kind === 'shared') {
      // Shared: title + body travel with the note, same as writeSharedNote.
      const op: NoteShareAddOp = {
        v: 1,
        kind: 'note.share.add',
        id: noteId,
        authorPubkey: bytesToHex(deps.selfPubkey),
        ...(hasTitle ? { title } : {}),
        ...(hasEmoji ? { emoji } : {}),
        body,
        createdAt,
      };
      await deps.enqueue(op);
    } else {
      // Secret: substance (title + body) stays local until reveal; the
      // announce op carries existence only.
      const op: NoteSecretAnnounceOp = {
        v: 1,
        kind: 'note.secret.announce',
        id: noteId,
        authorPubkey: bytesToHex(deps.selfPubkey),
        ...(hasEmoji ? { emoji } : {}),
        createdAt,
      };
      await deps.enqueue(op);
    }
    await deps.exec.execute(`DELETE FROM pending_note WHERE id = ?`, [id]);
  });
  return (await getNote(deps.exec, noteId)) as NoteRow;
}
