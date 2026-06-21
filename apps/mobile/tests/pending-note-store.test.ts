import { describe, expect, it } from '@jest/globals';
import { bytesToHex } from '@secretnotebook/crypto';
import Database from 'better-sqlite3';

import { runMigrations } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import type { SqlExecutor } from '../src/db/executor';
import {
  countPendingNotes,
  discardPendingNote,
  listPendingNotes,
  sharePendingNote,
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
