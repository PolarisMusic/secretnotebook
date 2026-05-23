import { describe, expect, it } from '@jest/globals';
import {
  findPromptByKey,
  PROMPT_LIBRARY,
  PROMPT_LIBRARY_KEYS,
  PROMPT_LIBRARY_VERSION,
  PromptSchema,
} from '../src/index.js';

describe('seed library shape', () => {
  it('is on version 1', () => {
    expect(PROMPT_LIBRARY_VERSION).toBe(1);
  });

  it('has at least 25 prompts (Phase-1 plan calls for "~30")', () => {
    expect(PROMPT_LIBRARY.length).toBeGreaterThanOrEqual(25);
  });

  it('every prompt parses through the schema', () => {
    for (const p of PROMPT_LIBRARY) {
      expect(() => PromptSchema.parse(p)).not.toThrow();
    }
  });

  it('every key is unique (collisions would break the library_key index)', () => {
    expect(new Set(PROMPT_LIBRARY_KEYS).size).toBe(PROMPT_LIBRARY_KEYS.length);
  });

  it('PROMPT_LIBRARY_KEYS is the same list as PROMPT_LIBRARY in order', () => {
    expect(PROMPT_LIBRARY_KEYS).toEqual(PROMPT_LIBRARY.map((p) => p.key));
  });
});

describe('findPromptByKey', () => {
  it('returns the prompt when the key exists', () => {
    const first = PROMPT_LIBRARY[0]!;
    expect(findPromptByKey(first.key)).toEqual(first);
  });

  it('returns null when no prompt has that key', () => {
    expect(findPromptByKey('no-such-prompt-xyz')).toBeNull();
  });
});
