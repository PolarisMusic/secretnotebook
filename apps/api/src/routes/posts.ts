import { createHash, randomUUID } from 'node:crypto';
import { bytesToHex } from '@secretnotebook/crypto';
import {
  PostInputSchema,
  PostListQuerySchema,
  PostListResponseSchema,
  PostSchema,
  type Post,
} from '@secretnotebook/shared-types';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { PostsStore, StoredPost } from '../storage/types.js';

function toApiPost(row: StoredPost): Post {
  return {
    id: row.id,
    contentType: row.contentType as Post['contentType'],
    body: row.body,
    audience: row.audience as Post['audience'],
    anonAuthor: bytesToHex(row.anonAuthor),
    createdAt: row.createdAt.toISOString(),
  };
}

function sha256(bytes: Uint8Array | string): Uint8Array {
  const hash = createHash('sha256');
  hash.update(bytes);
  return new Uint8Array(hash.digest());
}

const PostCreateResponseSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime({ offset: true }),
});

const PostIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export interface PostsRouteOptions {
  store: PostsStore;
  now?: () => Date;
}

export const postsRoute: FastifyPluginAsyncZod<PostsRouteOptions> = async (fastify, opts) => {
  const now = opts.now ?? (() => new Date());

  fastify.post(
    '/v1/posts',
    {
      preHandler: fastify.requireSignature,
      schema: {
        body: PostInputSchema,
        response: { 200: PostCreateResponseSchema },
      },
    },
    async (req) => {
      const input = req.body;
      const pubkey = req.devicePubkey;
      if (!pubkey) {
        throw fastify.httpErrors.unauthorized('signature pubkey missing');
      }
      const row = await opts.store.insertOrGetByBodyHash({
        id: randomUUID(),
        contentType: input.contentType,
        body: input.body,
        bodyHash: sha256(input.body),
        anonAuthor: pubkey,
        createdAt: now(),
        audience: input.audience,
      });
      return { id: row.id, createdAt: row.createdAt.toISOString() };
    },
  );

  fastify.get(
    '/v1/posts',
    {
      preHandler: fastify.requireSignature,
      schema: {
        querystring: PostListQuerySchema,
        response: { 200: PostListResponseSchema },
      },
    },
    async (req) => {
      const { cursor, limit, audience } = req.query;
      const result = await opts.store.list({ cursor, limit, audience });
      return {
        items: result.items.map(toApiPost),
        nextCursor: result.nextCursor,
      };
    },
  );

  fastify.get(
    '/v1/posts/:id',
    {
      preHandler: fastify.requireSignature,
      schema: {
        params: PostIdParamsSchema,
        response: { 200: PostSchema },
      },
    },
    async (req) => {
      const row = await opts.store.findById(req.params.id);
      if (!row) throw fastify.httpErrors.notFound('post not found');
      return toApiPost(row);
    },
  );
};
