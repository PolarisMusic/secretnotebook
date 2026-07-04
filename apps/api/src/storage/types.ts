export interface StoredPost {
  id: string;
  contentType: string;
  body: string;
  bodyHash: Uint8Array;
  anonAuthor: Uint8Array;
  createdAt: Date;
  popularity: number;
  audience: string;
}

export interface NewPostInput {
  id: string;
  contentType: string;
  body: string;
  bodyHash: Uint8Array;
  anonAuthor: Uint8Array;
  createdAt: Date;
  audience: string;
}

export interface PostListOptions {
  cursor?: string;
  limit: number;
  /** Role filter. When set, list returns posts tagged for this role plus
   *  'everyone'. Omitted = no filter. */
  audience?: 'masculine' | 'feminine';
}

export interface PostListResult {
  items: StoredPost[];
  nextCursor: string | null;
}

export interface StoredFlag {
  id: string;
  postId: string;
  category: string;
  /** Optional free-text reason. Required at the request boundary when
   *  category='other'; persisted on the row whenever it's provided. */
  detail: string | null;
  flaggedBy: Uint8Array;
  createdAt: Date;
}

export interface NewFlagInput {
  id: string;
  postId: string;
  category: string;
  detail?: string;
  flaggedBy: Uint8Array;
  createdAt: Date;
}

export interface PostsStore {
  /**
   * Atomically create a post or — if a row with the same body_hash already
   * exists — return the existing row unchanged. This collapses the legacy
   * find-then-insert race into a single round trip; in Drizzle land that's
   * INSERT ... ON CONFLICT (body_hash) DO UPDATE ... RETURNING.
   */
  insertOrGetByBodyHash(input: NewPostInput): Promise<StoredPost>;
  list(opts: PostListOptions): Promise<PostListResult>;
  findById(id: string): Promise<StoredPost | null>;
  /**
   * Record a moderation flag. Idempotent per (postId, flaggedBy): a repeat
   * report from the same device returns the existing row (INSERT ... ON
   * CONFLICT (post_id, flagged_by) DO UPDATE ... RETURNING).
   */
  createFlag(input: NewFlagInput): Promise<StoredFlag>;
  /** Distinct flag categories on a single post (empty ⇒ not obscured). */
  flagsForPost(postId: string): Promise<string[]>;
  /** Distinct flag categories for a batch of posts, keyed by post id.
   *  Posts with no flags are absent from the map. */
  flagsForPosts(postIds: string[]): Promise<Map<string, string[]>>;
}

export interface DevicesStore {
  register(pubkey: Uint8Array, now: Date): Promise<void>;
  exists(pubkey: Uint8Array): Promise<boolean>;
}

export interface StoredEnvelope {
  id: string;
  blindedId: Uint8Array;
  header: Uint8Array;
  ciphertext: Uint8Array;
  sentAt: Date;
  receivedAt: Date;
  expiresAt: Date;
}

export interface NewEnvelopeInput {
  id: string;
  blindedId: Uint8Array;
  header: Uint8Array;
  ciphertext: Uint8Array;
  sentAt: Date;
  receivedAt: Date;
  expiresAt: Date;
}

export interface EnvelopeListOptions {
  blindedId: Uint8Array;
  cursor?: string;
  limit: number;
  /** Treat envelopes whose expires_at <= this as expired (filtered out). */
  now: Date;
}

export interface EnvelopeListResult {
  items: StoredEnvelope[];
  nextCursor: string | null;
}

export interface RelayStore {
  insert(input: NewEnvelopeInput): Promise<StoredEnvelope>;
  list(opts: EnvelopeListOptions): Promise<EnvelopeListResult>;
  /** Returns true if a matching row was deleted, false otherwise. */
  remove(blindedId: Uint8Array, envelopeId: string): Promise<boolean>;
  /** Sweep TTL-expired rows. Returns the number deleted. */
  purgeExpired(now: Date): Promise<number>;
}

export interface StoredBlob {
  id: string;
  /** Opaque ciphertext bytes; the server never decrypts these. */
  data: Uint8Array;
  byteSize: number;
  createdAt: Date;
  expiresAt: Date;
}

export interface NewBlobInput {
  id: string;
  data: Uint8Array;
  byteSize: number;
  createdAt: Date;
  expiresAt: Date;
}

export interface BlobStore {
  insert(input: NewBlobInput): Promise<StoredBlob>;
  /** The blob if present and not expired at `now`, otherwise null. */
  get(id: string, now: Date): Promise<StoredBlob | null>;
  /** Returns true if a matching row was deleted, false otherwise. */
  remove(id: string): Promise<boolean>;
  /** Sweep TTL-expired rows. Returns the number deleted. */
  purgeExpired(now: Date): Promise<number>;
}

/**
 * Raw object bytes keyed by a string, backing the S3/R2 blob store. Kept
 * deliberately tiny so the AWS SDK stays behind one adapter and the store
 * logic can be unit-tested against an in-memory fake. Values are opaque
 * ciphertext — the backend never decrypts them.
 */
export interface BlobObjectStore {
  put(key: string, bytes: Uint8Array): Promise<void>;
  /** Object bytes, or null if the key is absent. */
  get(key: string): Promise<Uint8Array | null>;
  /** Delete one object. Absent key is not an error. */
  delete(key: string): Promise<void>;
  /** Delete many objects in as few round trips as the backend allows. */
  deleteMany(keys: string[]): Promise<void>;
}

/** Blob bookkeeping row: everything except the ciphertext bytes, which live
 *  in the object store under `objectKey`. */
export interface BlobMetadata {
  id: string;
  objectKey: string;
  byteSize: number;
  createdAt: Date;
  expiresAt: Date;
}

/**
 * Persistence for blob metadata (Postgres in prod). Separated from the object
 * bytes so the S3 store is pure composition: metadata answers "does this blob
 * exist / has it expired / which objects are dead", object store moves bytes.
 */
export interface BlobMetadataStore {
  insert(meta: BlobMetadata): Promise<void>;
  /** Metadata if present and not expired at `now`, else null. */
  get(id: string, now: Date): Promise<BlobMetadata | null>;
  /** Remove one row, returning it (for object cleanup) or null if absent. */
  remove(id: string): Promise<BlobMetadata | null>;
  /** Up to `limit` rows whose expires_at <= now — candidates for the sweep. */
  listExpired(now: Date, limit: number): Promise<BlobMetadata[]>;
  /** Delete rows by id. Returns the number removed. */
  removeByIds(ids: string[]): Promise<number>;
}

export interface StoredHello {
  hello: string;
  postedAt: Date;
}

/**
 * Persistent backing for the pairing rendezvous. Unlike the earlier
 * in-memory map, this survives a machine restart / auto-stop, so a code
 * posted before the API idled is still there when the partner polls — the
 * long-distance flow can span hours or days. Each row is one hello (a pair
 * of base64 public keys) under a short code, TTL'd like relay envelopes.
 */
export interface PairRendezvousStore {
  /** Non-expired hellos posted under `code`, oldest first. */
  listHellos(code: string, now: Date): Promise<StoredHello[]>;
  /** Add a hello. Idempotent on (code, hello): a repeat is a no-op. */
  insertHello(code: string, hello: string, postedAt: Date, expiresAt: Date): Promise<void>;
  /** Sweep TTL-expired rows. Returns the number deleted. */
  purgeExpired(now: Date): Promise<number>;
}

/**
 * Relationship-prompt row. `key` is the stable identifier mobile ops
 * carry; `categories` is whatever JSON array of strings the admin set.
 * Source attribution + sponsorship are optional metadata for the mobile
 * renderer. `retiredAt` is the soft-delete marker — a retired row stays
 * in storage so historical op references still resolve text, but
 * `listActive` skips it.
 */
export interface StoredPrompt {
  key: string;
  text: string;
  categories: string[];
  sourceName: string | null;
  sourceUrl: string | null;
  sponsored: boolean;
  retiredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewPromptInput {
  key: string;
  text: string;
  categories: string[];
  sourceName?: string | null;
  sourceUrl?: string | null;
  sponsored?: boolean;
}

export interface PromptPatch {
  text?: string;
  categories?: string[];
  sourceName?: string | null;
  sourceUrl?: string | null;
  sponsored?: boolean;
}

export interface PromptsStore {
  /** Active (non-retired) prompts, ordered by key. The public mobile
   *  fetch path uses this. */
  listActive(): Promise<StoredPrompt[]>;
  /** Every prompt, retired included; admin list. */
  listAll(): Promise<StoredPrompt[]>;
  findByKey(key: string): Promise<StoredPrompt | null>;
  create(input: NewPromptInput, now: Date): Promise<StoredPrompt>;
  /** Partial update. Returns the updated row, or null if no row matched. */
  update(key: string, patch: PromptPatch, now: Date): Promise<StoredPrompt | null>;
  /** Sets retired_at = now. Returns false if no row matched or already retired. */
  retire(key: string, now: Date): Promise<boolean>;
  /** Clears retired_at. Returns false if no row matched or not retired. */
  unretire(key: string, now: Date): Promise<boolean>;
}
