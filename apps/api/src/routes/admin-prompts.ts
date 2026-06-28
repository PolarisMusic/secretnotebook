import {
  AdminPromptCreateSchema,
  AdminPromptListResponseSchema,
  AdminPromptPatchSchema,
  type AdminPromptRow,
  PromptKeySchema,
} from '@secretnotebook/shared-types';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { buildAdminAuth } from '../auth/admin-token.js';
import type { PromptsStore, StoredPrompt } from '../storage/types.js';

export interface AdminPromptsRouteOptions {
  store: PromptsStore;
  token: string;
  now?: () => Date;
}

function toAdminRow(r: StoredPrompt): AdminPromptRow {
  return {
    key: r.key,
    text: r.text,
    categories: r.categories,
    sourceName: r.sourceName,
    sourceUrl: r.sourceUrl,
    sponsored: r.sponsored,
    retiredAt: r.retiredAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/**
 * Admin CRUD for the prompt library. Bearer-token auth (ADMIN_TOKEN); the
 * whole plugin is only registered when the env var is set, so a fresh
 * deploy has no admin surface at all.
 *
 * Retire vs delete: `retiredAt` is the soft-delete mechanism. A prompt
 * that has shipped in any `secret_unlock.start` op MUST keep resolving,
 * so deletion isn't safe. Retire hides the row from `/v1/prompts` (the
 * mobile draw pool) while keeping `resolvePromptText` working for
 * historical attempts.
 */
export const adminPromptsRoute: FastifyPluginAsyncZod<AdminPromptsRouteOptions> = async (
  fastify,
  opts,
) => {
  const now = opts.now ?? (() => new Date());
  const auth = buildAdminAuth(opts.token);

  fastify.get(
    '/v1/admin/prompts',
    {
      preHandler: auth,
      schema: { response: { 200: AdminPromptListResponseSchema } },
    },
    async () => {
      const rows = await opts.store.listAll();
      return { items: rows.map(toAdminRow) };
    },
  );

  fastify.post(
    '/v1/admin/prompts',
    {
      preHandler: auth,
      schema: {
        body: AdminPromptCreateSchema,
        response: { 200: z.object({ row: z.unknown() }) },
      },
    },
    async (req) => {
      const existing = await opts.store.findByKey(req.body.key);
      if (existing) {
        throw fastify.httpErrors.conflict(`prompt ${req.body.key} already exists`);
      }
      const row = await opts.store.create(
        {
          key: req.body.key,
          text: req.body.text,
          categories: req.body.categories,
          sourceName: req.body.sourceName ?? null,
          sourceUrl: req.body.sourceUrl ?? null,
          sponsored: req.body.sponsored ?? false,
        },
        now(),
      );
      return { row: toAdminRow(row) };
    },
  );

  fastify.patch(
    '/v1/admin/prompts/:key',
    {
      preHandler: auth,
      schema: {
        params: z.object({ key: PromptKeySchema }),
        body: AdminPromptPatchSchema,
        response: { 200: z.object({ row: z.unknown() }) },
      },
    },
    async (req) => {
      const row = await opts.store.update(req.params.key, req.body, now());
      if (!row) {
        throw fastify.httpErrors.notFound(`prompt ${req.params.key} not found`);
      }
      return { row: toAdminRow(row) };
    },
  );

  fastify.post(
    '/v1/admin/prompts/:key/retire',
    {
      preHandler: auth,
      schema: {
        params: z.object({ key: PromptKeySchema }),
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (req) => {
      const ok = await opts.store.retire(req.params.key, now());
      if (!ok) {
        throw fastify.httpErrors.notFound(`prompt ${req.params.key} not found or already retired`);
      }
      return { ok: true as const };
    },
  );

  fastify.post(
    '/v1/admin/prompts/:key/unretire',
    {
      preHandler: auth,
      schema: {
        params: z.object({ key: PromptKeySchema }),
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (req) => {
      const ok = await opts.store.unretire(req.params.key, now());
      if (!ok) {
        throw fastify.httpErrors.notFound(`prompt ${req.params.key} not found or not retired`);
      }
      return { ok: true as const };
    },
  );
};
