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
const BLINDED = 'aa'.repeat(32); // 64-char hex

interface TestCtx {
  app: FastifyInstance;
  relay: MemoryRelayStore;
  ttlMs: number;
}

async function setupApp(): Promise<TestCtx> {
  const relay = new MemoryRelayStore();
  const app = await buildApp({
    env: loadEnv({
      LOG_LEVEL: 'fatal',
      RATE_LIMIT_MAX: '1000',
      RATE_LIMIT_WINDOW_MS: '60000',
    }),
    now: () => FIXED_NOW_MS,
    postsStore: new MemoryPostsStore(),
    devicesStore: new MemoryDevicesStore(),
    relayStore: relay,
    blobsStore: new MemoryBlobStore(),
    promptsStore: new MemoryPromptsStore(),
    pairRendezvousStore: new MemoryPairRendezvousStore(),
  });
  return { app, relay, ttlMs: 30 * 24 * 60 * 60 * 1000 };
}

function envelopeBody(
  args: { recipient?: string; header?: string; ciphertext?: string; sentAtMs?: number } = {},
): {
  v: 1;
  recipientBlindedId: string;
  header: string;
  ciphertext: string;
  sentAt: string;
} {
  return {
    v: 1,
    recipientBlindedId: args.recipient ?? BLINDED,
    header: args.header ?? Buffer.from(new Uint8Array([1, 2, 3])).toString('base64'),
    ciphertext:
      args.ciphertext ?? Buffer.from(new Uint8Array([0xde, 0xad, 0xbe, 0xef])).toString('base64'),
    sentAt: new Date(args.sentAtMs ?? FIXED_NOW_MS).toISOString(),
  };
}

describe('POST /v1/relay/inbox/:blindedId', () => {
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
      url: `/v1/relay/inbox/${BLINDED}`,
      payload: envelopeBody(),
    });
    expect(res.statusCode).toBe(401);
  });

  it('stores an envelope and returns its id, receivedAt, expiresAt', async () => {
    const kp = await generateEd25519KeyPair();
    const ts = Math.floor(FIXED_NOW_MS / 1000);
    const body = envelopeBody();
    const req = await buildSignedRequest({
      method: 'POST',
      url: `/v1/relay/inbox/${BLINDED}`,
      body,
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
    const out = res.json() as { id: string; receivedAt: string; expiresAt: string };
    expect(out.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(out.expiresAt).getTime() - new Date(out.receivedAt).getTime()).toBe(ctx.ttlMs);
    expect(ctx.relay.rows).toHaveLength(1);
    expect(bytesToHex(ctx.relay.rows[0]!.blindedId)).toBe(BLINDED);
  });

  it('rejects an envelope whose recipientBlindedId does not match the URL', async () => {
    const kp = await generateEd25519KeyPair();
    const ts = Math.floor(FIXED_NOW_MS / 1000);
    const body = envelopeBody({ recipient: 'bb'.repeat(32) });
    const req = await buildSignedRequest({
      method: 'POST',
      url: `/v1/relay/inbox/${BLINDED}`,
      body,
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
    expect(ctx.relay.rows).toHaveLength(0);
  });

  it('rejects a malformed blindedId path param (not 32 bytes of hex)', async () => {
    const kp = await generateEd25519KeyPair();
    const ts = Math.floor(FIXED_NOW_MS / 1000);
    const body = envelopeBody({ recipient: 'aa' });
    const req = await buildSignedRequest({
      method: 'POST',
      url: `/v1/relay/inbox/aa`,
      body,
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

  it('stores opaque bytes — server-side never learns plaintext (round-trip is byte-equal)', async () => {
    const kp = await generateEd25519KeyPair();
    const ts = Math.floor(FIXED_NOW_MS / 1000);
    const headerBytes = new Uint8Array([7, 7, 7, 7, 7, 7]);
    const cipherBytes = new Uint8Array(64).fill(0x55);
    const body = envelopeBody({
      header: Buffer.from(headerBytes).toString('base64'),
      ciphertext: Buffer.from(cipherBytes).toString('base64'),
    });
    const req = await buildSignedRequest({
      method: 'POST',
      url: `/v1/relay/inbox/${BLINDED}`,
      body,
      timestampSec: ts,
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
    });
    await ctx.app.inject({
      method: req.method,
      url: req.url,
      headers: req.headers,
      payload: req.body,
    });
    const stored = ctx.relay.rows[0]!;
    expect(Array.from(stored.header)).toEqual(Array.from(headerBytes));
    expect(Array.from(stored.ciphertext)).toEqual(Array.from(cipherBytes));
  });
});

describe('GET /v1/relay/inbox/:blindedId', () => {
  let ctx: TestCtx;
  beforeEach(async () => {
    ctx = await setupApp();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  async function postEnvelope(seed: number): Promise<string> {
    const kp = await generateEd25519KeyPair();
    const ts = Math.floor(FIXED_NOW_MS / 1000);
    const body = envelopeBody({
      header: Buffer.from(new Uint8Array([seed])).toString('base64'),
      ciphertext: Buffer.from(new Uint8Array([seed, seed, seed])).toString('base64'),
      sentAtMs: FIXED_NOW_MS - (10 - seed) * 1000,
    });
    const req = await buildSignedRequest({
      method: 'POST',
      url: `/v1/relay/inbox/${BLINDED}`,
      body,
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
    return (res.json() as { id: string }).id;
  }

  it('returns newest-first envelopes for the matching blindedId only', async () => {
    // Seed two envelopes for our blindedId and one for a different one.
    const ourIds = [await postEnvelope(1), await postEnvelope(2), await postEnvelope(3)];
    // Different blindedId — should not show up.
    const otherKp = await generateEd25519KeyPair();
    const otherBody = envelopeBody({ recipient: 'bb'.repeat(32) });
    const otherTs = Math.floor(FIXED_NOW_MS / 1000);
    const otherReq = await buildSignedRequest({
      method: 'POST',
      url: `/v1/relay/inbox/${'bb'.repeat(32)}`,
      body: otherBody,
      timestampSec: otherTs,
      privateKey: otherKp.privateKey,
      publicKey: otherKp.publicKey,
    });
    await ctx.app.inject({
      method: otherReq.method,
      url: otherReq.url,
      headers: otherReq.headers,
      payload: otherReq.body,
    });

    const kp = await generateEd25519KeyPair();
    const ts = Math.floor(FIXED_NOW_MS / 1000);
    const list = await buildSignedRequest({
      method: 'GET',
      url: `/v1/relay/inbox/${BLINDED}`,
      timestampSec: ts,
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
    });
    const res = await ctx.app.inject({
      method: list.method,
      url: list.url,
      headers: list.headers,
    });
    expect(res.statusCode).toBe(200);
    const out = res.json() as {
      items: Array<{ id: string; recipientBlindedId: string }>;
      nextCursor: string | null;
    };
    expect(out.items).toHaveLength(3);
    expect(out.items.every((i) => i.recipientBlindedId === BLINDED)).toBe(true);
    // The fixed clock means all three share a receivedAt, so the
    // (receivedAt, id) sort tiebreaker falls back to the random UUIDs;
    // we assert the set of ids is correct and the ordering invariant
    // (DESC id within the same receivedAt) holds, rather than insertion
    // order.
    expect(new Set(out.items.map((i) => i.id))).toEqual(new Set(ourIds));
    const ids = out.items.map((i) => i.id);
    expect([...ids].sort().reverse()).toEqual(ids);
  });

  it('paginates with `since` (opaque cursor) and stops with nextCursor=null', async () => {
    for (let i = 0; i < 5; i++) await postEnvelope(i);

    const kp = await generateEd25519KeyPair();
    const ts = Math.floor(FIXED_NOW_MS / 1000);
    const p1 = await buildSignedRequest({
      method: 'GET',
      url: `/v1/relay/inbox/${BLINDED}?limit=2`,
      timestampSec: ts,
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
    });
    const r1 = await ctx.app.inject({ method: p1.method, url: p1.url, headers: p1.headers });
    const b1 = r1.json() as { items: unknown[]; nextCursor: string | null };
    expect(b1.items).toHaveLength(2);
    expect(b1.nextCursor).not.toBeNull();

    const p2 = await buildSignedRequest({
      method: 'GET',
      url: `/v1/relay/inbox/${BLINDED}?limit=2&since=${encodeURIComponent(b1.nextCursor!)}`,
      timestampSec: ts,
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
    });
    const r2 = await ctx.app.inject({ method: p2.method, url: p2.url, headers: p2.headers });
    const b2 = r2.json() as { items: unknown[]; nextCursor: string | null };
    expect(b2.items).toHaveLength(2);
    expect(b2.nextCursor).not.toBeNull();

    const p3 = await buildSignedRequest({
      method: 'GET',
      url: `/v1/relay/inbox/${BLINDED}?limit=2&since=${encodeURIComponent(b2.nextCursor!)}`,
      timestampSec: ts,
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
    });
    const r3 = await ctx.app.inject({ method: p3.method, url: p3.url, headers: p3.headers });
    const b3 = r3.json() as { items: unknown[]; nextCursor: string | null };
    expect(b3.items).toHaveLength(1);
    expect(b3.nextCursor).toBeNull();
  });

  it('hides envelopes whose expires_at has already passed (server-time check)', async () => {
    // Insert directly into the in-memory store with an expired TTL.
    ctx.relay.rows.push({
      id: '11111111-1111-1111-1111-111111111111',
      blindedId: new Uint8Array(32).fill(0xaa),
      header: new Uint8Array([1]),
      ciphertext: new Uint8Array([2]),
      sentAt: new Date(FIXED_NOW_MS - 60_000),
      receivedAt: new Date(FIXED_NOW_MS - 60_000),
      expiresAt: new Date(FIXED_NOW_MS - 1),
    });
    // …and a live one.
    await postEnvelope(7);

    const kp = await generateEd25519KeyPair();
    const ts = Math.floor(FIXED_NOW_MS / 1000);
    const req = await buildSignedRequest({
      method: 'GET',
      url: `/v1/relay/inbox/${BLINDED}`,
      timestampSec: ts,
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
    });
    const res = await ctx.app.inject({ method: req.method, url: req.url, headers: req.headers });
    const out = res.json() as { items: Array<{ id: string }>; nextCursor: string | null };
    expect(out.items).toHaveLength(1);
    expect(out.items[0]!.id).not.toBe('11111111-1111-1111-1111-111111111111');
  });
});

describe('DELETE /v1/relay/inbox/:blindedId/:envelopeId', () => {
  let ctx: TestCtx;
  beforeEach(async () => {
    ctx = await setupApp();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('removes the envelope and returns ok', async () => {
    const kp = await generateEd25519KeyPair();
    const ts = Math.floor(FIXED_NOW_MS / 1000);
    const post = await buildSignedRequest({
      method: 'POST',
      url: `/v1/relay/inbox/${BLINDED}`,
      body: envelopeBody(),
      timestampSec: ts,
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
    });
    const postRes = await ctx.app.inject({
      method: post.method,
      url: post.url,
      headers: post.headers,
      payload: post.body,
    });
    const envelopeId = (postRes.json() as { id: string }).id;
    expect(ctx.relay.rows).toHaveLength(1);

    const del = await buildSignedRequest({
      method: 'DELETE',
      url: `/v1/relay/inbox/${BLINDED}/${envelopeId}`,
      timestampSec: ts,
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
    });
    const delRes = await ctx.app.inject({
      method: del.method,
      url: del.url,
      headers: del.headers,
    });
    expect(delRes.statusCode).toBe(200);
    expect(delRes.json()).toEqual({ ok: true });
    expect(ctx.relay.rows).toHaveLength(0);
  });

  it('returns 404 for an unknown envelope id', async () => {
    const kp = await generateEd25519KeyPair();
    const ts = Math.floor(FIXED_NOW_MS / 1000);
    const del = await buildSignedRequest({
      method: 'DELETE',
      url: `/v1/relay/inbox/${BLINDED}/00000000-0000-0000-0000-000000000099`,
      timestampSec: ts,
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
    });
    const res = await ctx.app.inject({
      method: del.method,
      url: del.url,
      headers: del.headers,
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 for a non-UUID envelope id', async () => {
    const kp = await generateEd25519KeyPair();
    const ts = Math.floor(FIXED_NOW_MS / 1000);
    const del = await buildSignedRequest({
      method: 'DELETE',
      url: `/v1/relay/inbox/${BLINDED}/not-a-uuid`,
      timestampSec: ts,
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
    });
    const res = await ctx.app.inject({
      method: del.method,
      url: del.url,
      headers: del.headers,
    });
    expect(res.statusCode).toBe(400);
  });

  it('refuses to remove an envelope whose blindedId does not match — the path is bearer-scoped', async () => {
    // Seed an envelope under one blindedId.
    const kp = await generateEd25519KeyPair();
    const ts = Math.floor(FIXED_NOW_MS / 1000);
    const post = await buildSignedRequest({
      method: 'POST',
      url: `/v1/relay/inbox/${BLINDED}`,
      body: envelopeBody(),
      timestampSec: ts,
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
    });
    const postRes = await ctx.app.inject({
      method: post.method,
      url: post.url,
      headers: post.headers,
      payload: post.body,
    });
    const envelopeId = (postRes.json() as { id: string }).id;

    // Try to delete with a *different* blindedId — should 404, envelope stays.
    const wrongBlinded = 'cc'.repeat(32);
    const del = await buildSignedRequest({
      method: 'DELETE',
      url: `/v1/relay/inbox/${wrongBlinded}/${envelopeId}`,
      timestampSec: ts,
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
    });
    const res = await ctx.app.inject({
      method: del.method,
      url: del.url,
      headers: del.headers,
    });
    expect(res.statusCode).toBe(404);
    expect(ctx.relay.rows).toHaveLength(1);
  });
});

describe('MemoryRelayStore.purgeExpired', () => {
  it('drops every row whose expires_at is at or before now', async () => {
    const { relay } = await setupApp();
    relay.rows.push(
      {
        id: 'a',
        blindedId: new Uint8Array(32),
        header: new Uint8Array(0),
        ciphertext: new Uint8Array(0),
        sentAt: new Date(0),
        receivedAt: new Date(0),
        expiresAt: new Date(FIXED_NOW_MS - 1),
      },
      {
        id: 'b',
        blindedId: new Uint8Array(32),
        header: new Uint8Array(0),
        ciphertext: new Uint8Array(0),
        sentAt: new Date(0),
        receivedAt: new Date(0),
        expiresAt: new Date(FIXED_NOW_MS + 60_000),
      },
    );
    const removed = await relay.purgeExpired(new Date(FIXED_NOW_MS));
    expect(removed).toBe(1);
    expect(relay.rows).toHaveLength(1);
    expect(relay.rows[0]!.id).toBe('b');
  });
});
