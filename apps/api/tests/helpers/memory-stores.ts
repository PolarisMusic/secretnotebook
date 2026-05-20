import { decodeCursor, encodeCursor } from '../../src/storage/cursor.js';
import type {
  DevicesStore,
  NewPostInput,
  PostListOptions,
  PostListResult,
  PostsStore,
  StoredPost,
} from '../../src/storage/types.js';

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function compareDesc(a: StoredPost, b: StoredPost): number {
  const at = b.createdAt.getTime() - a.createdAt.getTime();
  if (at !== 0) return at;
  return b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
}

export class MemoryPostsStore implements PostsStore {
  readonly rows: StoredPost[] = [];

  async insertOrGetByBodyHash(input: NewPostInput): Promise<StoredPost> {
    const existing = this.rows.find((r) => bytesEqual(r.bodyHash, input.bodyHash));
    if (existing) return existing;
    const row: StoredPost = {
      id: input.id,
      contentType: input.contentType,
      body: input.body,
      bodyHash: input.bodyHash,
      anonAuthor: input.anonAuthor,
      createdAt: input.createdAt,
      popularity: 0,
    };
    this.rows.push(row);
    return row;
  }

  async list(opts: PostListOptions): Promise<PostListResult> {
    const decoded = opts.cursor ? decodeCursor(opts.cursor) : null;
    const cursorDate = decoded ? new Date(decoded.createdAt) : null;
    const cursorId = decoded?.id ?? null;

    const sorted = [...this.rows].sort(compareDesc);
    const filtered =
      cursorDate && cursorId
        ? sorted.filter(
            (r) =>
              r.createdAt.getTime() < cursorDate.getTime() ||
              (r.createdAt.getTime() === cursorDate.getTime() && r.id < cursorId),
          )
        : sorted;

    const items = filtered.slice(0, opts.limit);
    const overflow = filtered.length > opts.limit;
    const last = items[items.length - 1];
    const nextCursor =
      overflow && last
        ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
        : null;
    return { items, nextCursor };
  }

  async findById(id: string): Promise<StoredPost | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }
}

export class MemoryDevicesStore implements DevicesStore {
  readonly registered = new Map<string, { firstSeen: Date }>();

  async register(pubkey: Uint8Array, now: Date): Promise<void> {
    const key = Buffer.from(pubkey).toString('hex');
    if (!this.registered.has(key)) {
      this.registered.set(key, { firstSeen: now });
    }
  }

  async exists(pubkey: Uint8Array): Promise<boolean> {
    return this.registered.has(Buffer.from(pubkey).toString('hex'));
  }
}
