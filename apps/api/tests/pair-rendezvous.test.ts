import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import type { FastifyInstance } from 'fastify';
import { loadEnv } from '../src/config.js';
import { buildApp } from '../src/server.js';
import {
  MemoryBlobStore,
  MemoryDevicesStore,
  MemoryPostsStore,
  MemoryRelayStore,
} from './helpers/memory-stores.js';

const FIXED_NOW_MS = 1_700_000_000_000;

async function setupApp(): Promise<FastifyInstance> {
  return buildApp({
    env: loadEnv({
      LOG_LEVEL: 'fatal',
      RATE_LIMIT_MAX: '1000',
      RATE_LIMIT_WINDOW_MS: '60000',
    }),
    now: () => FIXED_NOW_MS,
    postsStore: new MemoryPostsStore(),
    devicesStore: new MemoryDevicesStore(),
    relayStore: new MemoryRelayStore(),
    blobsStore: new MemoryBlobStore(),
  });
}

describe('pair rendezvous', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await setupApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('returns an empty list for an unknown code', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/pair/unused-code-1' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ hellos: [] });
  });

  it('accepts two hellos and returns both on GET', async () => {
    const code = 'bluefox42';
    const r1 = await app.inject({
      method: 'POST',
      url: `/v1/pair/${code}`,
      payload: { hello: 'aaaa' },
    });
    expect(r1.statusCode).toBe(200);
    expect(r1.json()).toMatchObject({ ok: true, count: 1 });

    const r2 = await app.inject({
      method: 'POST',
      url: `/v1/pair/${code}`,
      payload: { hello: 'bbbb' },
    });
    expect(r2.statusCode).toBe(200);
    expect(r2.json()).toMatchObject({ ok: true, count: 2 });

    const list = await app.inject({ method: 'GET', url: `/v1/pair/${code}` });
    expect(list.statusCode).toBe(200);
    const body = list.json() as { hellos: Array<{ hello: string }> };
    expect(body.hellos.map((h) => h.hello).sort()).toEqual(['aaaa', 'bbbb']);
  });

  it('is idempotent for a repeat POST of the same hello', async () => {
    const code = 'samecode1';
    await app.inject({ method: 'POST', url: `/v1/pair/${code}`, payload: { hello: 'aaaa' } });
    const again = await app.inject({
      method: 'POST',
      url: `/v1/pair/${code}`,
      payload: { hello: 'aaaa' },
    });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ count: 1 });
  });

  it('rejects a third distinct hello on the same code', async () => {
    const code = 'threehel';
    await app.inject({ method: 'POST', url: `/v1/pair/${code}`, payload: { hello: 'aaaa' } });
    await app.inject({ method: 'POST', url: `/v1/pair/${code}`, payload: { hello: 'bbbb' } });
    const third = await app.inject({
      method: 'POST',
      url: `/v1/pair/${code}`,
      payload: { hello: 'cccc' },
    });
    expect(third.statusCode).toBe(409);
  });

  it('rejects malformed codes', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/pair/short',
      payload: { hello: 'aaaa' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('lowercases the code so casing differences still rendezvous', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/pair/MixedCase1',
      payload: { hello: 'aaaa' },
    });
    const res = await app.inject({ method: 'GET', url: '/v1/pair/mixedcase1' });
    const body = res.json() as { hellos: Array<{ hello: string }> };
    expect(body.hellos).toHaveLength(1);
  });
});
