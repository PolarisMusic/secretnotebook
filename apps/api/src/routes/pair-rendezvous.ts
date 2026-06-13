import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

/**
 * Short-lived pairing rendezvous for the "long-distance" path.
 *
 * Two unpaired devices agree out-of-band on a 6–10 character code (the
 * one user A types and shares with user B over Signal/SMS/voice). Each
 * device POSTs its hello (a pair of base64-encoded X25519 public keys)
 * to /v1/pair/:code. Either device GETs /v1/pair/:code to retrieve every
 * hello that was posted under that code; clients filter out their own
 * bytes to find the peer.
 *
 * Properties:
 *   - State is in-memory and TTL'd to 10 minutes. A server restart
 *     mid-pairing forces a retry; that's fine for tester scale.
 *   - The route is unauthenticated. The 6+ char code is the auth — anyone
 *     who knows it can post, but they can only obtain the corresponding
 *     two hellos (which are public keys, not secrets). The X3DH handshake
 *     still runs client-side; the server cannot derive the root key.
 *   - At most 2 hellos per code, both base64-bounded, to keep memory tight
 *     and prevent the route being used as a free pastebin.
 *   - Rate-limited via the global per-IP / per-pubkey limiter the app
 *     already installs.
 *
 * The "same-room" QR path bypasses this route entirely.
 */

const CODE_RE = /^[a-z0-9-]{6,16}$/i;
const HELLO_MAX_BYTES = 256;
const MAX_HELLOES_PER_CODE = 2;
const DEFAULT_TTL_MS = 10 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 1000;

interface StoredHello {
  readonly hello: string;
  readonly postedAt: number;
}

interface Rendezvous {
  readonly hellos: StoredHello[];
  readonly createdAt: number;
}

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
  /** Override the TTL (ms). Defaults to 10 minutes. */
  readonly ttlMs?: number;
  /** Override `Date.now()` for tests. */
  readonly now?: () => number;
}

export const pairRendezvousRoute: FastifyPluginAsyncZod<PairRendezvousOptions> = async (
  fastify,
  opts,
) => {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const now = opts.now ?? Date.now;
  const store = new Map<string, Rendezvous>();

  function sweep(): void {
    const cutoff = now() - ttlMs;
    for (const [code, rv] of store) {
      if (rv.createdAt < cutoff) store.delete(code);
    }
  }

  const sweeper = setInterval(sweep, SWEEP_INTERVAL_MS);
  // Don't keep the event loop alive just for the sweep timer.
  sweeper.unref?.();
  fastify.addHook('onClose', async () => {
    clearInterval(sweeper);
  });

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
      sweep();
      const existing = store.get(code);
      const t = now();
      if (!existing) {
        store.set(code, {
          createdAt: t,
          hellos: [{ hello: req.body.hello, postedAt: t }],
        });
        return { ok: true as const, count: 1 };
      }
      if (existing.hellos.some((h) => h.hello === req.body.hello)) {
        return { ok: true as const, count: existing.hellos.length };
      }
      if (existing.hellos.length >= MAX_HELLOES_PER_CODE) {
        throw fastify.httpErrors.conflict('pair code already has two hellos');
      }
      existing.hellos.push({ hello: req.body.hello, postedAt: t });
      return { ok: true as const, count: existing.hellos.length };
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
      sweep();
      const rv = store.get(code);
      if (!rv) return { hellos: [] };
      return {
        hellos: rv.hellos.map((h) => ({
          hello: h.hello,
          postedAt: new Date(h.postedAt).toISOString(),
        })),
      };
    },
  );
};
