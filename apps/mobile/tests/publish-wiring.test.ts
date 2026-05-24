import { describe, expect, it, jest } from '@jest/globals';
import type { CrdtOp } from '@secretnotebook/connection-protocol';
import Database from 'better-sqlite3';

import { runMigrations } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import { EntitlementError, cacheReceipt } from '../src/features/iap/store';
import { publishMyNote, type PublishMyNoteDeps } from '../src/features/notes/publish';
import { writeSharedNote, type NoteStoreDeps } from '../src/features/notes/store';
import { fixedValidator } from './helpers/iap-validators';
import { nodeExecutor } from './helpers/sqlite-executor';

const SELF_PUB = new Uint8Array(32).fill(0x11);
const FIXED_NOW = new Date('2026-05-25T10:00:00.000Z');
const FIXED_NOW_SEC = Math.floor(FIXED_NOW.getTime() / 1000);

interface Harness {
  exec: ReturnType<typeof nodeExecutor>;
  enqueued: CrdtOp[];
  submitPost: jest.Mock<
    (input: {
      contentType: 'text' | 'link';
      body: string;
    }) => Promise<{ id: string; createdAt: string }>
  >;
  deps: PublishMyNoteDeps;
}

async function freshHarness(): Promise<Harness> {
  const db = new Database(':memory:');
  const exec = nodeExecutor(db);
  await runMigrations(exec, MIGRATIONS);
  const enqueued: CrdtOp[] = [];
  const submitPost = jest.fn(async (input: { contentType: 'text' | 'link'; body: string }) => {
    void input;
    return { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', createdAt: FIXED_NOW.toISOString() };
  });
  const enqueue = async (op: CrdtOp): Promise<void> => {
    enqueued.push(op);
  };
  const deps: PublishMyNoteDeps = {
    exec,
    engine: { selfPub: SELF_PUB, enqueue },
    apiClient: { submitPost },
    now: () => FIXED_NOW,
  };
  return { exec, enqueued, submitPost, deps };
}

async function seedNote(deps: PublishMyNoteDeps, body: string): Promise<string> {
  const noteDeps: NoteStoreDeps = {
    exec: deps.exec,
    selfPubkey: deps.engine.selfPub,
    now: deps.now,
    enqueue: deps.engine.enqueue,
  };
  const note = await writeSharedNote(noteDeps, body);
  return note.id;
}

describe('publishMyNote (production wiring helper)', () => {
  it('throws EntitlementError(no-entitlement) when the device has no cached receipt — apiClient is NOT called', async () => {
    const { deps, submitPost } = await freshHarness();
    const noteId = await seedNote(deps, 'gated body');

    const err = await publishMyNote(deps, noteId).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EntitlementError);
    expect((err as EntitlementError).code).toBe('no-entitlement');
    expect(submitPost).not.toHaveBeenCalled();
  });

  it('throws EntitlementError(expired) when the cached entitlement has lapsed — apiClient is NOT called', async () => {
    const { deps, submitPost } = await freshHarness();
    const noteId = await seedNote(deps, 'gated body');
    await cacheReceipt(
      {
        exec: deps.exec,
        validator: fixedValidator({
          productId: 'sn.publish.monthly',
          expiresAt: FIXED_NOW_SEC - 1,
        }),
        now: () => FIXED_NOW,
      },
      new Uint8Array([0xaa]),
      'ios',
    );

    const err = await publishMyNote(deps, noteId).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EntitlementError);
    expect((err as EntitlementError).code).toBe('expired');
    expect(submitPost).not.toHaveBeenCalled();
  });

  it('with a current entitlement, calls apiClient.submitPost with { contentType, body } and stamps the local row', async () => {
    const { deps, exec, submitPost, enqueued } = await freshHarness();
    const noteId = await seedNote(deps, 'paid up + going public');
    await cacheReceipt(
      {
        exec,
        validator: fixedValidator({
          productId: 'sn.publish.monthly',
          expiresAt: FIXED_NOW_SEC + 30 * 86_400,
        }),
        now: () => FIXED_NOW,
      },
      new Uint8Array([0xaa]),
      'ios',
    );

    const result = await publishMyNote(deps, noteId, { contentType: 'text' });
    expect(submitPost).toHaveBeenCalledTimes(1);
    expect(submitPost).toHaveBeenCalledWith({
      contentType: 'text',
      body: 'paid up + going public',
    });
    expect(result.globalPostId).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

    // The note.publish op was enqueued via the wired enqueue.
    const publishOps = enqueued.filter((o) => o.kind === 'note.publish');
    expect(publishOps).toHaveLength(1);
  });

  it('idempotent re-call short-circuits before the gate AND before apiClient', async () => {
    // Verifies the wiring inherits publishNote's idempotency story:
    // a second publishMyNote on an already-published note doesn't
    // re-check entitlement and doesn't re-POST.
    const { deps, exec, submitPost } = await freshHarness();
    const noteId = await seedNote(deps, 'one-and-done');
    await cacheReceipt(
      {
        exec,
        validator: fixedValidator({
          productId: 'sn.publish.monthly',
          expiresAt: FIXED_NOW_SEC + 100,
        }),
        now: () => FIXED_NOW,
      },
      new Uint8Array([0xaa]),
      'ios',
    );
    const first = await publishMyNote(deps, noteId);
    submitPost.mockClear();

    // Now expire the entitlement.
    await cacheReceipt(
      {
        exec,
        validator: fixedValidator({
          productId: 'sn.publish.monthly',
          expiresAt: FIXED_NOW_SEC - 1,
        }),
        now: () => FIXED_NOW,
      },
      new Uint8Array([0xbb]),
      'ios',
    );
    const second = await publishMyNote(deps, noteId);
    expect(submitPost).not.toHaveBeenCalled();
    expect(second.globalPostId).toBe(first.globalPostId);
  });
});
