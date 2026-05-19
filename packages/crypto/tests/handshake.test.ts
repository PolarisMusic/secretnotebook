import { describe, expect, it } from '@jest/globals';
import { deriveRootKey, pairingCode, ROOT_KEY_BYTES } from '../src/handshake.js';
import { generateX25519KeyPair } from '../src/x25519.js';
import { bytesToHex } from '../src/sodium.js';

async function bothSidesDerive() {
  const aIK = await generateX25519KeyPair();
  const aEK = await generateX25519KeyPair();
  const bIK = await generateX25519KeyPair();
  const bEK = await generateX25519KeyPair();

  const aRoot = await deriveRootKey({
    selfIdentityPrivate: aIK.privateKey,
    selfEphemeralPrivate: aEK.privateKey,
    selfIdentityPublic: aIK.publicKey,
    peerIdentityPublic: bIK.publicKey,
    peerEphemeralPublic: bEK.publicKey,
  });
  const bRoot = await deriveRootKey({
    selfIdentityPrivate: bIK.privateKey,
    selfEphemeralPrivate: bEK.privateKey,
    selfIdentityPublic: bIK.publicKey,
    peerIdentityPublic: aIK.publicKey,
    peerEphemeralPublic: aEK.publicKey,
  });

  return { aRoot, bRoot, aIK, bIK };
}

describe('triple-DH handshake', () => {
  it('produces matching 32-byte root keys on both sides', async () => {
    const { aRoot, bRoot } = await bothSidesDerive();
    expect(aRoot.length).toBe(ROOT_KEY_BYTES);
    expect(bRoot.length).toBe(ROOT_KEY_BYTES);
    expect(bytesToHex(aRoot)).toBe(bytesToHex(bRoot));
  });

  it('produces different root keys across pairings', async () => {
    const pairing1 = await bothSidesDerive();
    const pairing2 = await bothSidesDerive();
    expect(bytesToHex(pairing1.aRoot)).not.toBe(bytesToHex(pairing2.aRoot));
  });

  it('rejects self-pairing (peer identity == self identity)', async () => {
    const ik = await generateX25519KeyPair();
    const ek = await generateX25519KeyPair();
    await expect(
      deriveRootKey({
        selfIdentityPrivate: ik.privateKey,
        selfEphemeralPrivate: ek.privateKey,
        selfIdentityPublic: ik.publicKey,
        peerIdentityPublic: ik.publicKey,
        peerEphemeralPublic: ek.publicKey,
      }),
    ).rejects.toThrow(/peer identity/);
  });
});

describe('pairing code', () => {
  it('is identical regardless of argument order', async () => {
    const a = await generateX25519KeyPair();
    const b = await generateX25519KeyPair();
    const codeAB = await pairingCode(a.publicKey, b.publicKey);
    const codeBA = await pairingCode(b.publicKey, a.publicKey);
    expect(codeAB).toBe(codeBA);
  });

  it('returns a fixed-length numeric string', async () => {
    const a = await generateX25519KeyPair();
    const b = await generateX25519KeyPair();
    const code = await pairingCode(a.publicKey, b.publicKey);
    expect(code).toMatch(/^\d{6}$/);
  });

  it('honors a custom digit count', async () => {
    const a = await generateX25519KeyPair();
    const b = await generateX25519KeyPair();
    const code = await pairingCode(a.publicKey, b.publicKey, 4);
    expect(code).toMatch(/^\d{4}$/);
  });
});
