import { describe, expect, it } from '@jest/globals';
import {
  ATTACHMENT_CHUNK_SIZE,
  chunkedDecrypt,
  chunkedEncrypt,
  generateContentKey,
  generateNoncePrefix,
} from '../src/chunked-aead.js';
import { sha256 } from '../src/sha256.js';
import { concatBytes, getSodium } from '../src/sodium.js';

/** Split a self-framing ciphertext back into its `u32be(len) || sealed` frames. */
function splitFrames(ct: Uint8Array): Uint8Array[] {
  const frames: Uint8Array[] = [];
  let off = 0;
  while (off < ct.length) {
    const len = new DataView(ct.buffer, ct.byteOffset + off, 4).getUint32(0);
    frames.push(ct.subarray(off, off + 4 + len));
    off += 4 + len;
  }
  return frames;
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (i * 31 + 7) & 0xff;
  return out;
}

describe('chunked aead', () => {
  it('exposes a sane default chunk size', () => {
    expect(ATTACHMENT_CHUNK_SIZE).toBe(64 * 1024);
  });

  it.each([
    ['empty', 0],
    ['sub-chunk', 10],
    ['exact one chunk', 16],
    ['exact multiple', 64],
    ['multiple + remainder', 70],
    ['large', 5000],
  ])('round-trips %s payloads across many chunks', async (_label, size) => {
    const key = await generateContentKey();
    const pt = randomBytes(size);
    const enc = await chunkedEncrypt(pt, key, { chunkSize: 16 });
    expect(enc.byteSize).toBe(size);
    expect(enc.noncePrefix.length).toBe(16);
    expect(enc.contentHash).toEqual(await sha256(pt));

    const dec = await chunkedDecrypt(enc.ciphertext, key, {
      noncePrefix: enc.noncePrefix,
      contentHash: enc.contentHash,
      byteSize: enc.byteSize,
    });
    expect(dec).toEqual(pt);
  });

  it('is deterministic given a fixed nonce prefix', async () => {
    const key = await generateContentKey();
    const noncePrefix = randomBytes(16);
    const pt = randomBytes(200);
    const a = await chunkedEncrypt(pt, key, { chunkSize: 32, noncePrefix });
    const b = await chunkedEncrypt(pt, key, { chunkSize: 32, noncePrefix });
    expect(a.ciphertext).toEqual(b.ciphertext);
  });

  it('rejects a wrong content key', async () => {
    const key = await generateContentKey();
    const wrong = await generateContentKey();
    const enc = await chunkedEncrypt(randomBytes(100), key, { chunkSize: 16 });
    await expect(
      chunkedDecrypt(enc.ciphertext, wrong, { noncePrefix: enc.noncePrefix }),
    ).rejects.toThrow();
  });

  it('rejects a wrong nonce prefix', async () => {
    const key = await generateContentKey();
    const enc = await chunkedEncrypt(randomBytes(100), key, { chunkSize: 16 });
    await expect(
      chunkedDecrypt(enc.ciphertext, key, { noncePrefix: await generateNoncePrefix() }),
    ).rejects.toThrow();
  });

  it('rejects tampered ciphertext', async () => {
    const key = await generateContentKey();
    const enc = await chunkedEncrypt(randomBytes(100), key, { chunkSize: 16 });
    enc.ciphertext[10] ^= 0x01;
    await expect(
      chunkedDecrypt(enc.ciphertext, key, { noncePrefix: enc.noncePrefix }),
    ).rejects.toThrow();
  });

  it('rejects truncation (dropping the final chunk)', async () => {
    const key = await generateContentKey();
    const enc = await chunkedEncrypt(randomBytes(100), key, { chunkSize: 16 });
    const frames = splitFrames(enc.ciphertext);
    expect(frames.length).toBeGreaterThan(1);
    const truncated = concatBytes(...frames.slice(0, -1));
    await expect(
      chunkedDecrypt(truncated, key, { noncePrefix: enc.noncePrefix }),
    ).rejects.toThrow();
  });

  it('rejects reordered chunks', async () => {
    const key = await generateContentKey();
    const enc = await chunkedEncrypt(randomBytes(100), key, { chunkSize: 16 });
    const frames = splitFrames(enc.ciphertext);
    [frames[0], frames[1]] = [frames[1] as Uint8Array, frames[0] as Uint8Array];
    await expect(
      chunkedDecrypt(concatBytes(...frames), key, { noncePrefix: enc.noncePrefix }),
    ).rejects.toThrow();
  });

  it('rejects duplicated chunks (shifted indices)', async () => {
    const key = await generateContentKey();
    const enc = await chunkedEncrypt(randomBytes(100), key, { chunkSize: 16 });
    const frames = splitFrames(enc.ciphertext);
    const dup = concatBytes(frames[0] as Uint8Array, ...frames);
    await expect(chunkedDecrypt(dup, key, { noncePrefix: enc.noncePrefix })).rejects.toThrow();
  });

  it('rejects a content-hash mismatch', async () => {
    const key = await generateContentKey();
    const enc = await chunkedEncrypt(randomBytes(100), key, { chunkSize: 16 });
    await expect(
      chunkedDecrypt(enc.ciphertext, key, {
        noncePrefix: enc.noncePrefix,
        contentHash: new Uint8Array(32),
      }),
    ).rejects.toThrow(/hash/);
  });

  it('rejects a byte-size mismatch', async () => {
    const key = await generateContentKey();
    const enc = await chunkedEncrypt(randomBytes(100), key, { chunkSize: 16 });
    await expect(
      chunkedDecrypt(enc.ciphertext, key, { noncePrefix: enc.noncePrefix, byteSize: 99 }),
    ).rejects.toThrow(/length/);
  });

  it('rejects a malformed frame header', async () => {
    const key = await generateContentKey();
    const enc = await chunkedEncrypt(randomBytes(40), key, { chunkSize: 16 });
    // Overwrite the first frame's length with something enormous.
    new DataView(enc.ciphertext.buffer, enc.ciphertext.byteOffset, 4).setUint32(0, 0xffffff);
    await expect(
      chunkedDecrypt(enc.ciphertext, key, { noncePrefix: enc.noncePrefix }),
    ).rejects.toThrow(/range/);
  });

  it('uses real randomness for keys and prefixes by default', async () => {
    await getSodium();
    const k1 = await generateContentKey();
    const k2 = await generateContentKey();
    expect(k1.length).toBe(32);
    expect(k1).not.toEqual(k2);
    const p1 = await generateNoncePrefix();
    expect(p1.length).toBe(16);
  });

  it('rejects a non-positive chunk size', async () => {
    const key = await generateContentKey();
    await expect(chunkedEncrypt(randomBytes(10), key, { chunkSize: 0 })).rejects.toThrow(
      /chunkSize/,
    );
  });

  it('rejects a bad nonce-prefix length on encrypt', async () => {
    const key = await generateContentKey();
    await expect(
      chunkedEncrypt(randomBytes(10), key, { noncePrefix: new Uint8Array(8) }),
    ).rejects.toThrow(/noncePrefix/);
  });

  it('rejects a bad nonce-prefix length on decrypt', async () => {
    const key = await generateContentKey();
    const enc = await chunkedEncrypt(randomBytes(10), key, { chunkSize: 16 });
    await expect(
      chunkedDecrypt(enc.ciphertext, key, { noncePrefix: new Uint8Array(8) }),
    ).rejects.toThrow(/noncePrefix/);
  });

  it('rejects ciphertext truncated mid-header', async () => {
    const key = await generateContentKey();
    const enc = await chunkedEncrypt(randomBytes(40), key, { chunkSize: 16 });
    const frames = splitFrames(enc.ciphertext);
    expect(frames.length).toBeGreaterThan(1);
    // One valid (non-final) frame followed by a stray partial header.
    const malformed = concatBytes(frames[0] as Uint8Array, new Uint8Array([1, 2]));
    await expect(chunkedDecrypt(malformed, key, { noncePrefix: enc.noncePrefix })).rejects.toThrow(
      /header/,
    );
  });

  it('rejects a frame length below the tag size', async () => {
    const key = await generateContentKey();
    const header = new Uint8Array(4);
    new DataView(header.buffer).setUint32(0, 3);
    const malformed = concatBytes(header, new Uint8Array(3));
    await expect(
      chunkedDecrypt(malformed, key, { noncePrefix: await generateNoncePrefix() }),
    ).rejects.toThrow(/range/);
  });
});
