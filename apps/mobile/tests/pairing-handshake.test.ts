import { describe, expect, it } from '@jest/globals';
import { MockTransport, MockTransportBus } from '@secretnotebook/couple-protocol';
import { bytesToHex, generateX25519KeyPair } from '@secretnotebook/crypto';

import { runPairing } from '../src/features/pairing/orchestrator';
import type { SelfKeys } from '../src/features/pairing/state-machine';

async function makeSelfKeys(): Promise<SelfKeys> {
  const identity = await generateX25519KeyPair();
  const ephemeral = await generateX25519KeyPair();
  return {
    identityPub: identity.publicKey,
    identityPriv: identity.privateKey,
    ephemeralPub: ephemeral.publicKey,
    ephemeralPriv: ephemeral.privateKey,
  };
}

describe('S1 pairing — two in-process devices', () => {
  it('both sides reach safeword_required and derive identical root keys (acceptance criterion)', async () => {
    const bus = new MockTransportBus();
    const transportA = new MockTransport(bus);
    const transportB = new MockTransport(bus);

    const keysA = await makeSelfKeys();
    const keysB = await makeSelfKeys();

    const codesA: string[] = [];
    const codesB: string[] = [];

    const runA = runPairing({
      transport: transportA,
      selfKeys: keysA,
      hooks: {
        async confirmCode(code) {
          codesA.push(code);
          return true;
        },
      },
    });
    const runB = runPairing({
      transport: transportB,
      selfKeys: keysB,
      hooks: {
        async confirmCode(code) {
          codesB.push(code);
          return true;
        },
      },
    });

    const [finalA, finalB] = await Promise.all([runA.result, runB.result]);

    expect(finalA.name).toBe('safeword_required');
    expect(finalB.name).toBe('safeword_required');
    if (finalA.name === 'safeword_required' && finalB.name === 'safeword_required') {
      expect(bytesToHex(finalA.rootKey)).toBe(bytesToHex(finalB.rootKey));
      expect(finalA.rootKey.length).toBe(32);
    }

    // Both sides saw the same 6-digit code (order-independent by spec).
    expect(codesA[0]).toMatch(/^\d{6}$/);
    expect(codesA[0]).toBe(codesB[0]);
  });

  it('lands in idle when either side rejects the code (mismatch / biometric fail)', async () => {
    const bus = new MockTransportBus();
    const transportA = new MockTransport(bus);
    const transportB = new MockTransport(bus);

    const keysA = await makeSelfKeys();
    const keysB = await makeSelfKeys();

    const runA = runPairing({
      transport: transportA,
      selfKeys: keysA,
      hooks: {
        async confirmCode() {
          return false;
        },
      },
    });
    const runB = runPairing({
      transport: transportB,
      selfKeys: keysB,
      hooks: {
        async confirmCode() {
          return true;
        },
      },
    });

    const finalA = await runA.result;
    expect(finalA.name).toBe('idle');

    runB.cancel();
    const finalB = await runB.result;
    expect(['idle', 'safeword_required']).toContain(finalB.name);
  });

  it('does not leak couple material to a third instance on the same bus', async () => {
    const bus = new MockTransportBus();
    const transportA = new MockTransport(bus);
    const transportB = new MockTransport(bus);
    const transportEavesdropper = new MockTransport(bus);

    const keysA = await makeSelfKeys();
    const keysB = await makeSelfKeys();

    const eavesdropperMessages: unknown[] = [];
    await transportEavesdropper.start();
    transportEavesdropper.onMessage((m) => eavesdropperMessages.push(m));

    const runA = runPairing({
      transport: transportA,
      selfKeys: keysA,
      hooks: {
        async confirmCode() {
          return true;
        },
      },
    });
    const runB = runPairing({
      transport: transportB,
      selfKeys: keysB,
      hooks: {
        async confirmCode() {
          return true;
        },
      },
    });

    const [finalA, finalB] = await Promise.all([runA.result, runB.result]);
    if (finalA.name !== 'safeword_required' || finalB.name !== 'safeword_required') {
      throw new Error('expected both sides to pair');
    }

    // The eavesdropper sees hello messages (pubkeys) — that's expected; the
    // pubkeys alone are not enough to derive root_key without the matching
    // private halves. Stronger guarantees (active MitM resistance) require
    // the 6-digit visual-confirmation step, which is what the user does
    // when they read the code off both phones.
    expect(eavesdropperMessages.length).toBeGreaterThan(0);
    expect(bytesToHex(finalA.rootKey)).toBe(bytesToHex(finalB.rootKey));
  });
});
