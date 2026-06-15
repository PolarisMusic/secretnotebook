import { describe, expect, it } from '@jest/globals';

import { effectiveAudience } from '../src/features/feed/audience';

describe('effectiveAudience', () => {
  it('returns the viewer role when the filter is on and the role is masculine/feminine', () => {
    expect(effectiveAudience('masculine', true)).toBe('masculine');
    expect(effectiveAudience('feminine', true)).toBe('feminine');
  });

  it('returns undefined (no filter) when the filter is off', () => {
    expect(effectiveAudience('masculine', false)).toBeUndefined();
    expect(effectiveAudience('feminine', false)).toBeUndefined();
  });

  it('returns undefined for a neutral or null role even with the filter on', () => {
    expect(effectiveAudience('neutral', true)).toBeUndefined();
    expect(effectiveAudience(null, true)).toBeUndefined();
  });
});
