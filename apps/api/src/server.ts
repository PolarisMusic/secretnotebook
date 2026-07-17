import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import httpSignaturePlugin, { HEADER_PUBKEY } from './auth/http-signature.js';
import type { Env } from './config.js';
import { adminPromptsRoute } from './routes/admin-prompts.js';
import { adminUiRoute } from './routes/admin-ui.js';
import { blobsRoute } from './routes/blobs.js';
import { devicesRoute } from './routes/devices.js';
import { healthRoute } from './routes/health.js';
import { pairRendezvousRoute } from './routes/pair-rendezvous.js';
import { postsRoute } from './routes/posts.js';
import { promptsRoute } from './routes/prompts.js';
import { relayRoute } from './routes/relay.js';
import type {
  BlobStore,
  DevicesStore,
  PairRendezvousStore,
  PostsStore,
  PromptsStore,
  RelayStore,
} from './storage/types.js';

export interface BuildAppOptions {
  env: Env;
  now?: () => number;
  postsStore: PostsStore;
  devicesStore: DevicesStore;
  relayStore: RelayStore;
  blobsStore: BlobStore;
  promptsStore: PromptsStore;
  pairRendezvousStore: PairRendezvousStore;
}

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const app = fastify({
    logger: { level: opts.env.LOG_LEVEL },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  void jsonSchemaTransform;

  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    const buf = body as Buffer;
    req.rawBody = buf;
    if (buf.length === 0) {
      done(null, undefined);
      return;
    }
    try {
      done(null, JSON.parse(buf.toString('utf8')));
    } catch (err) {
      const e = err instanceof Error ? err : new Error('invalid JSON body');
      (e as Error & { statusCode?: number }).statusCode = 400;
      done(e, undefined);
    }
  });

  // Binary uploads (encrypted media blobs). The body is opaque bytes; we keep
  // them on req.rawBody so the signature middleware hashes exactly the wire
  // bytes the client signed, and hand the same Buffer through as the body. The
  // per-route bodyLimit on /v1/blobs governs how large these may be.
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (req, body, done) => {
    const buf = body as Buffer;
    req.rawBody = buf;
    done(null, buf);
  });

  await app.register(sensible);
  await app.register(rateLimit, {
    max: opts.env.RATE_LIMIT_MAX,
    timeWindow: opts.env.RATE_LIMIT_WINDOW_MS,
    keyGenerator: (req: FastifyRequest) => {
      const pubkey = req.headers[HEADER_PUBKEY];
      if (typeof pubkey === 'string' && pubkey.length > 0) return pubkey.toLowerCase();
      return req.ip;
    },
  });
  await app.register(httpSignaturePlugin, {
    maxDriftSeconds: opts.env.SIGNATURE_MAX_DRIFT_SECONDS,
    now: opts.now,
  });
  await app.register(healthRoute);
  // Unauthenticated: the 6-character rendezvous code is the auth, and the
  // posted hellos are public keys (not secrets). See
  // routes/pair-rendezvous.ts for the threat model.
  await app.register(pairRendezvousRoute, { store: opts.pairRendezvousStore, now: opts.now });
  const nowDate = (): Date => new Date((opts.now ?? Date.now)());
  await app.register(postsRoute, { store: opts.postsStore, now: nowDate });
  await app.register(devicesRoute, { store: opts.devicesStore, now: nowDate });
  await app.register(relayRoute, {
    store: opts.relayStore,
    now: nowDate,
    ttlMs: opts.env.RELAY_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
  await app.register(blobsRoute, {
    store: opts.blobsStore,
    now: nowDate,
    ttlMs: opts.env.BLOB_TTL_DAYS * 24 * 60 * 60 * 1000,
    maxBytes: opts.env.BLOB_MAX_BYTES,
  });
  // Public prompt-library fetch — mobile clients cache locally.
  await app.register(promptsRoute, { store: opts.promptsStore, now: nowDate });
  // Admin surface only registers when ADMIN_TOKEN is set — a fresh
  // deploy has no admin endpoints at all.
  if (opts.env.ADMIN_TOKEN) {
    const token = opts.env.ADMIN_TOKEN;
    await app.register(adminPromptsRoute, { store: opts.promptsStore, token, now: nowDate });
    await app.register(adminUiRoute, { store: opts.promptsStore, token, now: nowDate });
  }

  return app;
}
