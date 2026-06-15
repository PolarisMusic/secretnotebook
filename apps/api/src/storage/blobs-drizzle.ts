import { and, eq, gt, lte } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { blobs } from '../db/schema.js';
import type { BlobStore, NewBlobInput, StoredBlob } from './types.js';

function rowToStored(row: typeof blobs.$inferSelect): StoredBlob {
  return {
    id: row.id,
    data: row.data,
    byteSize: row.byteSize,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

export class DrizzleBlobStore implements BlobStore {
  constructor(private readonly db: Database) {}

  async insert(input: NewBlobInput): Promise<StoredBlob> {
    const [row] = await this.db
      .insert(blobs)
      .values({
        id: input.id,
        data: input.data,
        byteSize: input.byteSize,
        createdAt: input.createdAt,
        expiresAt: input.expiresAt,
      })
      .returning();
    if (!row) throw new Error('blob insert returned no row');
    return rowToStored(row);
  }

  async get(id: string, now: Date): Promise<StoredBlob | null> {
    // TTL is enforced at read time (expires_at > now) even if the purge
    // sweep hasn't run yet.
    const [row] = await this.db
      .select()
      .from(blobs)
      .where(and(eq(blobs.id, id), gt(blobs.expiresAt, now)))
      .limit(1);
    return row ? rowToStored(row) : null;
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.db.delete(blobs).where(eq(blobs.id, id)).returning({ id: blobs.id });
    return result.length > 0;
  }

  async purgeExpired(now: Date): Promise<number> {
    const result = await this.db
      .delete(blobs)
      .where(lte(blobs.expiresAt, now))
      .returning({ id: blobs.id });
    return result.length;
  }
}
