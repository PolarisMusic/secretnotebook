import { describe, expect, it } from '@jest/globals';
import { generateEd25519KeyPair, hexToBytes } from '@secretnotebook/crypto';
import {
  bodyHashHex,
  buildSignedHeaders,
  canonicalRequestString,
  HEADER_PUBKEY,
  HEADER_SIGNATURE,
  HEADER_TIMESTAMP,
} from '../src/features/api/signing';
import { deriveDeviceSigningKey } from '../src/features/api/device-key';

describe('canonicalRequestString', () => {
  it('uppercases the method and joins fields with pipe', () => {
    expect(canonicalRequestString('post', '/v1/posts', 'abc', '42')).toBe('POST|/v1/posts|abc|42');
  });
});

describe('bodyHashHex', () => {
  it('returns the sha256 of the empty string when no body is given', async () => {
    expect(await bodyHashHex(undefined)).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
  it('returns the same hash regardless of byte source', async () => {
    const fromString = await bodyHashHex(new TextEncoder().encode('hello'));
    const fromBytes = await bodyHashHex(new Uint8Array([104, 101, 108, 108, 111]));
    expect(fromString).toBe(fromBytes);
  });
});

describe('buildSignedHeaders', () => {
  it('produces a 32-byte pubkey hex and 64-byte signature hex with a stable timestamp', async () => {
    const kp = await generateEd25519KeyPair();
    const headers = await buildSignedHeaders({
      method: 'GET',
      url: '/v1/posts',
      bodyBytes: undefined,
      timestampSec: 1_700_000_000,
      publicKey: kp.publicKey,
      privateKey: kp.privateKey,
    });
    expect(headers[HEADER_TIMESTAMP]).toBe('1700000000');
    expect(headers[HEADER_PUBKEY]).toMatch(/^[0-9a-f]{64}$/);
    expect(headers[HEADER_SIGNATURE]).toMatch(/^[0-9a-f]{128}$/);
  });

  it('signs the canonical bytes deterministically given the same keypair + body + ts', async () => {
    const seed = new Uint8Array(32);
    for (let i = 0; i < 32; i++) seed[i] = i;
    const master = seed;
    const kp = await deriveDeviceSigningKey(master);
    const h1 = await buildSignedHeaders({
      method: 'POST',
      url: '/v1/posts',
      bodyBytes: new TextEncoder().encode('{"contentType":"text","body":"hi"}'),
      timestampSec: 1_700_000_000,
      publicKey: kp.publicKey,
      privateKey: kp.privateKey,
    });
    const h2 = await buildSignedHeaders({
      method: 'POST',
      url: '/v1/posts',
      bodyBytes: new TextEncoder().encode('{"contentType":"text","body":"hi"}'),
      timestampSec: 1_700_000_000,
      publicKey: kp.publicKey,
      privateKey: kp.privateKey,
    });
    expect(h1).toEqual(h2);
  });

  it('produces a different signature when the body bytes differ', async () => {
    const kp = await generateEd25519KeyPair();
    const h1 = await buildSignedHeaders({
      method: 'POST',
      url: '/v1/posts',
      bodyBytes: new TextEncoder().encode('A'),
      timestampSec: 1_700_000_000,
      publicKey: kp.publicKey,
      privateKey: kp.privateKey,
    });
    const h2 = await buildSignedHeaders({
      method: 'POST',
      url: '/v1/posts',
      bodyBytes: new TextEncoder().encode('B'),
      timestampSec: 1_700_000_000,
      publicKey: kp.publicKey,
      privateKey: kp.privateKey,
    });
    expect(h1[HEADER_SIGNATURE]).not.toBe(h2[HEADER_SIGNATURE]);
  });

  it('produces the same pubkey hex as the supplied keypair', async () => {
    const kp = await generateEd25519KeyPair();
    const headers = await buildSignedHeaders({
      method: 'GET',
      url: '/v1/health',
      bodyBytes: undefined,
      timestampSec: 1,
      publicKey: kp.publicKey,
      privateKey: kp.privateKey,
    });
    const recovered = hexToBytes(headers[HEADER_PUBKEY]);
    expect(Array.from(recovered)).toEqual(Array.from(kp.publicKey));
  });
});

describe('deriveDeviceSigningKey', () => {
  it('is deterministic — same device_master always derives the same keypair', async () => {
    const master = new Uint8Array(32).fill(7);
    const a = await deriveDeviceSigningKey(master);
    const b = await deriveDeviceSigningKey(master);
    expect(Array.from(a.publicKey)).toEqual(Array.from(b.publicKey));
    expect(Array.from(a.privateKey)).toEqual(Array.from(b.privateKey));
  });

  it('produces different keypairs for different device_master values', async () => {
    const a = await deriveDeviceSigningKey(new Uint8Array(32).fill(7));
    const b = await deriveDeviceSigningKey(new Uint8Array(32).fill(8));
    expect(Array.from(a.publicKey)).not.toEqual(Array.from(b.publicKey));
  });

  it('rejects a device_master of the wrong length', async () => {
    await expect(deriveDeviceSigningKey(new Uint8Array(16))).rejects.toThrow(/must be 32 bytes/);
  });
});
