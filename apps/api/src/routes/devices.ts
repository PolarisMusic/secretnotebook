import { bytesToHex, hexToBytes } from '@secretnotebook/crypto';
import { DeviceRegisterResponseSchema, DeviceRegisterSchema } from '@secretnotebook/shared-types';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { DevicesStore } from '../storage/types.js';

export interface DevicesRouteOptions {
  store: DevicesStore;
  now?: () => Date;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

export const devicesRoute: FastifyPluginAsyncZod<DevicesRouteOptions> = async (fastify, opts) => {
  const now = opts.now ?? (() => new Date());

  fastify.post(
    '/v1/devices/register',
    {
      preHandler: fastify.requireSignature,
      schema: {
        body: DeviceRegisterSchema,
        response: { 200: DeviceRegisterResponseSchema },
      },
    },
    async (req) => {
      const signedPubkey = req.devicePubkey;
      if (!signedPubkey) {
        throw fastify.httpErrors.unauthorized('signature pubkey missing');
      }
      const declared = hexToBytes(req.body.pubkey);
      if (!constantTimeEqual(declared, signedPubkey)) {
        throw fastify.httpErrors.unauthorized(
          `body pubkey ${req.body.pubkey} does not match signer ${bytesToHex(signedPubkey)}`,
        );
      }
      await opts.store.register(signedPubkey, now());
      return { ok: true as const };
    },
  );
};
