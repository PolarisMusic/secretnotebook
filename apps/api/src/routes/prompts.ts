import { PromptListResponseSchema, type Prompt } from '@secretnotebook/shared-types';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { PromptsStore, StoredPrompt } from '../storage/types.js';

export interface PromptsRouteOptions {
  store: PromptsStore;
  now?: () => Date;
}

function toWire(r: StoredPrompt): Prompt {
  return {
    key: r.key,
    text: r.text,
    categories: r.categories,
    sourceName: r.sourceName,
    sourceUrl: r.sourceUrl,
    sponsored: r.sponsored,
  };
}

export const promptsRoute: FastifyPluginAsyncZod<PromptsRouteOptions> = async (fastify, opts) => {
  const now = opts.now ?? (() => new Date());

  /**
   * Public prompt library. Mobile clients fetch this on boot + cache
   * locally; the response carries every active (non-retired) prompt so
   * a single GET keeps the cache complete. Unauthenticated — the prompt
   * library isn't sensitive and the rate limiter caps abuse.
   */
  fastify.get(
    '/v1/prompts',
    {
      schema: {
        response: { 200: PromptListResponseSchema },
      },
    },
    async () => {
      const rows = await opts.store.listActive();
      return {
        items: rows.map(toWire),
        fetchedAt: now().toISOString(),
      };
    },
  );
};
