import { describe, expect, it } from '@jest/globals';
import { bytesToHex } from '@secretnotebook/crypto';
import type { Post } from '@secretnotebook/shared-types';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import { cachePost, cachePosts, getCachedPost, type CachedPost } from '../src/features/api/cache';
import { nodeExecutor } from './helpers/sqlite-executor';

async function freshExec(): Promise<ReturnType<typeof nodeExecutor>> {
  const db = new Database(':memory:');
  const exec = nodeExecutor(db);
  await runMigrations(exec, MIGRATIONS);
  return exec;
}

function fixturePost(overrides: Partial<Post> = {}): Post {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    contentType: 'text',
    body: 'hi from a paired device',
    audience: 'everyone',
    anonAuthor: '00'.repeat(32),
    createdAt: '2026-05-20T00:00:00.000Z',
    ...overrides,
  };
}

describe('cachePost', () => {
  it('inserts a fresh row that getCachedPost can read back', async () => {
    const exec = await freshExec();
    const post = fixturePost();
    await cachePost(exec, post, 1_700_000_000);
    const got = await getCachedPost(exec, post.id);
    expect(got).not.toBeNull();
    const row = got as CachedPost;
    expect(row.globalId).toBe(post.id);
    expect(row.body).toBe(post.body);
    expect(row.contentType).toBe(post.contentType);
    expect(row.audience).toBe('everyone');
    expect(bytesToHex(row.anonAuthorId)).toBe(post.anonAuthor);
    expect(row.fetchedAt).toBe(1_700_000_000);
  });

  it('round-trips a non-default audience', async () => {
    const exec = await freshExec();
    await cachePost(exec, fixturePost({ audience: 'masculine' }), 1);
    const got = await getCachedPost(exec, fixturePost().id);
    expect(got?.audience).toBe('masculine');
  });

  it('upserts on a second write with the same id (server is source of truth)', async () => {
    const exec = await freshExec();
    await cachePost(exec, fixturePost({ body: 'v1' }), 100);
    await cachePost(exec, fixturePost({ body: 'v2' }), 200);
    const got = await getCachedPost(exec, fixturePost().id);
    expect(got?.body).toBe('v2');
    expect(got?.fetchedAt).toBe(200);
  });

  it('returns null for an unknown id', async () => {
    const exec = await freshExec();
    expect(await getCachedPost(exec, '22222222-2222-2222-2222-222222222222')).toBeNull();
  });
});

describe('cachePosts', () => {
  it('inserts each post in a single transaction', async () => {
    const exec = await freshExec();
    const posts: Post[] = [
      fixturePost({ id: '11111111-1111-1111-1111-111111111111', body: 'one' }),
      fixturePost({ id: '22222222-2222-2222-2222-222222222222', body: 'two' }),
      fixturePost({ id: '33333333-3333-3333-3333-333333333333', body: 'three' }),
    ];
    await cachePosts(exec, posts, 999);
    for (const p of posts) {
      const got = await getCachedPost(exec, p.id);
      expect(got).not.toBeNull();
      expect(got?.body).toBe(p.body);
      expect(got?.fetchedAt).toBe(999);
    }
  });

  it('rolls back the whole batch if one row violates a constraint', async () => {
    const exec = await freshExec();
    const goodPost = fixturePost({ id: '11111111-1111-1111-1111-111111111111', body: 'good' });
    await cachePost(exec, goodPost, 1);
    // Force a failure mid-batch by passing a post whose anonAuthor isn't hex.
    const bad = {
      ...fixturePost({ id: '22222222-2222-2222-2222-222222222222' }),
      anonAuthor: 'not-hex',
    } as Post;
    await expect(
      cachePosts(exec, [fixturePost({ id: '33333333-3333-3333-3333-333333333333' }), bad], 5),
    ).rejects.toBeTruthy();
    // The original row is still intact at its old fetchedAt.
    expect((await getCachedPost(exec, goodPost.id))?.fetchedAt).toBe(1);
    // The first row in the batch isn't visible because the txn rolled back.
    expect(await getCachedPost(exec, '33333333-3333-3333-3333-333333333333')).toBeNull();
  });

  it('is a no-op for an empty batch', async () => {
    const exec = await freshExec();
    await cachePosts(exec, [], 999);
    // The table must still be readable + empty.
    expect(await getCachedPost(exec, fixturePost().id)).toBeNull();
  });
});
