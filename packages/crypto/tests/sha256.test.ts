import { describe, expect, it } from '@jest/globals';
import { sha256, sha256Hex } from '../src/sha256.js';
import { hexToBytes } from '../src/sodium.js';

describe('sha256', () => {
  it('hashes empty input to the canonical empty-string digest', async () => {
    expect(await sha256Hex(new Uint8Array(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('matches NIST test vector for "abc"', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('matches NIST test vector for the 56-character "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"', async () => {
    expect(
      await sha256Hex(
        new TextEncoder().encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
      ),
    ).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });

  it('returns a 32-byte digest regardless of input length', async () => {
    const tiny = await sha256(new Uint8Array([1]));
    const huge = await sha256(new Uint8Array(10_000).fill(0xaa));
    expect(tiny.length).toBe(32);
    expect(huge.length).toBe(32);
  });

  it('round-trips through hex with consistent endianness', async () => {
    const bytes = await sha256(new TextEncoder().encode('abc'));
    const hex = await sha256Hex(new TextEncoder().encode('abc'));
    expect(Array.from(bytes)).toEqual(Array.from(hexToBytes(hex)));
  });
});
