import { randomUUID } from 'node:crypto';
import {
  BlobDeleteResponseSchema,
  BlobIdParamsSchema,
  BlobUploadResponseSchema,
} from '@secretnotebook/shared-types';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { BlobStore } from '../storage/types.js';

export interface BlobRouteOptions {
  store: BlobStore;
  now?: () => Date;
  /** Blob TTL, in milliseconds. Default 30 days (matches the relay). */
  ttlMs?: number;
  /** Max ciphertext bytes accepted per upload (route-level bodyLimit). */
  maxBytes: number;
}

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const blobsRoute: FastifyPluginAsyncZod<BlobRouteOptions> = async (fastify, opts) => {
  const now = opts.now ?? (() => new Date());
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;

  // Upload opaque ciphertext. The body is raw bytes (application/octet-stream),
  // captured as req.rawBody by the parser in server.ts — the same bytes the
  // signature is computed over. The server assigns the handle, so a client
  // can't pick an id to overwrite or probe another blob.
  fastify.post(
    '/v1/blobs',
    {
      preHandler: fastify.requireSignature,
      // Raise the limit well above the global 1 MB default for this route only.
      bodyLimit: opts.maxBytes,
      schema: {
        response: { 200: BlobUploadResponseSchema },
      },
    },
    async (req) => {
      const raw = req.rawBody;
      if (!raw || raw.length === 0) {
        throw fastify.httpErrors.badRequest('empty blob body');
      }
      const createdAt = now();
      const stored = await opts.store.insert({
        id: randomUUID(),
        data: new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength),
        byteSize: raw.length,
        createdAt,
        expiresAt: new Date(createdAt.getTime() + ttlMs),
      });
      return { id: stored.id, expiresAt: stored.expiresAt.toISOString() };
    },
  );

  // Fetch the ciphertext back. No response schema: the body is raw bytes, not
  // JSON, so we stream the Buffer with an octet-stream content type.
  fastify.get(
    '/v1/blobs/:id',
    {
      preHandler: fastify.requireSignature,
      schema: {
        params: BlobIdParamsSchema,
      },
    },
    async (req, reply) => {
      const blob = await opts.store.get(req.params.id, now());
      if (!blob) {
        throw fastify.httpErrors.notFound('blob not found');
      }
      return reply
        .header('content-type', 'application/octet-stream')
        .header('content-length', String(blob.byteSize))
        .send(Buffer.from(blob.data));
    },
  );

  // Best-effort delete (e.g., when the author removes a note before the
  // partner has fetched it). TTL still backstops cleanup.
  fastify.delete(
    '/v1/blobs/:id',
    {
      preHandler: fastify.requireSignature,
      schema: {
        params: BlobIdParamsSchema,
        response: { 200: BlobDeleteResponseSchema },
      },
    },
    async (req) => {
      const removed = await opts.store.remove(req.params.id);
      if (!removed) {
        throw fastify.httpErrors.notFound('blob not found');
      }
      return { ok: true as const };
    },
  );
};
