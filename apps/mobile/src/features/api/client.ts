import type { Ed25519KeyPair } from '@secretnotebook/crypto';
import {
  PromptListResponseSchema,
  type BlobUploadResponse,
  type DeviceRegisterResponse,
  type Post,
  type PostFlagCategory,
  type PostFlagResponse,
  type PostInput,
  type PostListResponse,
  type PromptListResponse,
  type RelayDeleteResponse,
  type RelayPostResponse,
  type SyncEnvelope,
  type SyncEnvelopeList,
} from '@secretnotebook/shared-types';
import { buildSignedHeaders } from './signing';

export type FetchLike = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: Uint8Array;
  },
) => Promise<{
  status: number;
  text: () => Promise<string>;
  /** Raw response bytes; required for binary downloads (blob fetch). */
  bytes?: () => Promise<Uint8Array>;
}>;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly bodyText: string,
    message?: string,
  ) {
    super(message ?? `api error ${status}: ${bodyText}`);
    this.name = 'ApiError';
  }
}

export interface ApiClientDeps {
  baseUrl: string;
  keyPair: Ed25519KeyPair;
  /**
   * Optional fetch override (used by tests). Defaults to globalThis.fetch
   * wrapped to match the simpler FetchLike contract.
   */
  fetch?: FetchLike;
  /** Override the clock for deterministic tests; defaults to Date.now. */
  nowMs?: () => number;
}

function defaultFetchAdapter(): FetchLike {
  return async (input, init) => {
    const res = await fetch(input, {
      method: init.method,
      headers: init.headers,
      body: init.body as BodyInit | undefined,
    });
    return {
      status: res.status,
      text: () => res.text(),
      bytes: async () => new Uint8Array(await res.arrayBuffer()),
    };
  };
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly keyPair: Ed25519KeyPair;
  private readonly fetcher: FetchLike;
  private readonly nowMs: () => number;

  constructor(deps: ApiClientDeps) {
    this.baseUrl = deps.baseUrl.replace(/\/+$/, '');
    this.keyPair = deps.keyPair;
    this.fetcher = deps.fetch ?? defaultFetchAdapter();
    this.nowMs = deps.nowMs ?? Date.now;
  }

  private async sendSigned<T>(args: {
    method: 'GET' | 'POST' | 'DELETE';
    path: string;
    body?: unknown;
    expectedStatuses?: number[];
  }): Promise<T> {
    const bodyBytes =
      args.body === undefined ? undefined : new TextEncoder().encode(JSON.stringify(args.body));
    const timestampSec = Math.floor(this.nowMs() / 1000);
    const headers = await buildSignedHeaders({
      method: args.method,
      url: args.path,
      bodyBytes,
      timestampSec,
      publicKey: this.keyPair.publicKey,
      privateKey: this.keyPair.privateKey,
    });
    const fullHeaders: Record<string, string> = { ...headers };
    if (bodyBytes !== undefined) fullHeaders['content-type'] = 'application/json';

    const res = await this.fetcher(`${this.baseUrl}${args.path}`, {
      method: args.method,
      headers: fullHeaders,
      body: bodyBytes,
    });

    const allowed = args.expectedStatuses ?? [200];
    const text = await res.text();
    if (!allowed.includes(res.status)) {
      throw new ApiError(res.status, text);
    }
    return text.length === 0 ? (undefined as unknown as T) : (JSON.parse(text) as T);
  }

  async registerDevice(): Promise<DeviceRegisterResponse> {
    const pubkeyHex = Array.from(this.keyPair.publicKey)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return this.sendSigned<DeviceRegisterResponse>({
      method: 'POST',
      path: '/v1/devices/register',
      body: { pubkey: pubkeyHex },
    });
  }

  async submitPost(input: PostInput): Promise<{ id: string; createdAt: string }> {
    return this.sendSigned({
      method: 'POST',
      path: '/v1/posts',
      body: input,
    });
  }

  async listPosts(
    opts: { cursor?: string; limit?: number; audience?: 'masculine' | 'feminine' } = {},
  ): Promise<PostListResponse> {
    const params = new URLSearchParams();
    if (opts.cursor !== undefined) params.set('cursor', opts.cursor);
    if (opts.limit !== undefined) params.set('limit', String(opts.limit));
    if (opts.audience !== undefined) params.set('audience', opts.audience);
    const qs = params.toString();
    const path = qs.length > 0 ? `/v1/posts?${qs}` : '/v1/posts';
    return this.sendSigned<PostListResponse>({ method: 'GET', path });
  }

  async getPost(id: string): Promise<Post> {
    return this.sendSigned<Post>({ method: 'GET', path: `/v1/posts/${id}` });
  }

  /** Report a post for moderation. Idempotent server-side per device.
   *  `detail` is required when category='other' (the server schema rejects
   *  an "other" flag with no explanation) and recorded into the moderation
   *  log when category='reveals_personal_details'. */
  async flagPost(
    id: string,
    category: PostFlagCategory,
    detail?: string,
  ): Promise<PostFlagResponse> {
    return this.sendSigned<PostFlagResponse>({
      method: 'POST',
      path: `/v1/posts/${id}/flag`,
      body: { category, ...(detail !== undefined ? { detail } : {}) },
    });
  }

  /**
   * Push an encrypted envelope into the partner's blinded relay inbox.
   * Body shape comes from shared-types/SyncEnvelopeSchema, which the
   * server re-validates against the same Zod schema.
   */
  async postEnvelope(blindedIdHex: string, envelope: SyncEnvelope): Promise<RelayPostResponse> {
    return this.sendSigned<RelayPostResponse>({
      method: 'POST',
      path: `/v1/relay/inbox/${blindedIdHex}`,
      body: envelope,
    });
  }

  async listEnvelopes(
    blindedIdHex: string,
    opts: { since?: string; limit?: number } = {},
  ): Promise<SyncEnvelopeList> {
    const params = new URLSearchParams();
    if (opts.since !== undefined) params.set('since', opts.since);
    if (opts.limit !== undefined) params.set('limit', String(opts.limit));
    const qs = params.toString();
    const path =
      qs.length > 0 ? `/v1/relay/inbox/${blindedIdHex}?${qs}` : `/v1/relay/inbox/${blindedIdHex}`;
    return this.sendSigned<SyncEnvelopeList>({ method: 'GET', path });
  }

  async deleteEnvelope(blindedIdHex: string, envelopeId: string): Promise<RelayDeleteResponse> {
    return this.sendSigned<RelayDeleteResponse>({
      method: 'DELETE',
      path: `/v1/relay/inbox/${blindedIdHex}/${envelopeId}`,
    });
  }

  /**
   * Fetch the public prompt library. Unsigned — the endpoint is public
   * and the response is the same for everyone. Validated against the
   * shared schema before returning so a malformed payload (e.g. an
   * intermediate proxy munging JSON) fails loudly here rather than at
   * draw time.
   */
  async fetchPrompts(): Promise<PromptListResponse> {
    const res = await this.fetcher(`${this.baseUrl}/v1/prompts`, {
      method: 'GET',
      headers: {},
    });
    const text = await res.text();
    if (res.status !== 200) {
      throw new ApiError(res.status, text);
    }
    const parsed = JSON.parse(text) as unknown;
    return PromptListResponseSchema.parse(parsed);
  }

  /**
   * Upload opaque ciphertext (a chunk-encrypted attachment) to the blob
   * store. Body is raw octet-stream bytes; the signature covers exactly
   * those bytes. The server assigns and returns the blob handle.
   */
  async uploadBlob(ciphertext: Uint8Array): Promise<BlobUploadResponse> {
    const timestampSec = Math.floor(this.nowMs() / 1000);
    const headers = await buildSignedHeaders({
      method: 'POST',
      url: '/v1/blobs',
      bodyBytes: ciphertext,
      timestampSec,
      publicKey: this.keyPair.publicKey,
      privateKey: this.keyPair.privateKey,
    });
    const res = await this.fetcher(`${this.baseUrl}/v1/blobs`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/octet-stream' },
      body: ciphertext,
    });
    const text = await res.text();
    if (res.status !== 200) throw new ApiError(res.status, text);
    return JSON.parse(text) as BlobUploadResponse;
  }

  /** Fetch a blob's opaque ciphertext by handle. */
  async downloadBlob(id: string): Promise<Uint8Array> {
    const timestampSec = Math.floor(this.nowMs() / 1000);
    const headers = await buildSignedHeaders({
      method: 'GET',
      url: `/v1/blobs/${id}`,
      bodyBytes: undefined,
      timestampSec,
      publicKey: this.keyPair.publicKey,
      privateKey: this.keyPair.privateKey,
    });
    const res = await this.fetcher(`${this.baseUrl}/v1/blobs/${id}`, {
      method: 'GET',
      headers: { ...headers },
    });
    if (res.status !== 200) {
      throw new ApiError(res.status, await res.text());
    }
    if (!res.bytes) {
      throw new Error('downloadBlob: fetch adapter does not expose response bytes');
    }
    return res.bytes();
  }
}
