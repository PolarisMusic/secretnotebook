import { describe, expect, it } from '@jest/globals';
import { bytesToHex, concatBytes, getSodium, hexToBytes } from '../src/sodium.js';

describe('hex helpers', () => {
  it('round-trips bytes ↔ hex', () => {
    const bytes = new Uint8Array([0x00, 0x01, 0x7f, 0x80, 0xff]);
    expect(bytesToHex(bytes)).toBe('00017f80ff');
    expect(hexToBytes('00017f80ff')).toEqual(bytes);
  });

  it('rejects odd-length hex', () => {
    expect(() => hexToBytes('abc')).toThrow();
  });

  it('rejects non-hex characters', () => {
    expect(() => hexToBytes('zz')).toThrow();
  });

  it('concatBytes joins chunks', () => {
    expect(concatBytes(new Uint8Array([1]), new Uint8Array([2, 3]), new Uint8Array([4]))).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );
  });

  it('concatBytes handles empty input', () => {
    expect(concatBytes()).toEqual(new Uint8Array(0));
  });
});

describe('sodium initialization', () => {
  it('returns a ready libsodium module', async () => {
    const sodium = await getSodium();
    expect(typeof sodium.crypto_pwhash_ALG_ARGON2ID13).toBe('number');
  });

  it('memoizes the ready promise', async () => {
    const a = await getSodium();
    const b = await getSodium();
    expect(a).toBe(b);
  });
});
