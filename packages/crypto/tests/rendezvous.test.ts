import { describe, expect, it } from '@jest/globals';
import {
  formatRendezvousCode,
  generateRendezvousCode,
  isValidRendezvousCode,
  normalizeRendezvousCode,
  RENDEZVOUS_ALPHABET,
  RENDEZVOUS_CODE_LENGTH,
} from '../src/rendezvous.js';

describe('rendezvous codes', () => {
  it('uses a 31-symbol alphabet free of visually ambiguous glyphs', () => {
    expect(RENDEZVOUS_ALPHABET).toHaveLength(31);
    // No 0/1 digits, no i/l/o letters.
    for (const ch of '01ilo') {
      expect(RENDEZVOUS_ALPHABET).not.toContain(ch);
    }
    // No duplicate symbols.
    expect(new Set(RENDEZVOUS_ALPHABET).size).toBe(RENDEZVOUS_ALPHABET.length);
  });

  it('generates a valid canonical code of the default length', async () => {
    const code = await generateRendezvousCode();
    expect(code).toHaveLength(RENDEZVOUS_CODE_LENGTH);
    expect(isValidRendezvousCode(code)).toBe(true);
    for (const ch of code) expect(RENDEZVOUS_ALPHABET).toContain(ch);
  });

  it('honours a custom length', async () => {
    const code = await generateRendezvousCode(12);
    expect(code).toHaveLength(12);
    expect(isValidRendezvousCode(code)).toBe(true);
  });

  it('rejects a non-positive length', async () => {
    await expect(generateRendezvousCode(0)).rejects.toThrow(/positive/);
  });

  it('is overwhelmingly unlikely to repeat a code', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      seen.add(await generateRendezvousCode());
    }
    expect(seen.size).toBe(200);
  });

  it('draws roughly uniformly across the alphabet', async () => {
    const counts = new Map<string, number>();
    // 4000 symbols over 31 buckets => ~129 expected per bucket.
    for (let i = 0; i < 500; i++) {
      for (const ch of await generateRendezvousCode()) {
        counts.set(ch, (counts.get(ch) ?? 0) + 1);
      }
    }
    expect(counts.size).toBe(RENDEZVOUS_ALPHABET.length);
    for (const c of counts.values()) {
      // Generous bounds — this is a smoke test for gross modulo bias, not a
      // statistical proof.
      expect(c).toBeGreaterThan(40);
    }
  });

  it('normalizes case, dashes, and whitespace to the canonical wire form', () => {
    expect(normalizeRendezvousCode('K7QH-92RT')).toBe('k7qh92rt');
    expect(normalizeRendezvousCode('  k7qh 92rt ')).toBe('k7qh92rt');
    expect(normalizeRendezvousCode('K7QH—92RT')).toBe('k7qh92rt');
    expect(normalizeRendezvousCode('k7qh92rt')).toBe('k7qh92rt');
  });

  it('round-trips generate -> format -> normalize back to canonical', async () => {
    const code = await generateRendezvousCode();
    const formatted = formatRendezvousCode(code);
    expect(formatted).toContain('-');
    expect(formatted).toBe(formatted.toUpperCase());
    expect(normalizeRendezvousCode(formatted)).toBe(code);
  });

  it('formats into dash-separated blocks of four', () => {
    expect(formatRendezvousCode('k7qh92rt')).toBe('K7QH-92RT');
    expect(formatRendezvousCode('abcdef')).toBe('ABCD-EF');
  });

  it('validates length bounds on the canonical form', () => {
    expect(isValidRendezvousCode('abcdef')).toBe(true); // 6, min
    expect(isValidRendezvousCode('abcde')).toBe(false); // 5, too short
    expect(isValidRendezvousCode('a'.repeat(16))).toBe(true); // 16, max
    expect(isValidRendezvousCode('a'.repeat(17))).toBe(false); // 17, too long
    expect(isValidRendezvousCode('k7qh-92rt')).toBe(false); // dash not canonical
    expect(isValidRendezvousCode('K7QH92RT')).toBe(false); // uppercase not canonical
  });
});
