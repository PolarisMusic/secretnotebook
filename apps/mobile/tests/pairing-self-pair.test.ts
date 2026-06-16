import { describe, expect, it } from '@jest/globals';
import type { PairingMessage, PairingTransport } from '@secretnotebook/connection-protocol';
import { generateX25519KeyPair } from '@secretnotebook/crypto';

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

/**
 * Transport that echoes our own `hello` straight back — i.e. a device that
 * receives its own identity, which is exactly the self-pair case. Lets us
 * exercise the guard with a single run (no second device to starve).
 */
class SelfEchoTransport implements PairingTransport {
  private msgHandler: ((m: PairingMessage) => void) | null = null;
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  async send(msg: PairingMessage): Promise<void> {
    this.msgHandler?.(msg);
  }
  onMessage(handler: (m: PairingMessage) => void): () => void {
    this.msgHandler = handler;
    return () => {
      this.msgHandler = null;
    };
  }
  onError(): () => void {
    return () => undefined;
  }
}

describe('S1 pairing — self-pair prevention', () => {
  it('refuses to pair a device with itself (same identity) by default', async () => {
    const keys = await makeSelfKeys();
    const final = await runPairing({
      transport: new SelfEchoTransport(),
      selfKeys: keys,
      hooks: {
        async confirmCode() {
          return true;
        },
      },
    }).result;
    expect(final.name).toBe('error');
    if (final.name === 'error') expect(final.reason).toMatch(/itself/);
  });

  it('refuses self-pair when allowSelfPair is explicitly false', async () => {
    const keys = await makeSelfKeys();
    const final = await runPairing({
      transport: new SelfEchoTransport(),
      selfKeys: keys,
      allowSelfPair: false,
      hooks: {
        async confirmCode() {
          return true;
        },
      },
    }).result;
    expect(final.name).toBe('error');
  });

  it('allows self-pair when allowSelfPair is set (single-device testing)', async () => {
    const keys = await makeSelfKeys();
    const codes: string[] = [];
    const final = await runPairing({
      transport: new SelfEchoTransport(),
      selfKeys: keys,
      allowSelfPair: true,
      hooks: {
        async confirmCode(code) {
          codes.push(code);
          return false; // cancel to end the run quickly
        },
      },
    }).result;
    // Reaching code_shown (confirmCode invoked) proves the self-pair gate
    // was bypassed under the flag; a rejected code lands back in idle.
    expect(codes[0]).toMatch(/^\d{6}$/);
    expect(final.name).toBe('idle');
  });
});
