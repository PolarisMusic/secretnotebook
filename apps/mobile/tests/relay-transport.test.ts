import { describe, expect, it } from '@jest/globals';
import type { PairingMessage } from '@secretnotebook/connection-protocol';

import { RelayTransport } from '../src/features/pairing/relay-transport';

const SELF: PairingMessage = {
  kind: 'hello',
  identityPub: new Uint8Array(32).fill(1),
  ephemeralPub: new Uint8Array(32).fill(2),
};
const PEER: PairingMessage = {
  kind: 'hello',
  identityPub: new Uint8Array(32).fill(3),
  ephemeralPub: new Uint8Array(32).fill(4),
};

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('RelayTransport.send status handling', () => {
  it('resolves on 200', async () => {
    const t = new RelayTransport({
      code: 'abc123',
      baseUrl: 'https://api.test',
      fetchImpl: (async () => jsonResponse(200, { ok: true, count: 1 })) as typeof fetch,
    });
    await expect(t.send(SELF)).resolves.toBeUndefined();
  });

  it('tolerates 409 (code already holds two hellos) without throwing', async () => {
    const t = new RelayTransport({
      code: 'abc123',
      baseUrl: 'https://api.test',
      fetchImpl: (async () => jsonResponse(409, { error: 'full' })) as typeof fetch,
    });
    await expect(t.send(SELF)).resolves.toBeUndefined();
  });

  it('throws on a real server error (500)', async () => {
    const t = new RelayTransport({
      code: 'abc123',
      baseUrl: 'https://api.test',
      fetchImpl: (async () => jsonResponse(500, {})) as typeof fetch,
    });
    await expect(t.send(SELF)).rejects.toThrow(/POST failed: 500/);
  });
});

describe('RelayTransport peer discovery', () => {
  it('delivers the peer hello found under the code (filtering out our own)', async () => {
    const { serializePairingMessage } = await import('@secretnotebook/connection-protocol');
    const selfWire = serializePairingMessage(SELF);
    const peerWire = serializePairingMessage(PEER);

    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return jsonResponse(200, { ok: true, count: 1 });
      // GET poll: both hellos are present; the transport must pick the peer.
      return jsonResponse(200, {
        hellos: [
          { hello: selfWire, postedAt: '2026-07-03T00:00:00.000Z' },
          { hello: peerWire, postedAt: '2026-07-03T00:00:01.000Z' },
        ],
      });
    }) as unknown as typeof fetch;

    const t = new RelayTransport({
      code: 'abc123',
      baseUrl: 'https://api.test',
      pollIntervalMs: 1,
      fetchImpl,
    });
    const received: PairingMessage[] = [];
    t.onMessage((m) => received.push(m));
    await t.send(SELF);
    await t.start();
    // Give the poll loop a couple of ticks to run.
    await new Promise((r) => setTimeout(r, 20));
    await t.stop();

    expect(received).toHaveLength(1);
    expect(received[0]?.identityPub).toEqual(PEER.identityPub);
  });
});
