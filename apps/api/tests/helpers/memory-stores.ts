import { decodeCursor, encodeCursor } from '../../src/storage/cursor.js';
import type {
  BlobStore,
  DevicesStore,
  EnvelopeListOptions,
  EnvelopeListResult,
  NewBlobInput,
  NewEnvelopeInput,
  NewFlagInput,
  NewPostInput,
  PostListOptions,
  PostListResult,
  PostsStore,
  RelayStore,
  StoredBlob,
  StoredEnvelope,
  StoredFlag,
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

/** Captured `flag_log` row in the in-memory store, mirroring the Drizzle
 *  flag_log table. Tests inspect this directly to assert that a
 *  `reveals_personal_details` flag wrote the audit trail. */
export interface InMemoryFlagLogRow {
  id: string;
  postId: string;
  postedBy: Uint8Array;
  flagger: Uint8Array;
  category: string;
  detail: string | null;
  createdAt: Date;
}

export class MemoryPostsStore implements PostsStore {
  readonly rows: StoredPost[] = [];
  /** Audit log mirror — only `reveals_personal_details` reports populate it. */
  readonly flagLogRows: InMemoryFlagLogRow[] = [];
  readonly flags: StoredFlag[] = [];

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
      audience: input.audience,
    };
    this.rows.push(row);
    return row;
  }

  async list(opts: PostListOptions): Promise<PostListResult> {
    const decoded = opts.cursor ? decodeCursor(opts.cursor) : null;
    const cursorDate = decoded ? new Date(decoded.createdAt) : null;
    const cursorId = decoded?.id ?? null;

    const base = opts.audience
      ? this.rows.filter((r) => r.audience === opts.audience || r.audience === 'everyone')
      : this.rows;
    const sorted = [...base].sort(compareDesc);
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

  async createFlag(input: NewFlagInput): Promise<StoredFlag> {
    const existing = this.flags.find(
      (f) => f.postId === input.postId && bytesEqual(f.flaggedBy, input.flaggedBy),
    );
    const row: StoredFlag =
      existing ??
      ({
        id: input.id,
        postId: input.postId,
        category: input.category,
        detail: input.detail ?? null,
        flaggedBy: input.flaggedBy,
        createdAt: input.createdAt,
      } satisfies StoredFlag);
    if (!existing) this.flags.push(row);

    // Mirror the Drizzle path: only the strictest category writes an audit
    // row, and it grows on EVERY report (per device, not deduped) so the
    // moderator sees the full pattern. The post must exist to know the
    // anon_author; absent post = no audit (matches the Drizzle behaviour).
    if (input.category === 'reveals_personal_details') {
      const post = this.rows.find((r) => r.id === input.postId);
      if (post) {
        this.flagLogRows.push({
          id: `log-${this.flagLogRows.length + 1}`,
          postId: input.postId,
          postedBy: post.anonAuthor,
          flagger: input.flaggedBy,
          category: input.category,
          detail: input.detail ?? null,
          createdAt: input.createdAt,
        });
      }
    }
    return row;
  }

  async flagsForPost(postId: string): Promise<string[]> {
    return [...new Set(this.flags.filter((f) => f.postId === postId).map((f) => f.category))];
  }

  async flagsForPosts(postIds: string[]): Promise<Map<string, string[]>> {
    const ids = new Set(postIds);
    const out = new Map<string, string[]>();
    for (const f of this.flags) {
      if (!ids.has(f.postId)) continue;
      const list = out.get(f.postId);
      if (list) {
        if (!list.includes(f.category)) list.push(f.category);
      } else {
        out.set(f.postId, [f.category]);
      }
    }
    return out;
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

function compareEnvelopeDesc(a: StoredEnvelope, b: StoredEnvelope): number {
  const at = b.receivedAt.getTime() - a.receivedAt.getTime();
  if (at !== 0) return at;
  return b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
}

export class MemoryRelayStore implements RelayStore {
  readonly rows: StoredEnvelope[] = [];

  async insert(input: NewEnvelopeInput): Promise<StoredEnvelope> {
    const row: StoredEnvelope = { ...input };
    this.rows.push(row);
    return row;
  }

  async list(opts: EnvelopeListOptions): Promise<EnvelopeListResult> {
    const decoded = opts.cursor ? decodeCursor(opts.cursor) : null;
    const cursorDate = decoded ? new Date(decoded.createdAt) : null;
    const cursorId = decoded?.id ?? null;

    const matching = this.rows
      .filter((r) => bytesEqual(r.blindedId, opts.blindedId))
      .filter((r) => r.expiresAt.getTime() > opts.now.getTime());
    const sorted = matching.sort(compareEnvelopeDesc);
    const filtered =
      cursorDate && cursorId
        ? sorted.filter(
            (r) =>
              r.receivedAt.getTime() < cursorDate.getTime() ||
              (r.receivedAt.getTime() === cursorDate.getTime() && r.id < cursorId),
          )
        : sorted;

    const items = filtered.slice(0, opts.limit);
    const overflow = filtered.length > opts.limit;
    const last = items[items.length - 1];
    const nextCursor =
      overflow && last
        ? encodeCursor({ createdAt: last.receivedAt.toISOString(), id: last.id })
        : null;
    return { items, nextCursor };
  }

  async remove(blindedId: Uint8Array, envelopeId: string): Promise<boolean> {
    const idx = this.rows.findIndex(
      (r) => bytesEqual(r.blindedId, blindedId) && r.id === envelopeId,
    );
    if (idx === -1) return false;
    this.rows.splice(idx, 1);
    return true;
  }

  async purgeExpired(now: Date): Promise<number> {
    const before = this.rows.length;
    for (let i = this.rows.length - 1; i >= 0; i--) {
      const row = this.rows[i];
      if (row && row.expiresAt.getTime() <= now.getTime()) this.rows.splice(i, 1);
    }
    return before - this.rows.length;
  }
}

export class MemoryBlobStore implements BlobStore {
  readonly rows: StoredBlob[] = [];

  async insert(input: NewBlobInput): Promise<StoredBlob> {
    const row: StoredBlob = { ...input };
    this.rows.push(row);
    return row;
  }

  async get(id: string, now: Date): Promise<StoredBlob | null> {
    const row = this.rows.find((r) => r.id === id);
    if (!row) return null;
    if (row.expiresAt.getTime() <= now.getTime()) return null;
    return row;
  }

  async remove(id: string): Promise<boolean> {
    const idx = this.rows.findIndex((r) => r.id === id);
    if (idx === -1) return false;
    this.rows.splice(idx, 1);
    return true;
  }

  async purgeExpired(now: Date): Promise<number> {
    const before = this.rows.length;
    for (let i = this.rows.length - 1; i >= 0; i--) {
      const row = this.rows[i];
      if (row && row.expiresAt.getTime() <= now.getTime()) this.rows.splice(i, 1);
    }
    return before - this.rows.length;
  }
}
