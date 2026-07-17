import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { PairRendezvousStore } from '../storage/types.js';

/**
 * Pairing rendezvous for the "long-distance" path.
 *
 * Two unpaired devices agree out-of-band on a 6–16 character code (the
 * one user A types and shares with user B over Signal/SMS/voice — or as a
 * secretnotebook:// deep link). Each device POSTs its hello (a pair of
 * base64-encoded X25519 public keys) to /v1/pair/:code. Either device GETs
 * /v1/pair/:code to retrieve every hello that was posted under that code;
 * clients filter out their own bytes to find the peer.
 *
 * Properties:
 *   - State is PERSISTENT (a DB-backed store) and TTL'd to 24 hours, so a
 *     code survives the machine auto-stopping between the two devices
 *     posting + polling. That's the whole point — the earlier in-memory
 *     map was wiped on every restart, and long-distance partners in
 *     different time zones rarely show up in the same 10-minute window.
 *   - The route is unauthenticated. The 6+ char code is the auth — anyone
 *     who knows it can post, but they can only obtain the corresponding
 *     two hellos (which are public keys, not secrets). The X3DH handshake
 *     still runs client-side; the server cannot derive the root key.
 *   - At most 2 hellos per code are returned/accepted, both base64-bounded,
 *     to prevent the route being used as a free pastebin.
 *   - Rate-limited via the global per-IP / per-pubkey limiter the app
 *     already installs.
 *
 * The "same-room" QR path encodes the same relay code and joins here too.
 */

const CODE_RE = /^[a-z0-9-]{6,16}$/i;
const HELLO_MAX_BYTES = 256;
const MAX_HELLOES_PER_CODE = 2;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

const PairCodeParamsSchema = z.object({
  code: z.string().regex(CODE_RE),
});

const PairPostBodySchema = z.object({
  hello: z.string().min(1).max(HELLO_MAX_BYTES),
});

const PairPostResponseSchema = z.object({
  ok: z.literal(true),
  count: z.number().int().nonnegative(),
});

const PairGetResponseSchema = z.object({
  hellos: z.array(
    z.object({
      hello: z.string(),
      postedAt: z.string().datetime({ offset: true }),
    }),
  ),
});

export interface PairRendezvousOptions {
  readonly store: PairRendezvousStore;
  /** Override the TTL (ms). Defaults to 24 hours. */
  readonly ttlMs?: number;
  /** Override the clock (tests). Returns epoch ms. */
  readonly now?: () => number;
}

export const pairRendezvousRoute: FastifyPluginAsyncZod<PairRendezvousOptions> = async (
  fastify,
  opts,
) => {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const now = opts.now ?? Date.now;
  const store = opts.store;

  fastify.post(
    '/v1/pair/:code',
    {
      schema: {
        params: PairCodeParamsSchema,
        body: PairPostBodySchema,
        response: { 200: PairPostResponseSchema },
      },
    },
    async (req) => {
      const code = req.params.code.toLowerCase();
      const at = new Date(now());
      const existing = await store.listHellos(code, at);
      if (existing.some((h) => h.hello === req.body.hello)) {
        return { ok: true as const, count: existing.length };
      }
      if (existing.length >= MAX_HELLOES_PER_CODE) {
        throw fastify.httpErrors.conflict('pair code already has two hellos');
      }
      await store.insertHello(code, req.body.hello, at, new Date(at.getTime() + ttlMs));
      return { ok: true as const, count: existing.length + 1 };
    },
  );

  fastify.get(
    '/v1/pair/:code',
    {
      schema: {
        params: PairCodeParamsSchema,
        response: { 200: PairGetResponseSchema },
      },
    },
    async (req) => {
      const code = req.params.code.toLowerCase();
      const hellos = await store.listHellos(code, new Date(now()));
      return {
        hellos: hellos.slice(0, MAX_HELLOES_PER_CODE).map((h) => ({
          hello: h.hello,
          postedAt: h.postedAt.toISOString(),
        })),
      };
    },
  );
};
