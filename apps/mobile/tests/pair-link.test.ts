import { describe, expect, it } from '@jest/globals';

import { buildPairLink, parsePairLink } from '../src/features/pairing/pair-link';

describe('pair deep links', () => {
  it('round-trips a code through build → parse', () => {
    const link = buildPairLink('K7QH92RT');
    expect(link).toBe('secretnotebook://pair?code=k7qh92rt');
    expect(parsePairLink(link)).toBe('k7qh92rt');
  });

  it('normalises a dashed / upper-case code before linking', () => {
    expect(buildPairLink('K7QH-92RT')).toBe('secretnotebook://pair?code=k7qh92rt');
  });

  it('parses tolerantly: casing, extra params', () => {
    expect(parsePairLink('SECRETNOTEBOOK://pair?code=K7QH92RT')).toBe('k7qh92rt');
    expect(parsePairLink('secretnotebook://pair?ref=x&code=k7qh92rt&y=1')).toBe('k7qh92rt');
  });

  it('rejects foreign or malformed links', () => {
    expect(parsePairLink('https://example.com/pair?code=k7qh92rt')).toBeNull();
    expect(parsePairLink('secretnotebook://pair')).toBeNull();
    expect(parsePairLink('secretnotebook://note?code=k7qh92rt')).toBeNull();
    expect(parsePairLink('secretnotebook://pair?code=short')).toBeNull();
    expect(parsePairLink('')).toBeNull();
  });
});
