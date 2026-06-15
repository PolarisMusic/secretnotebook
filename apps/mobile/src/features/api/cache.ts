import { hexToBytes } from '@secretnotebook/crypto';
import type { Post } from '@secretnotebook/shared-types';
import type { SqlExecutor } from '../../db/executor';

export interface CachedPost {
  globalId: string;
  contentType: string;
  body: string;
  audience: string;
  anonAuthorId: Uint8Array;
  fetchedAt: number;
}

/**
 * Write-through cache for the global feed. Every time we successfully pull a
 * post from the API we upsert it here so locked-then-unlocked flows (S7) can
 * render the body without a network call. Uses INSERT OR REPLACE — the
 * server is the source of truth, so a re-fetch should overwrite local data.
 */
export async function cachePost(
  exec: SqlExecutor,
  post: Post,
  fetchedAtSec: number = Math.floor(Date.now() / 1000),
): Promise<void> {
  await exec.execute(
    `INSERT OR REPLACE INTO post_cache (global_id, content_type, body, audience, anon_author_id, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      post.id,
      post.contentType,
      post.body,
      post.audience,
      hexToBytes(post.anonAuthor),
      fetchedAtSec,
    ],
  );
}

export async function cachePosts(
  exec: SqlExecutor,
  posts: ReadonlyArray<Post>,
  fetchedAtSec: number = Math.floor(Date.now() / 1000),
): Promise<void> {
  if (posts.length === 0) return;
  await exec.transaction(async () => {
    for (const post of posts) {
      await cachePost(exec, post, fetchedAtSec);
    }
  });
}

export async function getCachedPost(
  exec: SqlExecutor,
  globalId: string,
): Promise<CachedPost | null> {
  const rows = await exec.query<{
    global_id: string;
    content_type: string;
    body: string;
    audience: string;
    anon_author_id: Uint8Array;
    fetched_at: number;
  }>(
    `SELECT global_id, content_type, body, audience, anon_author_id, fetched_at
      FROM post_cache WHERE global_id = ?`,
    [globalId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    globalId: row.global_id,
    contentType: row.content_type,
    body: row.body,
    audience: row.audience,
    anonAuthorId:
      row.anon_author_id instanceof Uint8Array
        ? row.anon_author_id
        : new Uint8Array(row.anon_author_id as ArrayBufferLike),
    fetchedAt: row.fetched_at,
  };
}
