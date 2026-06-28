import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { generateEd25519KeyPair } from '@secretnotebook/crypto';
import type { FastifyInstance } from 'fastify';
import { loadEnv } from '../src/config.js';
import { buildApp } from '../src/server.js';
import {
  MemoryBlobStore,
  MemoryDevicesStore,
  MemoryPostsStore,
  MemoryPromptsStore,
  MemoryRelayStore,
} from './helpers/memory-stores.js';
import { buildSignedRequest } from './helpers/signed-inject.js';

const FIXED_NOW_MS = 1_700_000_000_000;
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface TestCtx {
  app: FastifyInstance;
  blobs: MemoryBlobStore;
}

async function setupApp(maxBytes?: number): Promise<TestCtx> {
  const blobs = new MemoryBlobStore();
  const app = await buildApp({
    env: loadEnv({
      LOG_LEVEL: 'fatal',
      RATE_LIMIT_MAX: '1000',
      RATE_LIMIT_WINDOW_MS: '60000',
      ...(maxBytes !== undefined ? { BLOB_MAX_BYTES: String(maxBytes) } : {}),
    }),
    now: () => FIXED_NOW_MS,
    postsStore: new MemoryPostsStore(),
    devicesStore: new MemoryDevicesStore(),
    relayStore: new MemoryRelayStore(),
    blobsStore: blobs,
    promptsStore: new MemoryPromptsStore(),
  });
  return { app, blobs };
}

async function uploadBlob(app: FastifyInstance, bytes: Uint8Array): Promise<string> {
  const kp = await generateEd25519KeyPair();
  const req = await buildSignedRequest({
    method: 'POST',
    url: '/v1/blobs',
    body: bytes,
    timestampSec: Math.floor(FIXED_NOW_MS / 1000),
    privateKey: kp.privateKey,
    publicKey: kp.publicKey,
  });
  const res = await app.inject({
    method: req.method,
    url: req.url,
    headers: req.headers,
    payload: req.body as Buffer,
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { id: string }).id;
}

describe('POST /v1/blobs', () => {
  let ctx: TestCtx;
  beforeEach(async () => {
    ctx = await setupApp();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('rejects an unsigned upload with 401', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/blobs',
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from([1, 2, 3]),
    });
    expect(res.statusCode).toBe(401);
  });

  it('stores a signed ciphertext and returns an id + expiresAt', async () => {
    const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const id = await uploadBlob(ctx.app, bytes);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(ctx.blobs.rows).toHaveLength(1);
    expect(Array.from(ctx.blobs.rows[0]!.data)).toEqual(Array.from(bytes));
    expect(ctx.blobs.rows[0]!.expiresAt.getTime() - FIXED_NOW_MS).toBe(TTL_MS);
  });

  it('rejects an empty body with 400', async () => {
    const kp = await generateEd25519KeyPair();
    const req = await buildSignedRequest({
      method: 'POST',
      url: '/v1/blobs',
      body: new Uint8Array(0),
      timestampSec: Math.floor(FIXED_NOW_MS / 1000),
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
    });
    const res = await ctx.app.inject({
      method: req.method,
      url: req.url,
      headers: req.headers,
      payload: Buffer.alloc(0),
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepts an upload larger than the global 1 MB default (route bodyLimit override)', async () => {
    const big = new Uint8Array(1_500_000).fill(0x5a);
    const id = await uploadBlob(ctx.app, big);
    expect(ctx.blobs.rows.find((r) => r.id === id)?.byteSize).toBe(big.length);
  });
});

describe('POST /v1/blobs bodyLimit', () => {
  it('rejects an upload over the configured max with 413', async () => {
    const ctx = await setupApp(1024);
    const kp = await generateEd25519KeyPair();
    const req = await buildSignedRequest({
      method: 'POST',
      url: '/v1/blobs',
      body: new Uint8Array(2048).fill(7),
      timestampSec: Math.floor(FIXED_NOW_MS / 1000),
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
    });
    const res = await ctx.app.inject({
      method: req.method,
      url: req.url,
      headers: req.headers,
      payload: req.body as Buffer,
    });
    expect(res.statusCode).toBe(413);
    expect(ctx.blobs.rows).toHaveLength(0);
    await ctx.app.close();
  });
});

describe('GET /v1/blobs/:id', () => {
  let ctx: TestCtx;
  beforeEach(async () => {
    ctx = await setupApp();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('returns the stored ciphertext byte-for-byte', async () => {
    const bytes = new Uint8Array(256).map((_, i) => (i * 7) & 0xff);
    const id = await uploadBlob(ctx.app, bytes);

    const kp = await generateEd25519KeyPair();
    const req = await buildSignedRequest({
      method: 'GET',
      url: `/v1/blobs/${id}`,
      timestampSec: Math.floor(FIXED_NOW_MS / 1000),
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
    });
    const res = await ctx.app.inject({ method: req.method, url: req.url, headers: req.headers });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(Array.from(new Uint8Array(res.rawPayload))).toEqual(Array.from(bytes));
  });

  it('rejects an unsigned fetch with 401', async () => {
    const id = await uploadBlob(ctx.app, new Uint8Array([1]));
    const res = await ctx.app.inject({ method: 'GET', url: `/v1/blobs/${id}` });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 for an unknown id', async () => {
    const kp = await generateEd25519KeyPair();
    const req = await buildSignedRequest({
      method: 'GET',
      url: '/v1/blobs/00000000-0000-0000-0000-000000000099',
      timestampSec: Math.floor(FIXED_NOW_MS / 1000),
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
    });
    const res = await ctx.app.inject({ method: req.method, url: req.url, headers: req.headers });
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 for a non-uuid id', async () => {
    const kp = await generateEd25519KeyPair();
    const req = await buildSignedRequest({
      method: 'GET',
      url: '/v1/blobs/not-a-uuid',
      timestampSec: Math.floor(FIXED_NOW_MS / 1000),
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
    });
    const res = await ctx.app.inject({ method: req.method, url: req.url, headers: req.headers });
    expect(res.statusCode).toBe(400);
  });

  it('treats an expired blob as gone (404)', async () => {
    ctx.blobs.rows.push({
      id: '11111111-1111-1111-1111-111111111111',
      data: new Uint8Array([9, 9, 9]),
      byteSize: 3,
      createdAt: new Date(FIXED_NOW_MS - TTL_MS - 1000),
      expiresAt: new Date(FIXED_NOW_MS - 1),
    });
    const kp = await generateEd25519KeyPair();
    const req = await buildSignedRequest({
      method: 'GET',
      url: '/v1/blobs/11111111-1111-1111-1111-111111111111',
      timestampSec: Math.floor(FIXED_NOW_MS / 1000),
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
    });
    const res = await ctx.app.inject({ method: req.method, url: req.url, headers: req.headers });
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /v1/blobs/:id', () => {
  let ctx: TestCtx;
  beforeEach(async () => {
    ctx = await setupApp();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('removes the blob and returns ok', async () => {
    const id = await uploadBlob(ctx.app, new Uint8Array([1, 2, 3]));
    expect(ctx.blobs.rows).toHaveLength(1);
    const kp = await generateEd25519KeyPair();
    const req = await buildSignedRequest({
      method: 'DELETE',
      url: `/v1/blobs/${id}`,
      timestampSec: Math.floor(FIXED_NOW_MS / 1000),
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
    });
    const res = await ctx.app.inject({ method: req.method, url: req.url, headers: req.headers });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(ctx.blobs.rows).toHaveLength(0);
  });

  it('returns 404 deleting an unknown id', async () => {
    const kp = await generateEd25519KeyPair();
    const req = await buildSignedRequest({
      method: 'DELETE',
      url: '/v1/blobs/00000000-0000-0000-0000-000000000099',
      timestampSec: Math.floor(FIXED_NOW_MS / 1000),
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
    });
    const res = await ctx.app.inject({ method: req.method, url: req.url, headers: req.headers });
    expect(res.statusCode).toBe(404);
  });
});

describe('MemoryBlobStore.purgeExpired', () => {
  it('drops every row whose expires_at is at or before now', async () => {
    const { blobs } = await setupApp();
    blobs.rows.push(
      {
        id: 'a',
        data: new Uint8Array(0),
        byteSize: 0,
        createdAt: new Date(0),
        expiresAt: new Date(FIXED_NOW_MS - 1),
      },
      {
        id: 'b',
        data: new Uint8Array(0),
        byteSize: 0,
        createdAt: new Date(0),
        expiresAt: new Date(FIXED_NOW_MS + 60_000),
      },
    );
    const removed = await blobs.purgeExpired(new Date(FIXED_NOW_MS));
    expect(removed).toBe(1);
    expect(blobs.rows).toHaveLength(1);
    expect(blobs.rows[0]!.id).toBe('b');
  });
});
