import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { bytesToHex, generateEd25519KeyPair } from '@secretnotebook/crypto';
import type { FastifyInstance } from 'fastify';
import { loadEnv } from '../src/config.js';
import { buildApp } from '../src/server.js';
import {
  MemoryBlobStore,
  MemoryDevicesStore,
  MemoryPostsStore,
  MemoryRelayStore,
} from './helpers/memory-stores.js';
import { buildSignedRequest } from './helpers/signed-inject.js';

const FIXED_NOW_MS = 1_700_000_000_000;

interface TestCtx {
  app: FastifyInstance;
  posts: MemoryPostsStore;
  devices: MemoryDevicesStore;
  now: () => number;
}

async function setupApp(): Promise<TestCtx> {
  const posts = new MemoryPostsStore();
  const devices = new MemoryDevicesStore();
  const app = await buildApp({
    env: loadEnv({
      LOG_LEVEL: 'fatal',
      RATE_LIMIT_MAX: '1000',
      RATE_LIMIT_WINDOW_MS: '60000',
    }),
    now: () => FIXED_NOW_MS,
    postsStore: posts,
    devicesStore: devices,
    relayStore: new MemoryRelayStore(),
    blobsStore: new MemoryBlobStore(),
  });
  return { app, posts, devices, now: () => FIXED_NOW_MS };
}

function sha256Bytes(input: string): Uint8Array {
  return new Uint8Array(createHash('sha256').update(input).digest());
}

describe('POST /v1/posts', () => {
  let ctx: TestCtx;

  beforeEach(async () => {
    ctx = await setupApp();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('rejects an unsigned request with 401', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/posts',
      payload: { contentType: 'text', body: 'hello world' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('accepts a signed request and stores the post with the signer pubkey as anon_author', async () => {
    const kp = await generateEd25519KeyPair();
    const ts = Math.floor(ctx.now() / 1000);
    const req = await buildSignedRequest({
      method: 'POST',
      url: '/v1/posts',
      body: { contentType: 'text', body: 'hello world' },
      timestampSec: ts,
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
    });
    const res = await ctx.app.inject({
      method: req.method,
      url: req.url,
      headers: req.headers,
      payload: req.body,
    });
    expect(res.statusCode).toBe(200);
    const created = res.json() as { id: string; createdAt: string };
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(typeof created.createdAt).toBe('string');
    expect(ctx.posts.rows).toHaveLength(1);
    const stored = ctx.posts.rows[0];
    expect(stored).toBeDefined();
    expect(bytesToHex(stored!.anonAuthor)).toBe(bytesToHex(kp.publicKey));
    expect(bytesToHex(stored!.bodyHash)).toBe(bytesToHex(sha256Bytes('hello world')));
  });

  it('stores the author-tagged audience', async () => {
    const kp = await generateEd25519KeyPair();
    const ts = Math.floor(ctx.now() / 1000);
    const req = await buildSignedRequest({
      method: 'POST',
      url: '/v1/posts',
      body: { contentType: 'text', body: 'for him', audience: 'masculine' },
      timestampSec: ts,
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
    });
    const res = await ctx.app.inject({
      method: req.method,
      url: req.url,
      headers: req.headers,
      payload: req.body,
    });
    expect(res.statusCode).toBe(200);
    expect(ctx.posts.rows[0]?.audience).toBe('masculine');
  });

  it('defaults audience to everyone when omitted', async () => {
    const kp = await generateEd25519KeyPair();
    const ts = Math.floor(ctx.now() / 1000);
    const req = await buildSignedRequest({
      method: 'POST',
      url: '/v1/posts',
      body: { contentType: 'text', body: 'for anyone' },
      timestampSec: ts,
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
    });
    const res = await ctx.app.inject({
      method: req.method,
      url: req.url,
      headers: req.headers,
      payload: req.body,
    });
    expect(res.statusCode).toBe(200);
    expect(ctx.posts.rows[0]?.audience).toBe('everyone');
  });

  it('dedups by body_hash and returns the existing id', async () => {
    const kp = await generateEd25519KeyPair();
    const ts = Math.floor(ctx.now() / 1000);
    const firstReq = await buildSignedRequest({
      method: 'POST',
      url: '/v1/posts',
      body: { contentType: 'text', body: 'same content' },
      timestampSec: ts,
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
    });
    const first = await ctx.app.inject({
      method: firstReq.method,
      url: firstReq.url,
      headers: firstReq.headers,
      payload: firstReq.body,
    });
    expect(first.statusCode).toBe(200);
    const firstId = (first.json() as { id: string }).id;

    const kp2 = await generateEd25519KeyPair();
    const secondReq = await buildSignedRequest({
      method: 'POST',
      url: '/v1/posts',
      body: { contentType: 'text', body: 'same content' },
      timestampSec: ts,
      privateKey: kp2.privateKey,
      publicKey: kp2.publicKey,
    });
    const second = await ctx.app.inject({
      method: secondReq.method,
      url: secondReq.url,
      headers: secondReq.headers,
      payload: secondReq.body,
    });
    expect(second.statusCode).toBe(200);
    expect((second.json() as { id: string }).id).toBe(firstId);
    expect(ctx.posts.rows).toHaveLength(1);
  });

  it('rejects a body that fails Zod validation (empty body string)', async () => {
    const kp = await generateEd25519KeyPair();
    const ts = Math.floor(ctx.now() / 1000);
    const req = await buildSignedRequest({
      method: 'POST',
      url: '/v1/posts',
      body: { contentType: 'text', body: '' },
      timestampSec: ts,
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
    });
    const res = await ctx.app.inject({
      method: req.method,
      url: req.url,
      headers: req.headers,
      payload: req.body,
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when the JSON body is syntactically invalid (raw-body parser surfaces the error)', async () => {
    const kp = await generateEd25519KeyPair();
    const ts = Math.floor(ctx.now() / 1000);
    const rawBytes = Buffer.from('{ this is not json ', 'utf8');
    const bodyHash = createHash('sha256').update(rawBytes).digest('hex');
    const canonical = `POST|/v1/posts|${bodyHash}|${ts}`;
    const { ed25519Sign, bytesToHex: hex } = await import('@secretnotebook/crypto');
    const sig = await ed25519Sign(new TextEncoder().encode(canonical), kp.privateKey);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/posts',
      headers: {
        'x-device-pubkey': hex(kp.publicKey),
        'x-signature': hex(sig),
        'x-timestamp': String(ts),
        'content-type': 'application/json',
      },
      payload: rawBytes,
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a tampered body whose hash no longer matches the signed canonical string', async () => {
    const kp = await generateEd25519KeyPair();
    const ts = Math.floor(ctx.now() / 1000);
    const req = await buildSignedRequest({
      method: 'POST',
      url: '/v1/posts',
      body: { contentType: 'text', body: 'signed text' },
      timestampSec: ts,
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
    });
    const res = await ctx.app.inject({
      method: req.method,
      url: req.url,
      headers: req.headers,
      payload: { contentType: 'text', body: 'tampered text' },
    });
    expect(res.statusCode).toBe(401);
    expect(ctx.posts.rows).toHaveLength(0);
  });

  it('rejects a body whose contentType is not in the allowed enum', async () => {
    const kp = await generateEd25519KeyPair();
    const ts = Math.floor(ctx.now() / 1000);
    const req = await buildSignedRequest({
      method: 'POST',
      url: '/v1/posts',
      body: { contentType: 'image', body: 'whatever' },
      timestampSec: ts,
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
    });
    const res = await ctx.app.inject({
      method: req.method,
      url: req.url,
      headers: req.headers,
      payload: req.body,
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /v1/posts', () => {
  let ctx: TestCtx;

  beforeEach(async () => {
    ctx = await setupApp();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('rejects an unsigned request with 401', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/v1/posts' });
    expect(res.statusCode).toBe(401);
  });

  it('returns posts newest-first with stable pagination', async () => {
    const kp = await generateEd25519KeyPair();
    for (let i = 0; i < 5; i++) {
      ctx.posts.rows.push({
        id: `00000000-0000-0000-0000-00000000000${i}`,
        contentType: 'text',
        body: `post ${i}`,
        bodyHash: sha256Bytes(`post ${i}`),
        anonAuthor: kp.publicKey,
        createdAt: new Date(FIXED_NOW_MS - (5 - i) * 1000),
        popularity: 0,
        audience: 'everyone',
      });
    }

    const ts = Math.floor(ctx.now() / 1000);
    const page1 = await buildSignedRequest({
      method: 'GET',
      url: '/v1/posts?limit=2',
      timestampSec: ts,
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
    });
    const res1 = await ctx.app.inject({
      method: page1.method,
      url: page1.url,
      headers: page1.headers,
    });
    expect(res1.statusCode).toBe(200);
    const body1 = res1.json() as { items: Array<{ body: string }>; nextCursor: string | null };
    expect(body1.items.map((i) => i.body)).toEqual(['post 4', 'post 3']);
    expect(body1.nextCursor).not.toBeNull();

    const page2 = await buildSignedRequest({
      method: 'GET',
      url: `/v1/posts?limit=2&cursor=${encodeURIComponent(body1.nextCursor!)}`,
      timestampSec: ts,
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
    });
    const res2 = await ctx.app.inject({
      method: page2.method,
      url: page2.url,
      headers: page2.headers,
    });
    expect(res2.statusCode).toBe(200);
    const body2 = res2.json() as { items: Array<{ body: string }>; nextCursor: string | null };
    expect(body2.items.map((i) => i.body)).toEqual(['post 2', 'post 1']);
    expect(body2.nextCursor).not.toBeNull();

    const page3 = await buildSignedRequest({
      method: 'GET',
      url: `/v1/posts?limit=2&cursor=${encodeURIComponent(body2.nextCursor!)}`,
      timestampSec: ts,
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
    });
    const res3 = await ctx.app.inject({
      method: page3.method,
      url: page3.url,
      headers: page3.headers,
    });
    expect(res3.statusCode).toBe(200);
    const body3 = res3.json() as { items: Array<{ body: string }>; nextCursor: string | null };
    expect(body3.items.map((i) => i.body)).toEqual(['post 0']);
    expect(body3.nextCursor).toBeNull();
  });

  it('rejects an out-of-range limit', async () => {
    const kp = await generateEd25519KeyPair();
    const ts = Math.floor(ctx.now() / 1000);
    const req = await buildSignedRequest({
      method: 'GET',
      url: '/v1/posts?limit=999',
      timestampSec: ts,
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
    });
    const res = await ctx.app.inject({
      method: req.method,
      url: req.url,
      headers: req.headers,
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns an empty list with null cursor when nothing has been posted', async () => {
    const kp = await generateEd25519KeyPair();
    const ts = Math.floor(ctx.now() / 1000);
    const req = await buildSignedRequest({
      method: 'GET',
      url: '/v1/posts',
      timestampSec: ts,
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
    });
    const res = await ctx.app.inject({
      method: req.method,
      url: req.url,
      headers: req.headers,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [], nextCursor: null });
  });

  it('filters by audience: returns the role plus everyone, excludes the other role', async () => {
    const kp = await generateEd25519KeyPair();
    const mk = (i: number, audience: 'everyone' | 'masculine' | 'feminine') => ({
      id: `00000000-0000-0000-0000-00000000010${i}`,
      contentType: 'text',
      body: `${audience} ${i}`,
      bodyHash: sha256Bytes(`${audience} ${i}`),
      anonAuthor: kp.publicKey,
      createdAt: new Date(FIXED_NOW_MS - (9 - i) * 1000),
      popularity: 0,
      audience,
    });
    ctx.posts.rows.push(mk(0, 'everyone'), mk(1, 'masculine'), mk(2, 'feminine'));

    const ts = Math.floor(ctx.now() / 1000);
    const req = await buildSignedRequest({
      method: 'GET',
      url: '/v1/posts?audience=masculine',
      timestampSec: ts,
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
    });
    const res = await ctx.app.inject({ method: req.method, url: req.url, headers: req.headers });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ body: string; audience: string }> };
    expect(body.items.map((i) => i.audience).sort()).toEqual(['everyone', 'masculine']);
    expect(body.items.some((i) => i.audience === 'feminine')).toBe(false);
  });

  it('treats a malformed cursor as no cursor (returns the newest page)', async () => {
    const kp = await generateEd25519KeyPair();
    ctx.posts.rows.push({
      id: '22222222-2222-2222-2222-222222222222',
      contentType: 'text',
      body: 'only post',
      bodyHash: sha256Bytes('only post'),
      anonAuthor: kp.publicKey,
      createdAt: new Date(FIXED_NOW_MS),
      popularity: 0,
      audience: 'everyone',
    });
    const ts = Math.floor(ctx.now() / 1000);
    const req = await buildSignedRequest({
      method: 'GET',
      url: '/v1/posts?cursor=not-real-base64-json',
      timestampSec: ts,
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
    });
    const res = await ctx.app.inject({
      method: req.method,
      url: req.url,
      headers: req.headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ body: string }> };
    expect(body.items.map((i) => i.body)).toEqual(['only post']);
  });
});

describe('GET /v1/posts/:id', () => {
  let ctx: TestCtx;

  beforeEach(async () => {
    ctx = await setupApp();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('returns 404 for an unknown id', async () => {
    const kp = await generateEd25519KeyPair();
    const ts = Math.floor(ctx.now() / 1000);
    const req = await buildSignedRequest({
      method: 'GET',
      url: '/v1/posts/00000000-0000-0000-0000-000000000099',
      timestampSec: ts,
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
    });
    const res = await ctx.app.inject({
      method: req.method,
      url: req.url,
      headers: req.headers,
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 for a non-UUID id', async () => {
    const kp = await generateEd25519KeyPair();
    const ts = Math.floor(ctx.now() / 1000);
    const req = await buildSignedRequest({
      method: 'GET',
      url: '/v1/posts/not-a-uuid',
      timestampSec: ts,
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
    });
    const res = await ctx.app.inject({
      method: req.method,
      url: req.url,
      headers: req.headers,
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns the stored post with anon_author as hex', async () => {
    const kp = await generateEd25519KeyPair();
    const stored = {
      id: '11111111-1111-1111-1111-111111111111',
      contentType: 'text',
      body: 'lookup me',
      bodyHash: sha256Bytes('lookup me'),
      anonAuthor: kp.publicKey,
      createdAt: new Date(FIXED_NOW_MS),
      popularity: 0,
      audience: 'everyone',
    };
    ctx.posts.rows.push(stored);

    const ts = Math.floor(ctx.now() / 1000);
    const req = await buildSignedRequest({
      method: 'GET',
      url: `/v1/posts/${stored.id}`,
      timestampSec: ts,
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
    });
    const res = await ctx.app.inject({
      method: req.method,
      url: req.url,
      headers: req.headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      id: string;
      body: string;
      anonAuthor: string;
      contentType: string;
    };
    expect(body.id).toBe(stored.id);
    expect(body.body).toBe('lookup me');
    expect(body.contentType).toBe('text');
    expect(body.anonAuthor).toBe(bytesToHex(kp.publicKey));
  });
});
