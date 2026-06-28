import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Build a Bearer-token preHandler for the prompt admin surface.
 * Compares with a constant-time check against the configured
 * ADMIN_TOKEN; a missing or malformed Authorization header yields 401
 * (no body, no token echo). The handler is closure-bound to a specific
 * token value so the auth surface is impossible to misconfigure across
 * routes — each registration locks in the token at plugin time.
 */
export function buildAdminAuth(
  token: string,
): (req: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const expected = Buffer.from(token, 'utf8');
  return async (req, reply) => {
    const header = req.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      await reply.code(401).send({ error: 'admin token required' });
      return;
    }
    const provided = Buffer.from(header.slice('Bearer '.length), 'utf8');
    if (!constantTimeEqual(provided, expected)) {
      await reply.code(401).send({ error: 'admin token invalid' });
    }
  };
}

function constantTimeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}
