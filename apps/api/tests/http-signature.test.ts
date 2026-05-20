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
  rawBody?: Buffer;
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
  let rawBody: Buffer | undefined;
  if (body === undefined) {
    rawBody = undefined;
  } else if (typeof body === 'string') {
    rawBody = Buffer.from(body, 'utf8');
  } else {
    rawBody = Buffer.from(JSON.stringify(body), 'utf8');
  }

  const bodyHash =
    rawBody && rawBody.length > 0
      ? sha256Hex(new Uint8Array(rawBody.buffer, rawBody.byteOffset, rawBody.byteLength))
      : sha256Hex(null);

  const canonical = canonicalRequestString(method, url, bodyHash, String(timestampSec));
  const sig = await ed25519Sign(new TextEncoder().encode(canonical), privateKey);

  return {
    method,
    url,
    rawBody,
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

  it('rejects a request whose body bytes were tampered after signing', async () => {
    const kp = await generateEd25519KeyPair();
    const req = await signedRequest({
      method: 'POST',
      timestampSec: Math.floor(FIXED_NOW_MS / 1000),
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
      body: { hello: 'world' },
    });
    req.rawBody = Buffer.from(JSON.stringify({ hello: 'tampered' }), 'utf8');
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

  it('hashes the raw body bytes — different JSON whitespace still verifies if it matches the signed bytes', async () => {
    // The whole point of moving to raw-body hashing: the client controls the
    // bytes, so a non-canonical serialization (with spaces, key order, etc.)
    // verifies as long as the bytes the client signed match the bytes on the
    // wire.
    const kp = await generateEd25519KeyPair();
    const exactBytes = Buffer.from('{ "b" : 1, "a" : 2 }', 'utf8');
    const ts = Math.floor(FIXED_NOW_MS / 1000);
    const bodyHash = sha256Hex(
      new Uint8Array(exactBytes.buffer, exactBytes.byteOffset, exactBytes.byteLength),
    );
    const canonical = canonicalRequestString('POST', '/v1/test', bodyHash, String(ts));
    const sig = await ed25519Sign(new TextEncoder().encode(canonical), kp.privateKey);

    const req: FakeReq = {
      method: 'POST',
      url: '/v1/test',
      rawBody: exactBytes,
      headers: {
        [HEADER_PUBKEY]: bytesToHex(kp.publicKey),
        [HEADER_SIGNATURE]: bytesToHex(sig),
        [HEADER_TIMESTAMP]: String(ts),
      },
    };
    const result = await verifyRequestSignature(req as never, opts);
    expect(result.ok).toBe(true);
  });
});
