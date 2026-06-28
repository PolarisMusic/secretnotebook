import { createHash, randomUUID } from 'node:crypto';
import { bytesToHex } from '@secretnotebook/crypto';
import {
  PostFlagInputSchema,
  PostFlagResponseSchema,
  PostInputSchema,
  PostListQuerySchema,
  PostListResponseSchema,
  PostSchema,
  type Post,
} from '@secretnotebook/shared-types';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { PostsStore, StoredPost } from '../storage/types.js';

// Threshold (distinct reporting devices) at which a post's content is
// withheld from the feed. 1 ⇒ a single flag obscures it.
const FLAG_HIDE_THRESHOLD = 1;

function toApiPost(row: StoredPost, flags: string[]): Post {
  const flagged = flags.length >= FLAG_HIDE_THRESHOLD;
  // Only the strict `reveals_personal_details` flag causes the server to
  // withhold the body entirely — the client cannot override this. All other
  // flags (spam, inappropriate, …) still ship the body so the client can
  // offer a "show anyway" reveal; those flags only trigger a client-side
  // collapse by default.
  const strictFlag = flags.includes('reveals_personal_details');
  return {
    id: row.id,
    contentType: row.contentType as Post['contentType'],
    body: flagged && strictFlag ? '' : row.body,
    audience: row.audience as Post['audience'],
    anonAuthor: bytesToHex(row.anonAuthor),
    createdAt: row.createdAt.toISOString(),
    flags: flags as Post['flags'],
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
      const flagMap = await opts.store.flagsForPosts(result.items.map((r) => r.id));
      return {
        items: result.items.map((r) => toApiPost(r, flagMap.get(r.id) ?? [])),
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
      const flags = await opts.store.flagsForPost(row.id);
      return toApiPost(row, flags);
    },
  );

  fastify.post(
    '/v1/posts/:id/flag',
    {
      preHandler: fastify.requireSignature,
      schema: {
        params: PostIdParamsSchema,
        body: PostFlagInputSchema,
        response: { 200: PostFlagResponseSchema },
      },
    },
    async (req) => {
      const pubkey = req.devicePubkey;
      if (!pubkey) {
        throw fastify.httpErrors.unauthorized('signature pubkey missing');
      }
      // Reject a flag against a post that doesn't exist.
      const post = await opts.store.findById(req.params.id);
      if (!post) throw fastify.httpErrors.notFound('post not found');
      const row = await opts.store.createFlag({
        id: randomUUID(),
        postId: req.params.id,
        category: req.body.category,
        ...(req.body.detail !== undefined ? { detail: req.body.detail } : {}),
        flaggedBy: pubkey,
        createdAt: now(),
      });
      return { id: row.id, createdAt: row.createdAt.toISOString() };
    },
  );
};
