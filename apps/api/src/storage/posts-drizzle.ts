import { and, desc, eq, inArray, lt, or } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Database } from '../db/client.js';
import { flagLog, postFlags, posts } from '../db/schema.js';
import { decodeCursor, encodeCursor } from './cursor.js';
import type {
  NewFlagInput,
  NewPostInput,
  PostListOptions,
  PostListResult,
  PostsStore,
  StoredFlag,
  StoredPost,
} from './types.js';

function rowToStored(row: typeof posts.$inferSelect): StoredPost {
  return {
    id: row.id,
    contentType: row.contentType,
    body: row.body,
    bodyHash: row.bodyHash,
    anonAuthor: row.anonAuthor,
    createdAt: row.createdAt,
    popularity: row.popularity,
    audience: row.audience,
  };
}

export class DrizzlePostsStore implements PostsStore {
  constructor(private readonly db: Database) {}

  async insertOrGetByBodyHash(input: NewPostInput): Promise<StoredPost> {
    const [row] = await this.db
      .insert(posts)
      .values({
        id: input.id,
        contentType: input.contentType,
        body: input.body,
        bodyHash: input.bodyHash,
        anonAuthor: input.anonAuthor,
        createdAt: input.createdAt,
        audience: input.audience,
      })
      .onConflictDoUpdate({
        target: posts.bodyHash,
        set: { bodyHash: posts.bodyHash },
      })
      .returning();
    if (!row) throw new Error('insertOrGetByBodyHash returned no row');
    return rowToStored(row);
  }

  async list(opts: PostListOptions): Promise<PostListResult> {
    const decoded = opts.cursor ? decodeCursor(opts.cursor) : null;
    const cursorDate = decoded ? new Date(decoded.createdAt) : null;
    const cursorId = decoded?.id ?? null;

    const cursorWhere =
      cursorDate && cursorId
        ? or(
            lt(posts.createdAt, cursorDate),
            and(eq(posts.createdAt, cursorDate), lt(posts.id, cursorId)),
          )
        : undefined;
    // Role filter: posts tagged for the viewer's role OR for everyone.
    const audienceWhere = opts.audience
      ? inArray(posts.audience, [opts.audience, 'everyone'])
      : undefined;
    const where =
      cursorWhere && audienceWhere
        ? and(cursorWhere, audienceWhere)
        : (cursorWhere ?? audienceWhere);

    const rows = await this.db
      .select()
      .from(posts)
      .where(where)
      .orderBy(desc(posts.createdAt), desc(posts.id))
      .limit(opts.limit + 1);

    const items = rows.slice(0, opts.limit).map(rowToStored);
    const next = rows.length > opts.limit ? items[items.length - 1] : null;
    const nextCursor =
      next != null ? encodeCursor({ createdAt: next.createdAt.toISOString(), id: next.id }) : null;

    return { items, nextCursor };
  }

  async findById(id: string): Promise<StoredPost | null> {
    const rows = await this.db.select().from(posts).where(eq(posts.id, id)).limit(1);
    return rows[0] ? rowToStored(rows[0]) : null;
  }

  async createFlag(input: NewFlagInput): Promise<StoredFlag> {
    // Idempotent per (post_id, flagged_by, category): the DO UPDATE lets us
    // RETURNING the existing row when the same reason is reported twice, while
    // a DIFFERENT reason from the same device inserts its own row (so a post
    // can carry several distinct flags from one viewer). The audit log below
    // is the OTHER path that grows on every report — see comment there.
    const [row] = await this.db
      .insert(postFlags)
      .values({
        id: input.id,
        postId: input.postId,
        category: input.category,
        detail: input.detail ?? null,
        flaggedBy: input.flaggedBy,
        createdAt: input.createdAt,
      })
      .onConflictDoUpdate({
        target: [postFlags.postId, postFlags.flaggedBy, postFlags.category],
        set: { postId: postFlags.postId },
      })
      .returning();
    if (!row) throw new Error('createFlag returned no row');

    // `reveals_personal_details` is the only category that writes an audit
    // row. The log is append-only — every report counts (unlike post_flag,
    // which dedupes per device). The post's anon_author is captured here so
    // a moderator can review the offending author even after a hypothetical
    // delete (no FK from flag_log back to posts).
    if (input.category === 'reveals_personal_details') {
      const [post] = await this.db
        .select({ anonAuthor: posts.anonAuthor })
        .from(posts)
        .where(eq(posts.id, input.postId))
        .limit(1);
      if (post) {
        await this.db.insert(flagLog).values({
          id: randomUUID(),
          postId: input.postId,
          postedBy: post.anonAuthor,
          flagger: input.flaggedBy,
          category: input.category,
          detail: input.detail ?? null,
          createdAt: input.createdAt,
        });
      }
    }

    return {
      id: row.id,
      postId: row.postId,
      category: row.category,
      detail: row.detail,
      flaggedBy: row.flaggedBy,
      createdAt: row.createdAt,
    };
  }

  async flagsForPost(postId: string): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ category: postFlags.category })
      .from(postFlags)
      .where(eq(postFlags.postId, postId));
    return rows.map((r) => r.category);
  }

  async flagsForPosts(postIds: string[]): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (postIds.length === 0) return out;
    const rows = await this.db
      .selectDistinct({ postId: postFlags.postId, category: postFlags.category })
      .from(postFlags)
      .where(inArray(postFlags.postId, postIds));
    for (const r of rows) {
      const list = out.get(r.postId);
      if (list) list.push(r.category);
      else out.set(r.postId, [r.category]);
    }
    return out;
  }
}
