import { describe, expect, it } from '@jest/globals';
import { bytesToHex, generateEd25519KeyPair } from '@secretnotebook/crypto';
import { ApiClient, ApiError, type FetchLike } from '../src/features/api/client';
import { HEADER_PUBKEY, HEADER_SIGNATURE, HEADER_TIMESTAMP } from '../src/features/api/signing';

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Uint8Array;
}

function makeFetch(responder: (req: CapturedRequest) => { status: number; bodyText: string }): {
  fetch: FetchLike;
  calls: CapturedRequest[];
} {
  const calls: CapturedRequest[] = [];
  const fetch: FetchLike = async (input, init) => {
    const captured: CapturedRequest = {
      url: input,
      method: init.method,
      headers: init.headers,
      body: init.body,
    };
    calls.push(captured);
    const { status, bodyText } = responder(captured);
    return {
      status,
      text: async () => bodyText,
    };
  };
  return { fetch, calls };
}

describe('ApiClient.submitPost', () => {
  it('signs the request and sends the body as JSON bytes that match the signed hash', async () => {
    const kp = await generateEd25519KeyPair();
    const { fetch, calls } = makeFetch(() => ({
      status: 200,
      bodyText: JSON.stringify({
        id: '11111111-1111-1111-1111-111111111111',
        createdAt: '2026-05-20T00:00:00.000Z',
      }),
    }));
    const client = new ApiClient({
      baseUrl: 'http://example.test',
      keyPair: kp,
      fetch,
      nowMs: () => 1_700_000_000_000,
    });

    const out = await client.submitPost({ contentType: 'text', body: 'hello' });
    expect(out.id).toBe('11111111-1111-1111-1111-111111111111');

    expect(calls).toHaveLength(1);
    const req = calls[0]!;
    expect(req.url).toBe('http://example.test/v1/posts');
    expect(req.method).toBe('POST');
    expect(req.headers[HEADER_PUBKEY]).toBe(bytesToHex(kp.publicKey));
    expect(req.headers[HEADER_TIMESTAMP]).toBe('1700000000');
    expect(req.headers[HEADER_SIGNATURE]).toMatch(/^[0-9a-f]{128}$/);
    expect(req.headers['content-type']).toBe('application/json');
    expect(req.body).toBeDefined();
    const sentJson = new TextDecoder().decode(req.body!);
    expect(JSON.parse(sentJson)).toEqual({ contentType: 'text', body: 'hello' });
  });

  it('throws ApiError on a non-success status with the response body attached', async () => {
    const kp = await generateEd25519KeyPair();
    const { fetch } = makeFetch(() => ({
      status: 429,
      bodyText: JSON.stringify({ error: 'rate-limited' }),
    }));
    const client = new ApiClient({
      baseUrl: 'http://example.test',
      keyPair: kp,
      fetch,
      nowMs: () => 1_700_000_000_000,
    });

    await expect(client.submitPost({ contentType: 'text', body: 'x' })).rejects.toBeInstanceOf(
      ApiError,
    );
    try {
      await client.submitPost({ contentType: 'text', body: 'x' });
    } catch (err) {
      expect((err as ApiError).status).toBe(429);
      expect((err as ApiError).bodyText).toContain('rate-limited');
    }
  });
});

describe('ApiClient.listPosts', () => {
  it('encodes cursor + limit into the querystring and sends the path used as the signed URL', async () => {
    const kp = await generateEd25519KeyPair();
    const { fetch, calls } = makeFetch((req) => {
      expect(req.body).toBeUndefined();
      return {
        status: 200,
        bodyText: JSON.stringify({ items: [], nextCursor: null }),
      };
    });
    const client = new ApiClient({
      baseUrl: 'http://example.test/',
      keyPair: kp,
      fetch,
      nowMs: () => 1_700_000_000_000,
    });
    await client.listPosts({ cursor: 'abc', limit: 10 });
    expect(calls[0]!.url).toBe('http://example.test/v1/posts?cursor=abc&limit=10');
  });

  it('omits the querystring entirely when no opts are supplied', async () => {
    const kp = await generateEd25519KeyPair();
    const { fetch, calls } = makeFetch(() => ({
      status: 200,
      bodyText: JSON.stringify({ items: [], nextCursor: null }),
    }));
    const client = new ApiClient({
      baseUrl: 'http://example.test',
      keyPair: kp,
      fetch,
      nowMs: () => 1_700_000_000_000,
    });
    await client.listPosts();
    expect(calls[0]!.url).toBe('http://example.test/v1/posts');
  });
});

describe('ApiClient.getPost + registerDevice', () => {
  it('uses the id in the path for getPost', async () => {
    const kp = await generateEd25519KeyPair();
    const { fetch, calls } = makeFetch(() => ({
      status: 200,
      bodyText: JSON.stringify({
        id: '11111111-1111-1111-1111-111111111111',
        contentType: 'text',
        body: 'hi',
        anonAuthor: '00'.repeat(32),
        createdAt: '2026-05-20T00:00:00.000Z',
      }),
    }));
    const client = new ApiClient({
      baseUrl: 'http://example.test',
      keyPair: kp,
      fetch,
      nowMs: () => 1_700_000_000_000,
    });
    const out = await client.getPost('11111111-1111-1111-1111-111111111111');
    expect(out.id).toBe('11111111-1111-1111-1111-111111111111');
    expect(calls[0]!.url).toBe('http://example.test/v1/posts/11111111-1111-1111-1111-111111111111');
  });

  it('sends the device pubkey as a hex string in the registerDevice body', async () => {
    const kp = await generateEd25519KeyPair();
    const { fetch, calls } = makeFetch(() => ({
      status: 200,
      bodyText: JSON.stringify({ ok: true }),
    }));
    const client = new ApiClient({
      baseUrl: 'http://example.test',
      keyPair: kp,
      fetch,
      nowMs: () => 1_700_000_000_000,
    });
    await client.registerDevice();
    const sentBody = JSON.parse(new TextDecoder().decode(calls[0]!.body!));
    expect(sentBody).toEqual({ pubkey: bytesToHex(kp.publicKey) });
  });
});
