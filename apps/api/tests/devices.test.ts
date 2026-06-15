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

describe('POST /v1/devices/register', () => {
  let ctx: TestCtx;

  beforeEach(async () => {
    ctx = await setupApp();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('rejects unsigned requests with 401', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/devices/register',
      payload: { pubkey: 'a'.repeat(64) },
    });
    expect(res.statusCode).toBe(401);
  });

  it('registers a device whose body pubkey matches the signer', async () => {
    const kp = await generateEd25519KeyPair();
    const ts = Math.floor(ctx.now() / 1000);
    const req = await buildSignedRequest({
      method: 'POST',
      url: '/v1/devices/register',
      body: { pubkey: bytesToHex(kp.publicKey) },
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
    expect(res.json()).toEqual({ ok: true });
    expect(await ctx.devices.exists(kp.publicKey)).toBe(true);
  });

  it('rejects when the body pubkey does not match the signer', async () => {
    const kp = await generateEd25519KeyPair();
    const other = await generateEd25519KeyPair();
    const ts = Math.floor(ctx.now() / 1000);
    const req = await buildSignedRequest({
      method: 'POST',
      url: '/v1/devices/register',
      body: { pubkey: bytesToHex(other.publicKey) },
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
    expect(res.statusCode).toBe(401);
    expect(await ctx.devices.exists(other.publicKey)).toBe(false);
    expect(await ctx.devices.exists(kp.publicKey)).toBe(false);
  });

  it('is idempotent — registering the same device twice still returns ok', async () => {
    const kp = await generateEd25519KeyPair();
    const ts = Math.floor(ctx.now() / 1000);
    const req = await buildSignedRequest({
      method: 'POST',
      url: '/v1/devices/register',
      body: { pubkey: bytesToHex(kp.publicKey) },
      timestampSec: ts,
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
    });
    const inject = async () =>
      ctx.app.inject({
        method: req.method,
        url: req.url,
        headers: req.headers,
        payload: req.body,
      });
    const first = await inject();
    expect(first.statusCode).toBe(200);
    const second = await inject();
    expect(second.statusCode).toBe(200);
    expect(ctx.devices.registered.size).toBe(1);
  });

  it('rejects a body pubkey that is not 32 bytes of hex', async () => {
    const kp = await generateEd25519KeyPair();
    const ts = Math.floor(ctx.now() / 1000);
    const req = await buildSignedRequest({
      method: 'POST',
      url: '/v1/devices/register',
      body: { pubkey: 'ab' },
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
