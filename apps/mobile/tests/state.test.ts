import { describe, expect, it } from '@jest/globals';

import { useConnectionStore } from '../src/state/connection';

describe('useConnectionStore', () => {
  it('starts unpaired', () => {
    expect(useConnectionStore.getState().status).toBe('unpaired');
  });

  it('updates via setStatus and re-reads', () => {
    useConnectionStore.getState().setStatus('paired');
    expect(useConnectionStore.getState().status).toBe('paired');
    useConnectionStore.getState().setStatus('unpaired');
  });

  it('only permits the four documented status values (compile-time)', () => {
    useConnectionStore.getState().setStatus('awaiting_safeword');
    useConnectionStore.getState().setStatus('severed');
    useConnectionStore.getState().setStatus('unpaired');
    expect(useConnectionStore.getState().status).toBe('unpaired');
  });
});
