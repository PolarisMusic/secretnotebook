import type {
  BlobMetadataStore,
  BlobObjectStore,
  BlobStore,
  NewBlobInput,
  StoredBlob,
} from './types.js';

/** How many expired blobs to sweep per purge pass — bounds the DELETE and the
 *  object-store batch so one tick can't try to remove an unbounded set. */
const PURGE_BATCH = 1000;

/**
 * Object-storage blob store (Cloudflare R2 / AWS S3). Ciphertext bytes live in
 * the object store; the small metadata row (id, key, size, TTL) lives in
 * Postgres via a BlobMetadataStore. Keeping Postgres free of large BYTEA
 * payloads is the point — that's where the Fly bill was growing.
 *
 * Pure composition of the two collaborators, so it unit-tests against
 * in-memory fakes and swaps R2 for S3 (or GCS) by swapping the object store.
 */
export class S3BlobStore implements BlobStore {
  constructor(
    private readonly objects: BlobObjectStore,
    private readonly meta: BlobMetadataStore,
    /** Key namespace inside the bucket. */
    private readonly keyPrefix = 'blobs/',
  ) {}

  private keyFor(id: string): string {
    return `${this.keyPrefix}${id}`;
  }

  async insert(input: NewBlobInput): Promise<StoredBlob> {
    const objectKey = this.keyFor(input.id);
    // Object first: if the metadata write then fails, a stray object is
    // cheaper (and TTL-swept) than a metadata row pointing at nothing.
    await this.objects.put(objectKey, input.data);
    try {
      await this.meta.insert({
        id: input.id,
        objectKey,
        byteSize: input.byteSize,
        createdAt: input.createdAt,
        expiresAt: input.expiresAt,
      });
    } catch (err) {
      // Roll back the orphaned object so a retry with the same id is clean.
      await this.objects.delete(objectKey).catch(() => undefined);
      throw err;
    }
    return {
      id: input.id,
      data: input.data,
      byteSize: input.byteSize,
      createdAt: input.createdAt,
      expiresAt: input.expiresAt,
    };
  }

  async get(id: string, now: Date): Promise<StoredBlob | null> {
    const meta = await this.meta.get(id, now);
    if (!meta) return null;
    const bytes = await this.objects.get(meta.objectKey);
    // Metadata present but object gone (e.g. a partial delete) → treat as
    // missing rather than 500.
    if (!bytes) return null;
    return {
      id: meta.id,
      data: bytes,
      byteSize: meta.byteSize,
      createdAt: meta.createdAt,
      expiresAt: meta.expiresAt,
    };
  }

  async remove(id: string): Promise<boolean> {
    const removed = await this.meta.remove(id);
    if (!removed) return false;
    // Metadata is the source of truth for "exists"; the object delete is
    // best-effort (TTL sweeps any straggler).
    await this.objects.delete(removed.objectKey).catch(() => undefined);
    return true;
  }

  async purgeExpired(now: Date): Promise<number> {
    const expired = await this.meta.listExpired(now, PURGE_BATCH);
    if (expired.length === 0) return 0;
    // Delete objects first (best-effort), then drop the rows. If object
    // deletion partly fails, the rows are still removed and the objects fall
    // to the bucket's own lifecycle rule — we never resurrect a purged row.
    await this.objects.deleteMany(expired.map((m) => m.objectKey)).catch(() => undefined);
    return this.meta.removeByIds(expired.map((m) => m.id));
  }
}
