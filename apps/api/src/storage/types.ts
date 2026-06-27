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
