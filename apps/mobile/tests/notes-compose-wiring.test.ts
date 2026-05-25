import { describe, expect, it } from '@jest/globals';
import type {
  NotePublishOp,
  NoteSecretAnnounceOp,
  NoteSecretRevealOp,
  NoteShareAddOp,
} from '@secretnotebook/connection-protocol';
import Database from 'better-sqlite3';

import { runMigrations } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import { submitNoteCompose } from '../src/features/notes/compose-wiring';
import type { NoteStoreDeps } from '../src/features/notes/store';
import { nodeExecutor } from './helpers/sqlite-executor';

/**
 * The NotesCompose route hands `{ kind, body }` straight to
 * `submitNoteCompose`. These tests verify the dispatch + the
 * end-to-end side effects (row inserted, op enqueued with the
 * right kind) so the route file itself stays a thin pass-through.
 */
type EnqueuedOp = NoteShareAddOp | NoteSecretAnnounceOp | NoteSecretRevealOp | NotePublishOp;

const SELF_PUBKEY = new Uint8Array(32).fill(0x77);
const FIXED_NOW = new Date('2026-05-25T08:00:00.000Z');

async function freshDeps(): Promise<{ deps: NoteStoreDeps; enqueued: EnqueuedOp[] }> {
  const db = new Database(':memory:');
  const exec = nodeExecutor(db);
  await runMigrations(exec, MIGRATIONS);
  const enqueued: EnqueuedOp[] = [];
  const deps: NoteStoreDeps = {
    exec,
    selfPubkey: SELF_PUBKEY,
    now: () => FIXED_NOW,
    enqueue: async (op) => {
      enqueued.push(op);
    },
  };
  return { deps, enqueued };
}

describe('submitNoteCompose', () => {
  it('routes kind=shared to writeSharedNote (body lands on the wire)', async () => {
    const { deps, enqueued } = await freshDeps();
    const row = await submitNoteCompose(deps, 'shared', 'hello partner');
    expect(row.kind).toBe('shared');
    expect(row.body).toBe('hello partner');
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]?.kind).toBe('note.share.add');
    // Shared notes include the body in the announce op.
    expect((enqueued[0] as NoteShareAddOp).body).toBe('hello partner');
  });

  it('routes kind=secret to writeSecretNote (body stays local)', async () => {
    const { deps, enqueued } = await freshDeps();
    const row = await submitNoteCompose(deps, 'secret', 'just for me until I reveal');
    expect(row.kind).toBe('secret');
    expect(row.body).toBe('just for me until I reveal');
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]?.kind).toBe('note.secret.announce');
    // Secret announce op MUST NOT carry the body.
    expect(enqueued[0] as object).not.toHaveProperty('body');
  });

  it('rejects empty bodies for both kinds (NotesCompose surfaces this)', async () => {
    const { deps } = await freshDeps();
    await expect(submitNoteCompose(deps, 'shared', '')).rejects.toThrow(/body required/);
    await expect(submitNoteCompose(deps, 'secret', '')).rejects.toThrow(/body required/);
  });
});
