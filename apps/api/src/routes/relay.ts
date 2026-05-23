import { randomUUID } from 'node:crypto';
import { bytesToHex, hexToBytes } from '@secretnotebook/crypto';
import {
  RelayDeleteParamsSchema,
  RelayDeleteResponseSchema,
  RelayInboxParamsSchema,
  RelayInboxQuerySchema,
  RelayPostResponseSchema,
  SyncEnvelopeListSchema,
  SyncEnvelopeSchema,
  type ReceivedSyncEnvelope,
} from '@secretnotebook/shared-types';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { RelayStore, StoredEnvelope } from '../storage/types.js';

export interface RelayRouteOptions {
  store: RelayStore;
  now?: () => Date;
  /** Envelope TTL, in milliseconds. Default 30 days. */
  ttlMs?: number;
}

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function toReceivedEnvelope(row: StoredEnvelope): ReceivedSyncEnvelope {
  return {
    v: 1,
    id: row.id,
    recipientBlindedId: bytesToHex(row.blindedId),
    header: Buffer.from(row.header).toString('base64'),
    ciphertext: Buffer.from(row.ciphertext).toString('base64'),
    sentAt: row.sentAt.toISOString(),
    receivedAt: row.receivedAt.toISOString(),
  };
}

export const relayRoute: FastifyPluginAsyncZod<RelayRouteOptions> = async (fastify, opts) => {
  const now = opts.now ?? (() => new Date());
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;

  fastify.post(
    '/v1/relay/inbox/:blindedId',
    {
      preHandler: fastify.requireSignature,
      schema: {
        params: RelayInboxParamsSchema,
        body: SyncEnvelopeSchema,
        response: { 200: RelayPostResponseSchema },
      },
    },
    async (req) => {
      // The path param and the body's `recipientBlindedId` must agree —
      // the server has no way to verify the address is "correct", but
      // we can refuse mismatches that would otherwise let a single POST
      // pollute two inboxes worth of state.
      if (req.body.recipientBlindedId.toLowerCase() !== req.params.blindedId.toLowerCase()) {
        throw fastify.httpErrors.badRequest('recipientBlindedId does not match URL');
      }
      const receivedAt = now();
      const stored = await opts.store.insert({
        id: randomUUID(),
        blindedId: hexToBytes(req.params.blindedId),
        header: new Uint8Array(Buffer.from(req.body.header, 'base64')),
        ciphertext: new Uint8Array(Buffer.from(req.body.ciphertext, 'base64')),
        sentAt: new Date(req.body.sentAt),
        receivedAt,
        expiresAt: new Date(receivedAt.getTime() + ttlMs),
      });
      return {
        id: stored.id,
        receivedAt: stored.receivedAt.toISOString(),
        expiresAt: stored.expiresAt.toISOString(),
      };
    },
  );

  fastify.get(
    '/v1/relay/inbox/:blindedId',
    {
      preHandler: fastify.requireSignature,
      schema: {
        params: RelayInboxParamsSchema,
        querystring: RelayInboxQuerySchema,
        response: { 200: SyncEnvelopeListSchema },
      },
    },
    async (req) => {
      const { since, limit } = req.query;
      const result = await opts.store.list({
        blindedId: hexToBytes(req.params.blindedId),
        cursor: since,
        limit,
        now: now(),
      });
      return {
        items: result.items.map(toReceivedEnvelope),
        nextCursor: result.nextCursor,
      };
    },
  );

  fastify.delete(
    '/v1/relay/inbox/:blindedId/:envelopeId',
    {
      preHandler: fastify.requireSignature,
      schema: {
        params: RelayDeleteParamsSchema,
        response: { 200: RelayDeleteResponseSchema },
      },
    },
    async (req) => {
      const removed = await opts.store.remove(
        hexToBytes(req.params.blindedId),
        req.params.envelopeId,
      );
      if (!removed) {
        throw fastify.httpErrors.notFound('envelope not found');
      }
      return { ok: true as const };
    },
  );
};
