import { createHash } from 'node:crypto';
import { ed25519Verify, hexToBytes } from '@secretnotebook/crypto';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

export const HEADER_PUBKEY = 'x-device-pubkey';
export const HEADER_SIGNATURE = 'x-signature';
export const HEADER_TIMESTAMP = 'x-timestamp';

const HEX_64 = /^[0-9a-f]{64}$/i;
const HEX_128 = /^[0-9a-f]{128}$/i;

declare module 'fastify' {
  interface FastifyRequest {
    devicePubkey?: Uint8Array;
    /**
     * Raw request body bytes, captured by the `application/json` content-type
     * parser before JSON.parse runs. The signature middleware hashes these
     * bytes directly so the wire bytes the client signed are the ones we
     * verify against — no JSON re-serialization step in between.
     */
    rawBody?: Buffer;
  }
}

export interface HttpSignatureOptions {
  maxDriftSeconds: number;
  now?: () => number;
}

export function canonicalRequestString(
  method: string,
  path: string,
  bodyHashHex: string,
  timestamp: string,
): string {
  return `${method.toUpperCase()}|${path}|${bodyHashHex}|${timestamp}`;
}

export function sha256Hex(body: Uint8Array | string | undefined | null): string {
  const hash = createHash('sha256');
  if (body == null) {
    return hash.digest('hex');
  }
  if (typeof body === 'string') {
    hash.update(body, 'utf8');
  } else {
    hash.update(body);
  }
  return hash.digest('hex');
}

function getHeader(req: FastifyRequest, name: string): string | undefined {
  const v = req.headers[name];
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v[0];
  return undefined;
}

function rawBodyHashHex(req: FastifyRequest): string {
  const raw = req.rawBody;
  if (!raw || raw.length === 0) return sha256Hex(null);
  return sha256Hex(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
}

export async function verifyRequestSignature(
  req: FastifyRequest,
  opts: HttpSignatureOptions,
): Promise<{ ok: true; pubkey: Uint8Array } | { ok: false; reason: string }> {
  const pubkeyHex = getHeader(req, HEADER_PUBKEY);
  const sigHex = getHeader(req, HEADER_SIGNATURE);
  const tsHeader = getHeader(req, HEADER_TIMESTAMP);

  if (!pubkeyHex || !sigHex || !tsHeader) return { ok: false, reason: 'missing signature headers' };
  if (!HEX_64.test(pubkeyHex)) return { ok: false, reason: 'malformed device pubkey' };
  if (!HEX_128.test(sigHex)) return { ok: false, reason: 'malformed signature' };

  const ts = Number.parseInt(tsHeader, 10);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'malformed timestamp' };

  const nowSec = Math.floor((opts.now ?? Date.now)() / 1000);
  if (Math.abs(nowSec - ts) > opts.maxDriftSeconds) {
    return { ok: false, reason: 'timestamp drift exceeded' };
  }

  const bodyHash = rawBodyHashHex(req);
  const canonical = canonicalRequestString(req.method, req.url, bodyHash, tsHeader);

  const pubkey = hexToBytes(pubkeyHex);
  const sig = hexToBytes(sigHex);
  const ok = await ed25519Verify(sig, new TextEncoder().encode(canonical), pubkey);
  if (!ok) return { ok: false, reason: 'signature mismatch' };
  return { ok: true, pubkey };
}

async function rejectUnsigned(reply: FastifyReply, reason: string): Promise<void> {
  await reply.code(401).send({ error: 'unauthorized', reason });
}

export const httpSignaturePlugin: FastifyPluginAsync<HttpSignatureOptions> = async (
  fastify,
  opts,
) => {
  fastify.decorateRequest('devicePubkey', undefined);
  fastify.decorateRequest('rawBody', undefined);
  fastify.decorate(
    'requireSignature',
    async function requireSignature(req: FastifyRequest, reply: FastifyReply): Promise<void> {
      const result = await verifyRequestSignature(req, opts);
      if (!result.ok) {
        await rejectUnsigned(reply, result.reason);
        return;
      }
      req.devicePubkey = result.pubkey;
    },
  );
};

declare module 'fastify' {
  interface FastifyInstance {
    requireSignature: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export default fp(httpSignaturePlugin, { name: 'http-signature' });
