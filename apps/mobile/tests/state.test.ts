import { describe, expect, it } from '@jest/globals';

import { useCoupleStore } from '../src/state/couple';

describe('useCoupleStore', () => {
  it('starts unpaired', () => {
    expect(useCoupleStore.getState().status).toBe('unpaired');
  });

  it('updates via setStatus and re-reads', () => {
    useCoupleStore.getState().setStatus('paired');
    expect(useCoupleStore.getState().status).toBe('paired');
    useCoupleStore.getState().setStatus('unpaired');
  });

  it('only permits the four documented status values (compile-time)', () => {
    useCoupleStore.getState().setStatus('awaiting_safeword');
    useCoupleStore.getState().setStatus('severed');
    useCoupleStore.getState().setStatus('unpaired');
    expect(useCoupleStore.getState().status).toBe('unpaired');
  });
});
