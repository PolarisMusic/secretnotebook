import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { bytesToHex, ed25519Sign, generateEd25519KeyPair } from '@secretnotebook/crypto';
import type { FastifyInstance } from 'fastify';
import {
  canonicalRequestString,
  HEADER_PUBKEY,
  HEADER_SIGNATURE,
  HEADER_TIMESTAMP,
  sha256Hex,
} from '../src/auth/http-signature.js';
import { loadEnv } from '../src/config.js';
import { buildApp } from '../src/server.js';
import {
  MemoryBlobStore,
  MemoryDevicesStore,
  MemoryPostsStore,
  MemoryPromptsStore,
  MemoryPromptsStore,
  MemoryRelayStore,
} from './helpers/memory-stores.js';

const FIXED_NOW_MS = 1_700_000_000_000;

describe('GET /v1/health', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp({
      env: loadEnv({ LOG_LEVEL: 'fatal', RATE_LIMIT_MAX: '1000' }),
      now: () => FIXED_NOW_MS,
      postsStore: new MemoryPostsStore(),
      devicesStore: new MemoryDevicesStore(),
      relayStore: new MemoryRelayStore(),
      blobsStore: new MemoryBlobStore(),
      promptsStore: new MemoryPromptsStore(),
    });
  });
  afterEach(async () => {
    await app.close();
  });

  it('returns 200 with the expected body and does not require signing', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, service: 'secretnotebook-api', version: '0.0.0' });
  });
});

describe('signed-request enforcement on a protected fixture route', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp({
      env: loadEnv({ LOG_LEVEL: 'fatal', RATE_LIMIT_MAX: '1000' }),
      now: () => FIXED_NOW_MS,
      postsStore: new MemoryPostsStore(),
      devicesStore: new MemoryDevicesStore(),
      relayStore: new MemoryRelayStore(),
      blobsStore: new MemoryBlobStore(),
      promptsStore: new MemoryPromptsStore(),
    });
    app.get('/v1/_test/protected', { preHandler: app.requireSignature }, async (req) => ({
      pubkey: req.devicePubkey ? bytesToHex(req.devicePubkey) : null,
    }));
  });
  afterEach(async () => {
    await app.close();
  });

  it('rejects unsigned requests with 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/_test/protected' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('unauthorized');
  });

  it('accepts a correctly-signed request and exposes the pubkey on the request', async () => {
    const kp = await generateEd25519KeyPair();
    const ts = String(Math.floor(FIXED_NOW_MS / 1000));
    const canonical = canonicalRequestString('GET', '/v1/_test/protected', sha256Hex(null), ts);
    const sig = await ed25519Sign(new TextEncoder().encode(canonical), kp.privateKey);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/_test/protected',
      headers: {
        [HEADER_PUBKEY]: bytesToHex(kp.publicKey),
        [HEADER_SIGNATURE]: bytesToHex(sig),
        [HEADER_TIMESTAMP]: ts,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ pubkey: bytesToHex(kp.publicKey) });
  });

  it('rejects a request whose timestamp is stale', async () => {
    const kp = await generateEd25519KeyPair();
    const staleTs = String(Math.floor(FIXED_NOW_MS / 1000) - 1000);
    const canonical = canonicalRequestString(
      'GET',
      '/v1/_test/protected',
      sha256Hex(null),
      staleTs,
    );
    const sig = await ed25519Sign(new TextEncoder().encode(canonical), kp.privateKey);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/_test/protected',
      headers: {
        [HEADER_PUBKEY]: bytesToHex(kp.publicKey),
        [HEADER_SIGNATURE]: bytesToHex(sig),
        [HEADER_TIMESTAMP]: staleTs,
      },
    });
    expect(res.statusCode).toBe(401);
  });
});
