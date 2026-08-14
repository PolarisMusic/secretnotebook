import { describe, expect, it } from '@jest/globals';
import { bytesToHex } from '@secretnotebook/crypto';
import Database from 'better-sqlite3';

import { runMigrations } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import type { SqlExecutor } from '../src/db/executor';
import {
  countPendingNotes,
  discardPendingNote,
  getPendingNote,
  listPendingNotes,
  sharePendingNote,
  updatePendingNote,
  writePendingNote,
} from '../src/features/notes/pending-store';
import { getNote, type NoteStoreDeps } from '../src/features/notes/store';
import { nodeExecutor } from './helpers/sqlite-executor';

const SELF = new Uint8Array(32).fill(0x11);

interface Harness {
  exec: SqlExecutor;
  deps: NoteStoreDeps;
  enqueued: Array<{ kind: string; [k: string]: unknown }>;
}

async function freshHarness(): Promise<Harness> {
  const db = new Database(':memory:');
  const exec = nodeExecutor(db);
  await runMigrations(exec, MIGRATIONS);
  const enqueued: Array<{ kind: string; [k: string]: unknown }> = [];
  const deps: NoteStoreDeps = {
    exec,
    selfPubkey: SELF,
    enqueue: async (op) => {
      enqueued.push(op as unknown as { kind: string });
    },
  };
  return { exec, deps, enqueued };
}

describe('pending-note store', () => {
  it('writes, lists, counts, and trims a draft', async () => {
    const { exec } = await freshHarness();
    const a = await writePendingNote(exec, { kind: 'shared', body: '  hi  ' });
    expect(a.body).toBe('hi');
    await writePendingNote(exec, { kind: 'secret', body: 'secret draft' });
    expect(await countPendingNotes(exec)).toBe(2);
    const kinds = (await listPendingNotes(exec)).map((n) => n.kind).sort();
    expect(kinds).toEqual(['secret', 'shared']);
  });

  it('rejects an empty draft body', async () => {
    const { exec } = await freshHarness();
    await expect(writePendingNote(exec, { kind: 'shared', body: '   ' })).rejects.toThrow(
      /body required/,
    );
  });

  it('stores and returns an optional title (trimmed), null when absent', async () => {
    const { exec } = await freshHarness();
    const titled = await writePendingNote(exec, {
      kind: 'shared',
      body: 'b',
      title: '  My draft  ',
    });
    expect(titled.title).toBe('My draft');
    const untitled = await writePendingNote(exec, { kind: 'secret', body: 'b2' });
    expect(untitled.title).toBeNull();
    const reloaded = await getPendingNote(exec, titled.id);
    expect(reloaded?.title).toBe('My draft');
  });

  it('updates a draft in place (kind, title, body)', async () => {
    const { exec } = await freshHarness();
    const d = await writePendingNote(exec, { kind: 'shared', body: 'first', title: 'T1' });
    await updatePendingNote(exec, d.id, { kind: 'secret', body: 'second', title: 'T2' });
    const reloaded = await getPendingNote(exec, d.id);
    expect(reloaded).toMatchObject({ kind: 'secret', body: 'second', title: 'T2' });
    // Clearing the title writes NULL.
    await updatePendingNote(exec, d.id, { kind: 'secret', body: 'second' });
    expect((await getPendingNote(exec, d.id))?.title).toBeNull();
  });

  it('carries the emoji tag through write, update, and share', async () => {
    const { exec, deps, enqueued } = await freshHarness();
    const d = await writePendingNote(exec, { kind: 'shared', body: 'b', emoji: '❤️🔥' });
    expect(d.emoji).toBe('❤️🔥');
    await updatePendingNote(exec, d.id, { kind: 'shared', body: 'b', emoji: '✨' });
    expect((await getPendingNote(exec, d.id))?.emoji).toBe('✨');
    const note = await sharePendingNote(deps, d.id);
    expect(note.emoji).toBe('✨');
    expect(enqueued.at(-1)).toMatchObject({ kind: 'note.share.add', emoji: '✨' });
  });

  it('sends a secret draft emoji on the announce — it is the locked-note hint', async () => {
    const { exec, deps, enqueued } = await freshHarness();
    const d = await writePendingNote(exec, { kind: 'secret', body: 'shh', emoji: '🤫' });
    const note = await sharePendingNote(deps, d.id);
    expect(note.emoji).toBe('🤫');
    const op = enqueued.at(-1) as Record<string, unknown>;
    expect(op.kind).toBe('note.secret.announce');
    // The hint rides along, but the substance still does not.
    expect(op.emoji).toBe('🤫');
    expect(op.body).toBeUndefined();
    expect(op.title).toBeUndefined();
  });

  it('carries the title when sharing a shared draft', async () => {
    const { exec, deps, enqueued } = await freshHarness();
    const draft = await writePendingNote(exec, { kind: 'shared', body: 'hi', title: 'Greeting' });
    const note = await sharePendingNote(deps, draft.id);
    expect(note.title).toBe('Greeting');
    expect(enqueued.at(-1)).toMatchObject({ kind: 'note.share.add', title: 'Greeting' });
  });

  it('keeps a secret draft title local — never on the announce op', async () => {
    const { exec, deps, enqueued } = await freshHarness();
    const draft = await writePendingNote(exec, { kind: 'secret', body: 'hi', title: 'Hidden' });
    const note = await sharePendingNote(deps, draft.id);
    // Local row keeps the title so the author sees it…
    expect(note.title).toBe('Hidden');
    // …but the wire op announces existence only.
    const op = enqueued.at(-1) as Record<string, unknown>;
    expect(op.kind).toBe('note.secret.announce');
    expect(op.title).toBeUndefined();
  });

  it('shares a shared draft: it becomes a note and announces with its body', async () => {
    const { exec, deps, enqueued } = await freshHarness();
    const draft = await writePendingNote(exec, { kind: 'shared', body: 'for both of us' });
    const note = await sharePendingNote(deps, draft.id);

    expect(note.kind).toBe('shared');
    expect(note.body).toBe('for both of us');
    expect(bytesToHex(note.authorPubkey)).toBe(bytesToHex(SELF));
    expect(enqueued.at(-1)).toMatchObject({
      kind: 'note.share.add',
      id: note.id,
      body: 'for both of us',
    });
    expect(await countPendingNotes(exec)).toBe(0);
    expect(await getNote(exec, note.id)).not.toBeNull();
  });

  it('shares a secret draft: body stays local, the op only announces existence', async () => {
    const { exec, deps, enqueued } = await freshHarness();
    const draft = await writePendingNote(exec, { kind: 'secret', body: 'just mine' });
    const note = await sharePendingNote(deps, draft.id);

    expect(note.kind).toBe('secret');
    expect(note.body).toBe('just mine');
    const op = enqueued.at(-1) as Record<string, unknown>;
    expect(op.kind).toBe('note.secret.announce');
    expect(op.body).toBeUndefined();
    expect(await countPendingNotes(exec)).toBe(0);
  });

  it('discards a draft', async () => {
    const { exec } = await freshHarness();
    const draft = await writePendingNote(exec, { kind: 'shared', body: 'nope' });
    await discardPendingNote(exec, draft.id);
    expect(await countPendingNotes(exec)).toBe(0);
  });
});
