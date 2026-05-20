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
  findByBodyHash(bodyHash: Uint8Array): Promise<StoredPost | null>;
  insert(input: NewPostInput): Promise<StoredPost>;
  list(opts: PostListOptions): Promise<PostListResult>;
  findById(id: string): Promise<StoredPost | null>;
}

export interface DevicesStore {
  register(pubkey: Uint8Array, now: Date): Promise<void>;
  exists(pubkey: Uint8Array): Promise<boolean>;
}
