import { describe, expect, it } from '@jest/globals';
import { bytesToHex, ed25519Sign, generateEd25519KeyPair } from '@secretnotebook/crypto';
import {
  canonicalRequestString,
  HEADER_PUBKEY,
  HEADER_SIGNATURE,
  HEADER_TIMESTAMP,
  sha256Hex,
  verifyRequestSignature,
} from '../src/auth/http-signature.js';

interface FakeReq {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
}

async function signedRequest({
  method = 'GET',
  url = '/v1/test',
  body,
  timestampSec,
  privateKey,
  publicKey,
}: {
  method?: string;
  url?: string;
  body?: unknown;
  timestampSec: number;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}): Promise<FakeReq> {
  let bodyHash: string;
  if (body === undefined) bodyHash = sha256Hex(null);
  else if (typeof body === 'string') bodyHash = sha256Hex(body);
  else bodyHash = sha256Hex(JSON.stringify(body));

  const canonical = canonicalRequestString(method, url, bodyHash, String(timestampSec));
  const sig = await ed25519Sign(new TextEncoder().encode(canonical), privateKey);

  return {
    method,
    url,
    body,
    headers: {
      [HEADER_PUBKEY]: bytesToHex(publicKey),
      [HEADER_SIGNATURE]: bytesToHex(sig),
      [HEADER_TIMESTAMP]: String(timestampSec),
    },
  };
}

const FIXED_NOW_MS = 1_700_000_000_000;
const opts = { maxDriftSeconds: 300, now: () => FIXED_NOW_MS };

describe('canonicalRequestString', () => {
  it('uppercases method and joins fields with pipe', () => {
    expect(canonicalRequestString('get', '/x', 'h', '1')).toBe('GET|/x|h|1');
  });
});

describe('sha256Hex', () => {
  it('hashes empty bodies to the canonical sha256 of zero bytes', () => {
    expect(sha256Hex(null)).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
  it('hashes strings consistently with their UTF-8 bytes', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('verifyRequestSignature', () => {
  it('accepts a correctly signed request', async () => {
    const kp = await generateEd25519KeyPair();
    const req = await signedRequest({
      timestampSec: Math.floor(FIXED_NOW_MS / 1000),
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
    });
    const result = await verifyRequestSignature(req as never, opts);
    expect(result.ok).toBe(true);
  });

  it('rejects an unsigned request (no headers)', async () => {
    const req: FakeReq = { method: 'GET', url: '/v1/test', headers: {} };
    const result = await verifyRequestSignature(req as never, opts);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/missing/);
  });

  it('rejects a request with a malformed pubkey', async () => {
    const kp = await generateEd25519KeyPair();
    const req = await signedRequest({
      timestampSec: Math.floor(FIXED_NOW_MS / 1000),
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
    });
    req.headers[HEADER_PUBKEY] = 'not-hex';
    const result = await verifyRequestSignature(req as never, opts);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/pubkey/);
  });

  it('rejects a request with a malformed signature', async () => {
    const kp = await generateEd25519KeyPair();
    const req = await signedRequest({
      timestampSec: Math.floor(FIXED_NOW_MS / 1000),
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
    });
    req.headers[HEADER_SIGNATURE] = '00';
    const result = await verifyRequestSignature(req as never, opts);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/signature/);
  });

  it('rejects a request with a malformed timestamp', async () => {
    const kp = await generateEd25519KeyPair();
    const req = await signedRequest({
      timestampSec: Math.floor(FIXED_NOW_MS / 1000),
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
    });
    req.headers[HEADER_TIMESTAMP] = 'nope';
    const result = await verifyRequestSignature(req as never, opts);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/timestamp/);
  });

  it('rejects a request whose timestamp drifts more than the allowed window', async () => {
    const kp = await generateEd25519KeyPair();
    const tooEarly = Math.floor(FIXED_NOW_MS / 1000) - 301;
    const req = await signedRequest({
      timestampSec: tooEarly,
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
    });
    const result = await verifyRequestSignature(req as never, opts);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/drift/);
  });

  it('rejects a request whose body was tampered after signing', async () => {
    const kp = await generateEd25519KeyPair();
    const req = await signedRequest({
      method: 'POST',
      timestampSec: Math.floor(FIXED_NOW_MS / 1000),
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
      body: { hello: 'world' },
    });
    req.body = { hello: 'tampered' };
    const result = await verifyRequestSignature(req as never, opts);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/signature mismatch/);
  });

  it('rejects a request whose path was changed after signing', async () => {
    const kp = await generateEd25519KeyPair();
    const req = await signedRequest({
      url: '/v1/test',
      timestampSec: Math.floor(FIXED_NOW_MS / 1000),
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
    });
    req.url = '/v1/other';
    const result = await verifyRequestSignature(req as never, opts);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/signature mismatch/);
  });

  it('rejects a request signed by a different key than declared', async () => {
    const kpA = await generateEd25519KeyPair();
    const kpB = await generateEd25519KeyPair();
    const req = await signedRequest({
      timestampSec: Math.floor(FIXED_NOW_MS / 1000),
      privateKey: kpA.privateKey,
      publicKey: kpB.publicKey,
    });
    const result = await verifyRequestSignature(req as never, opts);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/signature mismatch/);
  });
});
