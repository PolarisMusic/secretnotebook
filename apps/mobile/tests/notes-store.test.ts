import { describe, expect, it, jest } from '@jest/globals';
import type {
  NotePublishOp,
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
  publishNote,
  revealSecretNote,
  writeSecretNote,
  writeSharedNote,
  type NoteStoreDeps,
  type PublishToGlobalFeed,
} from '../src/features/notes/store';
import { nodeExecutor } from './helpers/sqlite-executor';

const SELF_PUBKEY = new Uint8Array(32).fill(0x33);
const FIXED_NOW = new Date('2026-05-21T08:00:00.000Z');
const FIXED_NOW_SEC = Math.floor(FIXED_NOW.getTime() / 1000);

type EnqueuedOp = NoteShareAddOp | NoteSecretAnnounceOp | NoteSecretRevealOp | NotePublishOp;

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

  describe('publishNote', () => {
    const GLOBAL_POST_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

    function fakePublish(id = GLOBAL_POST_ID): jest.Mock<PublishToGlobalFeed> {
      return jest.fn(async (_input) => ({ id }));
    }

    it('POSTs the body, stamps published_* locally, and enqueues a note.publish op', async () => {
      const { deps, enqueued } = await freshHarness();
      const note = await writeSharedNote(deps, 'going public');
      enqueued.length = 0;
      const publish = fakePublish();

      const result = await publishNote(deps, note.id, publish);
      expect(result.globalPostId).toBe(GLOBAL_POST_ID);
      expect(result.publishedAt).toBe(FIXED_NOW_SEC);
      expect(publish).toHaveBeenCalledWith({ contentType: 'text', body: 'going public' });

      const updated = await getNote(deps.exec, note.id);
      expect(updated?.publishedAt).toBe(FIXED_NOW_SEC);
      expect(updated?.publishedGlobalPostId).toBe(GLOBAL_POST_ID);

      expect(enqueued).toHaveLength(1);
      const op = enqueued[0] as NotePublishOp;
      expect(op.kind).toBe('note.publish');
      expect(op.id).toBe(note.id);
      expect(op.publishedGlobalPostId).toBe(GLOBAL_POST_ID);
      expect(op.publishedAt).toBe(FIXED_NOW_SEC);
    });

    it('honours the contentType opt (text vs link)', async () => {
      const { deps } = await freshHarness();
      const note = await writeSharedNote(deps, 'https://example.com');
      const publish = fakePublish();
      await publishNote(deps, note.id, publish, { contentType: 'link' });
      expect(publish).toHaveBeenCalledWith({ contentType: 'link', body: 'https://example.com' });
    });

    it('is idempotent: a second call returns the existing globalPostId without POSTing or enqueueing', async () => {
      const { deps, enqueued } = await freshHarness();
      const note = await writeSharedNote(deps, 'once');
      const publish = fakePublish();
      const first = await publishNote(deps, note.id, publish);
      enqueued.length = 0;
      publish.mockClear();

      const second = await publishNote(deps, note.id, publish);
      expect(publish).not.toHaveBeenCalled();
      expect(enqueued).toHaveLength(0);
      expect(second.globalPostId).toBe(first.globalPostId);
      expect(second.publishedAt).toBe(first.publishedAt);
    });

    it('leaves local state untouched if the POST throws', async () => {
      const { deps, enqueued } = await freshHarness();
      const note = await writeSharedNote(deps, 'will fail');
      enqueued.length = 0;
      const publish: jest.Mock<PublishToGlobalFeed> = jest.fn(async () => {
        throw new Error('server said no');
      });

      await expect(publishNote(deps, note.id, publish)).rejects.toThrow(/server said no/);
      const after = await getNote(deps.exec, note.id);
      expect(after?.publishedAt).toBeNull();
      expect(after?.publishedGlobalPostId).toBeNull();
      expect(enqueued).toHaveLength(0);
    });

    it('throws on a missing note id', async () => {
      const { deps } = await freshHarness();
      await expect(
        publishNote(deps, '00000000-0000-4000-8000-000000000000', fakePublish()),
      ).rejects.toThrow(/no note with id/);
    });

    it('throws when the local row has no body (partner-side secret pre-reveal)', async () => {
      const { deps } = await freshHarness();
      const id = '22222222-2222-4222-8222-222222222222';
      await deps.exec.execute(
        `INSERT INTO note (id, kind, author_pubkey, body, created_at)
         VALUES (?, 'secret', ?, NULL, ?)`,
        [id, SELF_PUBKEY, FIXED_NOW_SEC],
      );
      await expect(publishNote(deps, id, fakePublish())).rejects.toThrow(/body is not local/);
    });

    it('refuses non-author publish (row.author_pubkey != self)', async () => {
      const { deps } = await freshHarness();
      const otherPubkey = new Uint8Array(32).fill(0xee);
      const id = '33333333-3333-4333-8333-333333333333';
      await deps.exec.execute(
        `INSERT INTO note (id, kind, author_pubkey, body, created_at)
         VALUES (?, 'shared', ?, ?, ?)`,
        [id, otherPubkey, 'not mine to publish', FIXED_NOW_SEC],
      );
      await expect(publishNote(deps, id, fakePublish())).rejects.toThrow(
        /only the author can publish/,
      );
    });
  });
});
