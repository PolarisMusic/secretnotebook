import { describe, expect, it } from '@jest/globals';

import {
  UNLOCK_PROMPTS,
  drawPromptKey,
  isKnownPromptKey,
  resolvePromptText,
} from '../src/features/secret-unlock/prompts';

describe('unlock prompt library', () => {
  it('has unique, non-empty keys and text', () => {
    const keys = UNLOCK_PROMPTS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const p of UNLOCK_PROMPTS) {
      expect(p.key.length).toBeGreaterThan(0);
      expect(p.text.length).toBeGreaterThan(0);
    }
  });

  it('resolves a known key to its text and unknown keys to a neutral fallback', () => {
    const first = UNLOCK_PROMPTS[0];
    expect(resolvePromptText(first.key)).toBe(first.text);
    expect(isKnownPromptKey(first.key)).toBe(true);

    expect(isKnownPromptKey('pq_does_not_exist')).toBe(false);
    expect(resolvePromptText('pq_does_not_exist')).toMatch(/thoughtful/);
  });

  it('draws deterministically from the rng and clamps the edges', () => {
    expect(drawPromptKey(() => 0)).toBe(UNLOCK_PROMPTS[0].key);
    expect(drawPromptKey(() => 0.999999)).toBe(UNLOCK_PROMPTS[UNLOCK_PROMPTS.length - 1].key);
    // rng() === 1 (or above) must not index out of bounds.
    expect(drawPromptKey(() => 1)).toBe(UNLOCK_PROMPTS[UNLOCK_PROMPTS.length - 1].key);
  });
});
