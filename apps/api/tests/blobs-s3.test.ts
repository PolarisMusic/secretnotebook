import { beforeEach, describe, expect, it } from '@jest/globals';
import { S3BlobStore } from '../src/storage/blobs-s3.js';
import type {
  BlobMetadata,
  BlobMetadataStore,
  BlobObjectStore,
  NewBlobInput,
} from '../src/storage/types.js';

class MemoryObjectStore implements BlobObjectStore {
  readonly objects = new Map<string, Uint8Array>();
  /** Set to a key to make put() throw, simulating an upload failure. */
  failPutFor: string | null = null;

  async put(key: string, bytes: Uint8Array): Promise<void> {
    if (this.failPutFor === key) throw new Error('put failed');
    this.objects.set(key, bytes);
  }
  async get(key: string): Promise<Uint8Array | null> {
    return this.objects.get(key) ?? null;
  }
  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
  async deleteMany(keys: string[]): Promise<void> {
    for (const k of keys) this.objects.delete(k);
  }
}

class MemoryMetaStore implements BlobMetadataStore {
  readonly rows = new Map<string, BlobMetadata>();
  /** Set true to make insert() throw, simulating a metadata write failure. */
  failInsert = false;

  async insert(meta: BlobMetadata): Promise<void> {
    if (this.failInsert) throw new Error('meta insert failed');
    this.rows.set(meta.id, { ...meta });
  }
  async get(id: string, now: Date): Promise<BlobMetadata | null> {
    const row = this.rows.get(id);
    if (!row || row.expiresAt.getTime() <= now.getTime()) return null;
    return row;
  }
  async remove(id: string): Promise<BlobMetadata | null> {
    const row = this.rows.get(id);
    if (!row) return null;
    this.rows.delete(id);
    return row;
  }
  async listExpired(now: Date, limit: number): Promise<BlobMetadata[]> {
    return [...this.rows.values()]
      .filter((r) => r.expiresAt.getTime() <= now.getTime())
      .slice(0, limit);
  }
  async removeByIds(ids: string[]): Promise<number> {
    let n = 0;
    for (const id of ids) if (this.rows.delete(id)) n++;
    return n;
  }
}

const NOW = new Date('2026-07-04T00:00:00.000Z');
const FRESH = new Date(NOW.getTime() + 60 * 60 * 1000);
const EXPIRED = new Date(NOW.getTime() - 1000);

function input(id: string, expiresAt: Date, bytes = new Uint8Array([1, 2, 3])): NewBlobInput {
  return { id, data: bytes, byteSize: bytes.length, createdAt: NOW, expiresAt };
}

describe('S3BlobStore', () => {
  let objects: MemoryObjectStore;
  let meta: MemoryMetaStore;
  let store: S3BlobStore;

  beforeEach(() => {
    objects = new MemoryObjectStore();
    meta = new MemoryMetaStore();
    store = new S3BlobStore(objects, meta, 'blobs/');
  });

  it('uploads bytes to the object store and records metadata, then reads back', async () => {
    const bytes = new Uint8Array([9, 8, 7, 6]);
    const stored = await store.insert(input('abc', FRESH, bytes));
    expect(stored.id).toBe('abc');
    expect(objects.objects.get('blobs/abc')).toEqual(bytes);
    expect(meta.rows.get('abc')?.objectKey).toBe('blobs/abc');

    const got = await store.get('abc', NOW);
    expect(got?.data).toEqual(bytes);
    expect(got?.byteSize).toBe(4);
  });

  it('returns null for an expired blob (TTL enforced at read time)', async () => {
    await store.insert(input('old', EXPIRED));
    expect(await store.get('old', NOW)).toBeNull();
  });

  it('returns null (not an error) when the object is gone but metadata lingers', async () => {
    await store.insert(input('half', FRESH));
    objects.objects.delete('blobs/half'); // simulate a partial delete
    expect(await store.get('half', NOW)).toBeNull();
  });

  it('rolls back the orphaned object when the metadata write fails', async () => {
    meta.failInsert = true;
    await expect(store.insert(input('boom', FRESH))).rejects.toThrow(/meta insert failed/);
    expect(objects.objects.size).toBe(0); // object was cleaned up
  });

  it('remove deletes both object and metadata; false when absent', async () => {
    await store.insert(input('gone', FRESH));
    expect(await store.remove('gone')).toBe(true);
    expect(objects.objects.size).toBe(0);
    expect(meta.rows.size).toBe(0);
    expect(await store.remove('missing')).toBe(false);
  });

  it('purgeExpired removes expired objects + rows, keeps fresh, returns count', async () => {
    await store.insert(input('old1', EXPIRED));
    await store.insert(input('old2', EXPIRED));
    await store.insert(input('new1', FRESH));

    const purged = await store.purgeExpired(NOW);
    expect(purged).toBe(2);
    expect(meta.rows.has('new1')).toBe(true);
    expect(objects.objects.has('blobs/new1')).toBe(true);
    expect(objects.objects.has('blobs/old1')).toBe(false);
    expect(objects.objects.has('blobs/old2')).toBe(false);
  });

  it('purgeExpired is a no-op (returns 0) when nothing is expired', async () => {
    await store.insert(input('new', FRESH));
    expect(await store.purgeExpired(NOW)).toBe(0);
  });
});
