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
import { devicesRoute } from './routes/devices.js';
import { healthRoute } from './routes/health.js';
import { postsRoute } from './routes/posts.js';
import type { DevicesStore, PostsStore } from './storage/types.js';

export interface BuildAppOptions {
  env: Env;
  now?: () => number;
  postsStore: PostsStore;
  devicesStore: DevicesStore;
}

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const app = fastify({
    logger: { level: opts.env.LOG_LEVEL },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  void jsonSchemaTransform;

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
  const nowDate = (): Date => new Date((opts.now ?? Date.now)());
  await app.register(postsRoute, { store: opts.postsStore, now: nowDate });
  await app.register(devicesRoute, { store: opts.devicesStore, now: nowDate });

  return app;
}
