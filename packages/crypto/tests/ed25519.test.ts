import { describe, expect, it } from '@jest/globals';
import { bytesToHex, hexToBytes } from '../src/sodium.js';
import {
  ed25519KeyPairFromSeed,
  ed25519Sign,
  ed25519Verify,
  generateEd25519KeyPair,
} from '../src/ed25519.js';

describe('ed25519', () => {
  it('derives RFC 8032 §7.1 Test 1 public key from seed', async () => {
    const seed = hexToBytes('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60');
    const kp = await ed25519KeyPairFromSeed(seed);
    expect(bytesToHex(kp.publicKey)).toBe(
      'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
    );
  });

  it('produces RFC 8032 §7.1 Test 1 signature over empty message', async () => {
    const seed = hexToBytes('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60');
    const kp = await ed25519KeyPairFromSeed(seed);
    const sig = await ed25519Sign(new Uint8Array(0), kp.privateKey);
    expect(bytesToHex(sig)).toBe(
      'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b',
    );
  });

  it('produces RFC 8032 §7.1 Test 2 signature over single-byte message', async () => {
    const seed = hexToBytes('4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb');
    const kp = await ed25519KeyPairFromSeed(seed);
    expect(bytesToHex(kp.publicKey)).toBe(
      '3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c',
    );
    const sig = await ed25519Sign(hexToBytes('72'), kp.privateKey);
    expect(bytesToHex(sig)).toBe(
      '92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00',
    );
  });

  it('verifies a valid signature and rejects a tampered one', async () => {
    const kp = await generateEd25519KeyPair();
    const msg = new TextEncoder().encode('the quick brown fox');
    const sig = await ed25519Sign(msg, kp.privateKey);
    expect(await ed25519Verify(sig, msg, kp.publicKey)).toBe(true);

    const tampered = new Uint8Array(sig);
    tampered[0] ^= 0xff;
    expect(await ed25519Verify(tampered, msg, kp.publicKey)).toBe(false);

    const wrongMsg = new TextEncoder().encode('the slow brown fox');
    expect(await ed25519Verify(sig, wrongMsg, kp.publicKey)).toBe(false);
  });

  it('rejects bad seed length', async () => {
    await expect(ed25519KeyPairFromSeed(new Uint8Array(8))).rejects.toThrow(/seed/);
  });

  it('returns false on malformed signature bytes', async () => {
    const kp = await generateEd25519KeyPair();
    const msg = new TextEncoder().encode('m');
    expect(await ed25519Verify(new Uint8Array(8), msg, kp.publicKey)).toBe(false);
  });
});
