import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

const HealthResponseSchema = z.object({
  ok: z.literal(true),
  service: z.literal('secretnotebook-api'),
  version: z.string(),
});

export const healthRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/v1/health',
    {
      schema: {
        response: { 200: HealthResponseSchema },
      },
    },
    async () => ({
      ok: true as const,
      service: 'secretnotebook-api' as const,
      version: '0.0.0',
    }),
  );
};
