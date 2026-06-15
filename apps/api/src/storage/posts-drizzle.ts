import { and, desc, eq, inArray, lt, or } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { posts } from '../db/schema.js';
import { decodeCursor, encodeCursor } from './cursor.js';
import type {
  NewPostInput,
  PostListOptions,
  PostListResult,
  PostsStore,
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
}
