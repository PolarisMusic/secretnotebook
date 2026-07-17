import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { startGc } from '../src/cron/gc.js';
import {
  MemoryBlobStore,
  MemoryPairRendezvousStore,
  MemoryRelayStore,
} from './helpers/memory-stores.js';

const NOW = new Date('2026-07-03T00:00:00.000Z');
const EXPIRED = new Date(NOW.getTime() - 1000);
const FRESH = new Date(NOW.getTime() + 60 * 60 * 1000);

function seed(): {
  blobs: MemoryBlobStore;
  relay: MemoryRelayStore;
  pairRendezvous: MemoryPairRendezvousStore;
} {
  const blobs = new MemoryBlobStore();
  const relay = new MemoryRelayStore();
  const pairRendezvous = new MemoryPairRendezvousStore();
  blobs.rows.push(
    { id: 'b-old', data: new Uint8Array([1]), byteSize: 1, createdAt: EXPIRED, expiresAt: EXPIRED },
    { id: 'b-new', data: new Uint8Array([2]), byteSize: 1, createdAt: NOW, expiresAt: FRESH },
  );
  relay.rows.push({
    id: 'e-old',
    blindedId: new Uint8Array([9]),
    header: new Uint8Array([0]),
    ciphertext: new Uint8Array([0]),
    sentAt: EXPIRED,
    receivedAt: EXPIRED,
    expiresAt: EXPIRED,
  });
  pairRendezvous.rows.push({ code: 'abc123', hello: 'h', postedAt: EXPIRED, expiresAt: EXPIRED });
  return { blobs, relay, pairRendezvous };
}

describe('startGc', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('purges expired blobs, relay envelopes, and pairing rows, keeping fresh ones', async () => {
    const { blobs, relay, pairRendezvous } = seed();
    const gc = startGc({ blobs, relay, pairRendezvous }, { now: () => NOW });
    await gc.runOnce();
    gc.stop();

    expect(blobs.rows.map((r) => r.id)).toEqual(['b-new']);
    expect(relay.rows).toHaveLength(0);
    expect(pairRendezvous.rows).toHaveLength(0);
  });

  it('runs an immediate sweep on startup', async () => {
    const { blobs, relay, pairRendezvous } = seed();
    const gc = startGc({ blobs, relay, pairRendezvous }, { now: () => NOW });
    // Let the boot-time `void runOnce()` microtasks settle.
    await Promise.resolve();
    await Promise.resolve();
    gc.stop();
    expect(relay.rows).toHaveLength(0);
  });

  it('swallows a store error and logs it', async () => {
    const relay = new MemoryRelayStore();
    const blobs = new MemoryBlobStore();
    const pairRendezvous = new MemoryPairRendezvousStore();
    jest.spyOn(blobs, 'purgeExpired').mockRejectedValue(new Error('db down'));
    const error = jest.fn();
    const gc = startGc(
      { blobs, relay, pairRendezvous },
      { now: () => NOW, logger: { info: jest.fn(), error } },
    );
    await gc.runOnce();
    gc.stop();
    // The rejection is logged, not thrown (the boot sweep may also log).
    expect(error).toHaveBeenCalled();
  });
});
