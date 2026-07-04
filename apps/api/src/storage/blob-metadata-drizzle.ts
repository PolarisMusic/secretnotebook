import { and, eq, gt, inArray, isNotNull, lte } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { blobs } from '../db/schema.js';
import type { BlobMetadata, BlobMetadataStore } from './types.js';

/**
 * Blob metadata persistence for the object-storage backend, on the shared
 * `blobs` table: these rows set `blob_key` and leave `data` NULL. Every query
 * pins `blob_key IS NOT NULL` so a stray inline row (from a prior Postgres
 * deployment) is never mistaken for an object-backed one.
 */
export class DrizzleBlobMetadataStore implements BlobMetadataStore {
  constructor(private readonly db: Database) {}

  async insert(meta: BlobMetadata): Promise<void> {
    await this.db.insert(blobs).values({
      id: meta.id,
      blobKey: meta.objectKey,
      byteSize: meta.byteSize,
      createdAt: meta.createdAt,
      expiresAt: meta.expiresAt,
    });
  }

  async get(id: string, now: Date): Promise<BlobMetadata | null> {
    const [row] = await this.db
      .select()
      .from(blobs)
      .where(and(eq(blobs.id, id), gt(blobs.expiresAt, now), isNotNull(blobs.blobKey)))
      .limit(1);
    return row?.blobKey
      ? toMeta(row.id, row.blobKey, row.byteSize, row.createdAt, row.expiresAt)
      : null;
  }

  async remove(id: string): Promise<BlobMetadata | null> {
    const [row] = await this.db
      .delete(blobs)
      .where(and(eq(blobs.id, id), isNotNull(blobs.blobKey)))
      .returning();
    return row?.blobKey
      ? toMeta(row.id, row.blobKey, row.byteSize, row.createdAt, row.expiresAt)
      : null;
  }

  async listExpired(now: Date, limit: number): Promise<BlobMetadata[]> {
    const rows = await this.db
      .select()
      .from(blobs)
      .where(and(lte(blobs.expiresAt, now), isNotNull(blobs.blobKey)))
      .limit(limit);
    return rows.flatMap((r) =>
      r.blobKey ? [toMeta(r.id, r.blobKey, r.byteSize, r.createdAt, r.expiresAt)] : [],
    );
  }

  async removeByIds(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await this.db
      .delete(blobs)
      .where(inArray(blobs.id, ids))
      .returning({ id: blobs.id });
    return result.length;
  }
}

function toMeta(
  id: string,
  objectKey: string,
  byteSize: number,
  createdAt: Date,
  expiresAt: Date,
): BlobMetadata {
  return { id, objectKey, byteSize, createdAt, expiresAt };
}
