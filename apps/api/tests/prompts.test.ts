import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
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

const ADMIN_TOKEN = 'test-admin-token-with-enough-bytes';
const FIXED_NOW_MS = 1_700_000_000_000;

async function setupApp(opts: { adminToken?: string } = {}): Promise<{
  app: FastifyInstance;
  prompts: MemoryPromptsStore;
}> {
  const prompts = new MemoryPromptsStore();
  const envSource: Record<string, string> = {
    LOG_LEVEL: 'fatal',
    RATE_LIMIT_MAX: '1000',
    RATE_LIMIT_WINDOW_MS: '60000',
  };
  if (opts.adminToken !== undefined) envSource.ADMIN_TOKEN = opts.adminToken;
  const app = await buildApp({
    env: loadEnv(envSource),
    now: () => FIXED_NOW_MS,
    postsStore: new MemoryPostsStore(),
    devicesStore: new MemoryDevicesStore(),
    relayStore: new MemoryRelayStore(),
    blobsStore: new MemoryBlobStore(),
    promptsStore: prompts,
  });
  return { app, prompts };
}

describe('public GET /v1/prompts', () => {
  let app: FastifyInstance;
  let prompts: MemoryPromptsStore;

  beforeEach(async () => {
    ({ app, prompts } = await setupApp());
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns active prompts ordered by key', async () => {
    await prompts.create(
      { key: 'pq_b', text: 'second', categories: ['general'] },
      new Date(FIXED_NOW_MS),
    );
    await prompts.create(
      { key: 'pq_a', text: 'first', categories: ['general', 'dating'] },
      new Date(FIXED_NOW_MS),
    );

    const res = await app.inject({ method: 'GET', url: '/v1/prompts' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.map((p: { key: string }) => p.key)).toEqual(['pq_a', 'pq_b']);
    expect(body.items[0]).toEqual({
      key: 'pq_a',
      text: 'first',
      categories: ['general', 'dating'],
      sourceName: null,
      sourceUrl: null,
      sponsored: false,
    });
    expect(typeof body.fetchedAt).toBe('string');
  });

  it('omits retired prompts', async () => {
    await prompts.create(
      { key: 'pq_live', text: 'still here', categories: ['general'] },
      new Date(FIXED_NOW_MS),
    );
    await prompts.create(
      { key: 'pq_gone', text: 'going away', categories: ['general'] },
      new Date(FIXED_NOW_MS),
    );
    await prompts.retire('pq_gone', new Date(FIXED_NOW_MS));

    const res = await app.inject({ method: 'GET', url: '/v1/prompts' });
    const body = res.json();
    expect(body.items.map((p: { key: string }) => p.key)).toEqual(['pq_live']);
  });

  it('is reachable without authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/prompts' });
    expect(res.statusCode).toBe(200);
  });
});

describe('admin /v1/admin/prompts', () => {
  describe('when ADMIN_TOKEN is unset', () => {
    it('does not register the admin surface', async () => {
      const { app } = await setupApp();
      const res = await app.inject({ method: 'GET', url: '/v1/admin/prompts' });
      expect(res.statusCode).toBe(404);
      await app.close();
    });
  });

  describe('when ADMIN_TOKEN is set', () => {
    let app: FastifyInstance;
    let prompts: MemoryPromptsStore;

    beforeEach(async () => {
      ({ app, prompts } = await setupApp({ adminToken: ADMIN_TOKEN }));
    });

    afterEach(async () => {
      await app.close();
    });

    it('rejects missing Authorization header with 401', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/admin/prompts' });
      expect(res.statusCode).toBe(401);
    });

    it('rejects a wrong Bearer token with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/admin/prompts',
        headers: { authorization: 'Bearer wrong-token-not-the-real-one' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('creates, lists, edits, retires, and unretires a prompt', async () => {
      // Create
      const createRes = await app.inject({
        method: 'POST',
        url: '/v1/admin/prompts',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: {
          key: 'pq_new',
          text: 'A new prompt',
          categories: ['general', 'dating'],
          sourceName: 'Test Source',
          sourceUrl: 'https://example.com',
          sponsored: true,
        },
      });
      expect(createRes.statusCode).toBe(200);
      expect(prompts.rows).toHaveLength(1);
      expect(prompts.rows[0]?.sponsored).toBe(true);

      // List (includes the new row)
      const listRes = await app.inject({
        method: 'GET',
        url: '/v1/admin/prompts',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      expect(listRes.statusCode).toBe(200);
      const list = listRes.json();
      expect(list.items).toHaveLength(1);
      expect(list.items[0].key).toBe('pq_new');

      // Patch text
      const patchRes = await app.inject({
        method: 'PATCH',
        url: '/v1/admin/prompts/pq_new',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { text: 'A better prompt' },
      });
      expect(patchRes.statusCode).toBe(200);
      expect(prompts.rows[0]?.text).toBe('A better prompt');

      // Retire
      const retireRes = await app.inject({
        method: 'POST',
        url: '/v1/admin/prompts/pq_new/retire',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      expect(retireRes.statusCode).toBe(200);
      expect(prompts.rows[0]?.retiredAt).not.toBeNull();

      // Public list excludes it
      const publicRes = await app.inject({ method: 'GET', url: '/v1/prompts' });
      expect(publicRes.json().items).toHaveLength(0);

      // Unretire
      const unretireRes = await app.inject({
        method: 'POST',
        url: '/v1/admin/prompts/pq_new/unretire',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      expect(unretireRes.statusCode).toBe(200);
      expect(prompts.rows[0]?.retiredAt).toBeNull();
    });

    it('refuses creating a duplicate key', async () => {
      await prompts.create(
        { key: 'pq_dup', text: 'taken', categories: ['general'] },
        new Date(FIXED_NOW_MS),
      );
      const res = await app.inject({
        method: 'POST',
        url: '/v1/admin/prompts',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { key: 'pq_dup', text: 'other', categories: ['general'] },
      });
      expect(res.statusCode).toBe(409);
    });

    it('rejects an empty patch body', async () => {
      await prompts.create(
        { key: 'pq_edit', text: 'original', categories: ['general'] },
        new Date(FIXED_NOW_MS),
      );
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/admin/prompts/pq_edit',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects an invalid key on create', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/admin/prompts',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { key: 'BadKey-WithDashes', text: 'x', categories: ['general'] },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
