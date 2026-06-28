import { describe, expect, it } from '@jest/globals';
import type { SavedPostAddOp } from '@secretnotebook/connection-protocol';
import { bytesToHex } from '@secretnotebook/crypto';
import Database from 'better-sqlite3';

import { runMigrations } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import {
  findSavedFor,
  listSavedByMe,
  removeSavedPost,
  saveGlobalPost,
  type SavedPostStoreDeps,
} from '../src/features/connection-channel/saved-post-store';
import { nodeExecutor } from './helpers/sqlite-executor';

const SELF = new Uint8Array(32).fill(0x33);
const POST = '11111111-1111-4111-8111-111111111111';
const FIXED_NOW = new Date('2026-06-25T08:00:00.000Z');
const FIXED_NOW_SEC = Math.floor(FIXED_NOW.getTime() / 1000);

interface Harness {
  deps: SavedPostStoreDeps;
  enqueued: SavedPostAddOp[];
}

async function freshHarness(): Promise<Harness> {
  const db = new Database(':memory:');
  const exec = nodeExecutor(db);
  await runMigrations(exec, MIGRATIONS);
  const enqueued: SavedPostAddOp[] = [];
  const deps: SavedPostStoreDeps = {
    exec,
    selfPubkey: SELF,
    now: () => FIXED_NOW,
    enqueue: async (op) => {
      enqueued.push(op);
    },
  };
  return { deps, enqueued };
}

describe('saved-post store', () => {
  it('saveGlobalPost: inserts the local row and enqueues saved_post.add', async () => {
    const { deps, enqueued } = await freshHarness();
    const row = await saveGlobalPost(deps, POST);
    expect(row.globalPostId).toBe(POST);
    expect(row.createdAt).toBe(FIXED_NOW_SEC);
    expect(bytesToHex(row.savedByPubkey)).toBe(bytesToHex(SELF));

    expect(enqueued).toHaveLength(1);
    const op = enqueued[0]!;
    expect(op.kind).toBe('saved_post.add');
    expect(op.globalPostId).toBe(POST);
    expect(op.savedByPubkey).toBe(bytesToHex(SELF));
    // saved_for_pubkey mirrors saved_by_pubkey — saves are personal bookmarks.
    expect(op.savedForPubkey).toBe(bytesToHex(SELF));
  });

  it('saveGlobalPost: is idempotent on a double-save (one row, one op)', async () => {
    const { deps, enqueued } = await freshHarness();
    const first = await saveGlobalPost(deps, POST);
    const second = await saveGlobalPost(deps, POST);
    expect(second.id).toBe(first.id);
    expect(enqueued).toHaveLength(1);
  });

  it('findSavedFor + listSavedByMe roundtrip', async () => {
    const { deps } = await freshHarness();
    expect(await findSavedFor(deps.exec, SELF, POST)).toBeNull();
    await saveGlobalPost(deps, POST);
    const found = await findSavedFor(deps.exec, SELF, POST);
    expect(found).not.toBeNull();
    const list = await listSavedByMe(deps.exec, SELF);
    expect(list).toHaveLength(1);
    expect(list[0]!.globalPostId).toBe(POST);
  });

  it('removeSavedPost drops the row but is local-only (no op)', async () => {
    const { deps, enqueued } = await freshHarness();
    const row = await saveGlobalPost(deps, POST);
    enqueued.length = 0;
    await removeSavedPost(deps.exec, row.id);
    expect(await findSavedFor(deps.exec, SELF, POST)).toBeNull();
    expect(enqueued).toHaveLength(0);
  });
});
