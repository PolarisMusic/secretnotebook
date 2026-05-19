import sensible from '@fastify/sensible';
import fastify, { type FastifyInstance } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import httpSignaturePlugin from './auth/http-signature.js';
import type { Env } from './config.js';
import { healthRoute } from './routes/health.js';

export interface BuildAppOptions {
  env: Env;
  now?: () => number;
}

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const app = fastify({
    logger: { level: opts.env.LOG_LEVEL },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  void jsonSchemaTransform;

  await app.register(sensible);
  await app.register(httpSignaturePlugin, {
    maxDriftSeconds: opts.env.SIGNATURE_MAX_DRIFT_SECONDS,
    now: opts.now,
  });
  await app.register(healthRoute);

  return app;
}
