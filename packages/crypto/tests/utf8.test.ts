import { describe, expect, it } from '@jest/globals';
import { utf8Decode, utf8Encode } from '../src/utf8.js';

// A spread of inputs that exercise 1-, 2-, 3-, and 4-byte UTF-8 sequences.
const SAMPLES = [
  '',
  'hello',
  'a note with spaces and punctuation! 123',
  'café — naïve résumé', // 2-byte sequences + em dash (3-byte)
  'Ω≈ç√∫˜µ≤≥÷', // assorted 2/3-byte
  'こんにちは世界', // 3-byte CJK
  '😀🔥👩‍❤️‍👨🇬🇧', // 4-byte astral + ZWJ + flag (surrogate pairs)
  JSON.stringify({ kind: 'note.share.add', body: 'I ❤️ you 😘', n: 42 }),
];

describe('utf8 codec', () => {
  it('round-trips a spread of unicode inputs', () => {
    for (const s of SAMPLES) {
      expect(utf8Decode(utf8Encode(s))).toBe(s);
    }
  });

  it('produces bytes identical to TextEncoder (wire compatibility)', () => {
    // Runs under Node/jsdom where TextEncoder exists; guarantees an op
    // serialised by utf8Encode is byte-for-byte what an older build (or the
    // Node API) produced via TextEncoder, so the ciphertext stays compatible.
    const enc = new TextEncoder();
    for (const s of SAMPLES) {
      expect(Array.from(utf8Encode(s))).toEqual(Array.from(enc.encode(s)));
    }
  });

  it('decodes bytes produced by TextEncoder', () => {
    const enc = new TextEncoder();
    for (const s of SAMPLES) {
      expect(utf8Decode(enc.encode(s))).toBe(s);
    }
  });

  it('handles a payload larger than the internal flush chunk', () => {
    const big = '😀x'.repeat(5000); // ~10k code units, forces multiple flushes
    expect(utf8Decode(utf8Encode(big))).toBe(big);
  });
});
