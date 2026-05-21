import { describe, expect, it } from '@jest/globals';
import {
  findGratitudePromptByKey,
  GRATITUDE_LIBRARY,
  GRATITUDE_LIBRARY_KEYS,
  PromptSchema,
} from '../src/index.js';

describe('gratitude library shape', () => {
  it('has at least 8 prompts (Phase-1 closer surface needs variety)', () => {
    expect(GRATITUDE_LIBRARY.length).toBeGreaterThanOrEqual(8);
  });

  it('every prompt parses through the schema', () => {
    for (const p of GRATITUDE_LIBRARY) {
      expect(() => PromptSchema.parse(p)).not.toThrow();
    }
  });

  it('every key is unique', () => {
    expect(new Set(GRATITUDE_LIBRARY_KEYS).size).toBe(GRATITUDE_LIBRARY_KEYS.length);
  });

  it("every prompt is tagged 'gratitude'", () => {
    for (const p of GRATITUDE_LIBRARY) {
      expect(p.tags).toContain('gratitude');
    }
  });

  it("keys don't collide with the main PROMPT_LIBRARY", async () => {
    const { PROMPT_LIBRARY_KEYS } = await import('../src/index.js');
    for (const k of GRATITUDE_LIBRARY_KEYS) {
      expect(PROMPT_LIBRARY_KEYS).not.toContain(k);
    }
  });

  it('findGratitudePromptByKey returns the prompt or null', () => {
    const first = GRATITUDE_LIBRARY[0]!;
    expect(findGratitudePromptByKey(first.key)).toEqual(first);
    expect(findGratitudePromptByKey('no-such-key')).toBeNull();
  });
});
