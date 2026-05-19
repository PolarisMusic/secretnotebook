import { describe, expect, it } from '@jest/globals';
import { bytesToHex, hexToBytes } from '../src/sodium.js';
import { generateX25519KeyPair, x25519DH, x25519PublicKey } from '../src/x25519.js';

describe('x25519', () => {
  it('matches RFC 7748 §6.1 shared-secret vector', async () => {
    const alicePriv = hexToBytes(
      '77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a',
    );
    const bobPub = hexToBytes('de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f');
    const expected = '4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742';

    const shared = await x25519DH(alicePriv, bobPub);
    expect(bytesToHex(shared)).toBe(expected);
  });

  it('derives RFC 7748 §6.1 Alice public key from her private', async () => {
    const alicePriv = hexToBytes(
      '77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a',
    );
    const expected = '8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a';
    const pub = await x25519PublicKey(alicePriv);
    expect(bytesToHex(pub)).toBe(expected);
  });

  it('produces a symmetric shared secret when both sides DH', async () => {
    const a = await generateX25519KeyPair();
    const b = await generateX25519KeyPair();
    const ab = await x25519DH(a.privateKey, b.publicKey);
    const ba = await x25519DH(b.privateKey, a.publicKey);
    expect(bytesToHex(ab)).toBe(bytesToHex(ba));
  });

  it('rejects wrong-size private keys', async () => {
    const bad = new Uint8Array(16);
    const pub = new Uint8Array(32);
    await expect(x25519DH(bad, pub)).rejects.toThrow(/private key/);
    await expect(x25519PublicKey(bad)).rejects.toThrow(/private key/);
  });

  it('rejects wrong-size peer public keys', async () => {
    const priv = new Uint8Array(32);
    const bad = new Uint8Array(16);
    await expect(x25519DH(priv, bad)).rejects.toThrow(/public key/);
  });
});
