import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { bytesToHex, generateEd25519KeyPair } from '@secretnotebook/crypto';
import type { FastifyInstance } from 'fastify';
import { loadEnv } from '../src/config.js';
import { buildApp } from '../src/server.js';
import {
  MemoryBlobStore,
  MemoryDevicesStore,
  MemoryPairRendezvousStore,
  MemoryPostsStore,
  MemoryPromptsStore,
  MemoryRelayStore,
} from './helpers/memory-stores.js';
import { buildSignedRequest } from './helpers/signed-inject.js';

const FIXED_NOW_MS = 1_700_000_000_000;

interface TestCtx {
  app: FastifyInstance;
  posts: MemoryPostsStore;
  devices: MemoryDevicesStore;
}

async function setupApp(maxRequests: number): Promise<TestCtx> {
  const posts = new MemoryPostsStore();
  const devices = new MemoryDevicesStore();
  const app = await buildApp({
    env: loadEnv({
      LOG_LEVEL: 'fatal',
      RATE_LIMIT_MAX: String(maxRequests),
      RATE_LIMIT_WINDOW_MS: '60000',
    }),
    now: () => FIXED_NOW_MS,
    postsStore: posts,
    devicesStore: devices,
    relayStore: new MemoryRelayStore(),
    blobsStore: new MemoryBlobStore(),
    promptsStore: new MemoryPromptsStore(),
    pairRendezvousStore: new MemoryPairRendezvousStore(),
  });
  return { app, posts, devices };
}

describe('rate limiting keyed by device pubkey', () => {
  let ctx: TestCtx;

  beforeEach(async () => {
    ctx = await setupApp(3);
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('returns 429 once a single device pubkey exceeds the configured threshold', async () => {
    const kp = await generateEd25519KeyPair();
    const ts = Math.floor(FIXED_NOW_MS / 1000);

    const buildOne = (i: number): Promise<ReturnType<typeof buildSignedRequest>> =>
      buildSignedRequest({
        method: 'POST',
        url: '/v1/posts',
        body: { contentType: 'text', body: `unique post ${i}` },
        timestampSec: ts,
        privateKey: kp.privateKey,
        publicKey: kp.publicKey,
      });

    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      const req = await buildOne(i);
      const res = await ctx.app.inject({
        method: req.method,
        url: req.url,
        headers: req.headers,
        payload: req.body,
      });
      codes.push(res.statusCode);
    }

    expect(codes.slice(0, 3)).toEqual([200, 200, 200]);
    expect(codes.slice(3)).toEqual([429, 429]);
  });

  it('does not penalize a separate device pubkey under its own quota', async () => {
    const kpA = await generateEd25519KeyPair();
    const kpB = await generateEd25519KeyPair();
    const ts = Math.floor(FIXED_NOW_MS / 1000);

    const buildFor = (
      kp: { publicKey: Uint8Array; privateKey: Uint8Array },
      i: number,
    ): Promise<ReturnType<typeof buildSignedRequest>> =>
      buildSignedRequest({
        method: 'POST',
        url: '/v1/posts',
        body: { contentType: 'text', body: `${bytesToHex(kp.publicKey).slice(0, 6)} post ${i}` },
        timestampSec: ts,
        privateKey: kp.privateKey,
        publicKey: kp.publicKey,
      });

    for (let i = 0; i < 3; i++) {
      const req = await buildFor(kpA, i);
      const res = await ctx.app.inject({
        method: req.method,
        url: req.url,
        headers: req.headers,
        payload: req.body,
      });
      expect(res.statusCode).toBe(200);
    }

    const limited = await buildFor(kpA, 99);
    const limitedRes = await ctx.app.inject({
      method: limited.method,
      url: limited.url,
      headers: limited.headers,
      payload: limited.body,
    });
    expect(limitedRes.statusCode).toBe(429);

    const fresh = await buildFor(kpB, 0);
    const freshRes = await ctx.app.inject({
      method: fresh.method,
      url: fresh.url,
      headers: fresh.headers,
      payload: fresh.body,
    });
    expect(freshRes.statusCode).toBe(200);
  });
});
