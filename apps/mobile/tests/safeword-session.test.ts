import { beforeEach, describe, expect, it } from '@jest/globals';

import {
  DEFAULT_SESSION_TTL_MS,
  isSafeWordSatisfied,
  useSafeWordSession,
} from '../src/features/safeword/session';

describe('SafeWordSession (Zustand, in-memory only)', () => {
  beforeEach(() => {
    useSafeWordSession.setState({ satisfiedAt: null, ttlMs: DEFAULT_SESSION_TTL_MS });
  });

  it('starts locked on a cold launch', () => {
    expect(useSafeWordSession.getState().satisfiedAt).toBeNull();
    expect(isSafeWordSatisfied(useSafeWordSession.getState(), () => 1)).toBe(false);
  });

  it('satisfies for ttlMs after a successful check', () => {
    const t0 = 1_700_000_000_000;
    useSafeWordSession.getState().satisfy(() => t0);

    expect(isSafeWordSatisfied(useSafeWordSession.getState(), () => t0)).toBe(true);
    expect(isSafeWordSatisfied(useSafeWordSession.getState(), () => t0 + 60_000)).toBe(true);
    expect(
      isSafeWordSatisfied(useSafeWordSession.getState(), () => t0 + DEFAULT_SESSION_TTL_MS),
    ).toBe(false);
  });

  it('lock() returns to the locked state immediately', () => {
    const t0 = 1_700_000_000_000;
    useSafeWordSession.getState().satisfy(() => t0);
    useSafeWordSession.getState().lock();
    expect(useSafeWordSession.getState().satisfiedAt).toBeNull();
  });

  it('touch() extends an active session', () => {
    const t0 = 1_700_000_000_000;
    useSafeWordSession.getState().satisfy(() => t0);

    useSafeWordSession.getState().touch(() => t0 + 60_000);
    const state = useSafeWordSession.getState();
    expect(state.satisfiedAt).toBe(t0 + 60_000);
    expect(isSafeWordSatisfied(state, () => t0 + 60_000 + DEFAULT_SESSION_TTL_MS - 1)).toBe(true);
  });

  it('touch() is a no-op when locked (never resurrects a session)', () => {
    useSafeWordSession.getState().touch(() => 1_700_000_000_000);
    expect(useSafeWordSession.getState().satisfiedAt).toBeNull();
  });

  it('setTtl() overrides the default for tests / paranoid mode', () => {
    useSafeWordSession.getState().setTtl(60_000);
    expect(useSafeWordSession.getState().ttlMs).toBe(60_000);
  });
});
