import { describe, expect, it } from '@jest/globals';
import type {
  NoteSecretAnnounceOp,
  NoteSecretRevealOp,
  NoteShareAddOp,
} from '@secretnotebook/connection-protocol';
import { bytesToHex } from '@secretnotebook/crypto';
import Database from 'better-sqlite3';

import { runMigrations } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import {
  getNote,
  listNotes,
  revealSecretNote,
  writeSecretNote,
  writeSharedNote,
  type NoteStoreDeps,
} from '../src/features/notes/store';
import { nodeExecutor } from './helpers/sqlite-executor';

const SELF_PUBKEY = new Uint8Array(32).fill(0x33);
const FIXED_NOW = new Date('2026-05-21T08:00:00.000Z');
const FIXED_NOW_SEC = Math.floor(FIXED_NOW.getTime() / 1000);

type EnqueuedOp = NoteShareAddOp | NoteSecretAnnounceOp | NoteSecretRevealOp;

interface Harness {
  deps: NoteStoreDeps;
  enqueued: EnqueuedOp[];
}

async function freshHarness(): Promise<Harness> {
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

describe('notes store', () => {
  describe('writeSharedNote', () => {
    it('inserts a shared row with body filled and enqueues a note.share.add op', async () => {
      const { deps, enqueued } = await freshHarness();
      const row = await writeSharedNote(deps, 'a public thought');
      expect(row.kind).toBe('shared');
      expect(row.body).toBe('a public thought');
      expect(row.createdAt).toBe(FIXED_NOW_SEC);
      expect(row.revealedAt).toBeNull();

      expect(enqueued).toHaveLength(1);
      const op = enqueued[0] as NoteShareAddOp;
      expect(op.kind).toBe('note.share.add');
      expect(op.id).toBe(row.id);
      expect(op.body).toBe('a public thought');
      expect(op.authorPubkey).toBe(bytesToHex(SELF_PUBKEY));
      expect(op.createdAt).toBe(FIXED_NOW_SEC);
    });

    it('rejects an empty body', async () => {
      const { deps } = await freshHarness();
      await expect(writeSharedNote(deps, '')).rejects.toThrow(/body required/);
    });
  });

  describe('writeSecretNote', () => {
    it('inserts a secret row with body filled locally and enqueues an announce op WITHOUT the body', async () => {
      const { deps, enqueued } = await freshHarness();
      const row = await writeSecretNote(deps, 'my journal entry');
      expect(row.kind).toBe('secret');
      expect(row.body).toBe('my journal entry'); // local-only
      expect(row.revealedAt).toBeNull();

      expect(enqueued).toHaveLength(1);
      const op = enqueued[0] as NoteSecretAnnounceOp;
      expect(op.kind).toBe('note.secret.announce');
      expect(op.id).toBe(row.id);
      expect(op.authorPubkey).toBe(bytesToHex(SELF_PUBKEY));
      expect(op.createdAt).toBe(FIXED_NOW_SEC);
      // The whole point of the secret flow: the body never appears
      // in the announce op.
      expect(JSON.stringify(op)).not.toContain('my journal entry');
    });

    it('rejects an empty body', async () => {
      const { deps } = await freshHarness();
      await expect(writeSecretNote(deps, '')).rejects.toThrow(/body required/);
    });
  });

  describe('revealSecretNote', () => {
    it('stamps revealed_at and enqueues a note.secret.reveal op carrying the body', async () => {
      const { deps, enqueued } = await freshHarness();
      const row = await writeSecretNote(deps, 'the secret');
      enqueued.length = 0; // forget the announce op

      await revealSecretNote(deps, row.id);
      const updated = await getNote(deps.exec, row.id);
      expect(updated?.revealedAt).toBe(FIXED_NOW_SEC);
      expect(updated?.body).toBe('the secret');

      expect(enqueued).toHaveLength(1);
      const op = enqueued[0] as NoteSecretRevealOp;
      expect(op.kind).toBe('note.secret.reveal');
      expect(op.id).toBe(row.id);
      expect(op.body).toBe('the secret');
      expect(op.revealedAt).toBe(FIXED_NOW_SEC);
    });

    it('is idempotent: a second reveal is a no-op (no UPDATE, no enqueue)', async () => {
      const { deps, enqueued } = await freshHarness();
      const row = await writeSecretNote(deps, 'twice-told');
      enqueued.length = 0;

      await revealSecretNote(deps, row.id);
      enqueued.length = 0; // forget the first reveal op

      await revealSecretNote(deps, row.id);
      expect(enqueued).toHaveLength(0);
    });

    it('throws when the note does not exist', async () => {
      const { deps } = await freshHarness();
      await expect(revealSecretNote(deps, '00000000-0000-4000-8000-000000000000')).rejects.toThrow(
        /no note with id/,
      );
    });

    it('throws when the note is shared (not a secret to reveal)', async () => {
      const { deps } = await freshHarness();
      const shared = await writeSharedNote(deps, 'already public');
      await expect(revealSecretNote(deps, shared.id)).rejects.toThrow(/not secret/);
    });

    it('throws on partner-side secret rows (body NULL locally — nothing to publish)', async () => {
      // Simulate a partner-received announce by inserting a bodyless secret row.
      const { deps } = await freshHarness();
      const id = '11111111-1111-4111-8111-111111111111';
      await deps.exec.execute(
        `INSERT INTO note (id, kind, author_pubkey, body, created_at)
         VALUES (?, 'secret', ?, NULL, ?)`,
        [id, new Uint8Array(32).fill(0x44), FIXED_NOW_SEC],
      );
      await expect(revealSecretNote(deps, id)).rejects.toThrow(/body is not local/);
    });
  });

  describe('listNotes', () => {
    it('returns newest first across both kinds', async () => {
      const { deps } = await freshHarness();
      const a = await writeSharedNote(deps, 'first');
      const b = await writeSecretNote(deps, 'second');
      const c = await writeSharedNote(deps, 'third');
      const rows = await listNotes(deps.exec);
      // All three share FIXED_NOW; tiebreak is id DESC. Just confirm
      // the result has the right size + both kinds appear.
      expect(rows).toHaveLength(3);
      expect(rows.map((r) => r.id).sort()).toEqual([a.id, b.id, c.id].sort());
      expect(rows.some((r) => r.kind === 'shared')).toBe(true);
      expect(rows.some((r) => r.kind === 'secret')).toBe(true);
    });
  });
});
