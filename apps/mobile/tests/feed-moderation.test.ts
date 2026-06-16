import { describe, expect, it } from '@jest/globals';
import type { Post } from '@secretnotebook/shared-types';
import Database from 'better-sqlite3';

import { runMigrations } from '../src/db/migrate';
import { MIGRATIONS } from '../src/db/migrations';
import type { SqlExecutor } from '../src/db/executor';
import {
  filterHiddenPosts,
  hidePost,
  isPostHidden,
  listHiddenPostIds,
} from '../src/features/api/cache';
import { nodeExecutor } from './helpers/sqlite-executor';

async function freshExec(): Promise<SqlExecutor> {
  const db = new Database(':memory:');
  const exec = nodeExecutor(db);
  await runMigrations(exec, MIGRATIONS);
  return exec;
}

function post(id: string): Post {
  return {
    id,
    contentType: 'text',
    body: `body ${id}`,
    audience: 'everyone',
    anonAuthor: '00'.repeat(32),
    createdAt: '2026-05-21T08:00:00.000Z',
    flags: [],
  };
}

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('feed moderation — local hide', () => {
  it('hidePost marks a post hidden; isPostHidden reflects it; idempotent', async () => {
    const exec = await freshExec();
    expect(await isPostHidden(exec, A)).toBe(false);
    await hidePost(exec, A, 1_700_000_000);
    await hidePost(exec, A, 1_700_000_001); // idempotent (INSERT OR IGNORE)
    expect(await isPostHidden(exec, A)).toBe(true);
    expect(await listHiddenPostIds(exec)).toEqual(new Set([A]));
  });

  it('filterHiddenPosts drops hidden posts from a page', async () => {
    const exec = await freshExec();
    await hidePost(exec, A);
    const visible = await filterHiddenPosts(exec, [post(A), post(B)]);
    expect(visible.map((p) => p.id)).toEqual([B]);
  });

  it('filterHiddenPosts is a no-op on an empty page', async () => {
    const exec = await freshExec();
    expect(await filterHiddenPosts(exec, [])).toEqual([]);
  });
});
