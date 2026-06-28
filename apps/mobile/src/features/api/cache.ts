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

/** Hide a global post for this device only (personal, local). Idempotent. */
export async function hidePost(
  exec: SqlExecutor,
  globalId: string,
  hiddenAtSec: number = Math.floor(Date.now() / 1000),
): Promise<void> {
  await exec.execute(
    `INSERT OR IGNORE INTO hidden_post (global_post_id, hidden_at) VALUES (?, ?)`,
    [globalId, hiddenAtSec],
  );
}

/** Remove a post from this device's hidden set; the next render will show
 *  its body again. Idempotent — unhiding a non-hidden post is a no-op. */
export async function unhidePost(exec: SqlExecutor, globalId: string): Promise<void> {
  await exec.execute(`DELETE FROM hidden_post WHERE global_post_id = ?`, [globalId]);
}

export async function isPostHidden(exec: SqlExecutor, globalId: string): Promise<boolean> {
  const rows = await exec.query<{ x: number }>(
    `SELECT 1 AS x FROM hidden_post WHERE global_post_id = ?`,
    [globalId],
  );
  return rows.length > 0;
}

/** The set of post ids hidden on this device, for filtering the feed. */
export async function listHiddenPostIds(exec: SqlExecutor): Promise<Set<string>> {
  const rows = await exec.query<{ global_post_id: string }>(
    `SELECT global_post_id FROM hidden_post`,
  );
  return new Set(rows.map((r) => r.global_post_id));
}

/** Drop the locally-hidden posts from a fetched page. */
export async function filterHiddenPosts(
  exec: SqlExecutor,
  posts: ReadonlyArray<Post>,
): Promise<Post[]> {
  if (posts.length === 0) return [];
  const hidden = await listHiddenPostIds(exec);
  return posts.filter((p) => !hidden.has(p.id));
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
