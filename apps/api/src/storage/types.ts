export interface StoredPost {
  id: string;
  contentType: string;
  body: string;
  bodyHash: Uint8Array;
  anonAuthor: Uint8Array;
  createdAt: Date;
  popularity: number;
}

export interface NewPostInput {
  id: string;
  contentType: string;
  body: string;
  bodyHash: Uint8Array;
  anonAuthor: Uint8Array;
  createdAt: Date;
}

export interface PostListOptions {
  cursor?: string;
  limit: number;
}

export interface PostListResult {
  items: StoredPost[];
  nextCursor: string | null;
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
