import { beforeEach, describe, expect, it } from '@jest/globals';

import {
  isLockedOut,
  lockoutRemainingMs,
  LOCKOUT_DURATION_MS,
  MAX_FAILURES_BEFORE_LOCKOUT,
  useSafeWordLockout,
} from '../src/features/safeword/lockout';

describe('SafeWordLockout', () => {
  beforeEach(() => {
    useSafeWordLockout.getState().reset();
  });

  it('exposes the documented policy constants', () => {
    expect(MAX_FAILURES_BEFORE_LOCKOUT).toBe(3);
    expect(LOCKOUT_DURATION_MS).toBe(30_000);
  });

  it('does not lock for the first two failures', () => {
    const t0 = 1_700_000_000_000;
    useSafeWordLockout.getState().recordFailure(() => t0);
    useSafeWordLockout.getState().recordFailure(() => t0);
    expect(isLockedOut(useSafeWordLockout.getState(), () => t0)).toBe(false);
  });

  it('locks for 30 s on the third failure', () => {
    const t0 = 1_700_000_000_000;
    for (let i = 0; i < MAX_FAILURES_BEFORE_LOCKOUT; i++) {
      useSafeWordLockout.getState().recordFailure(() => t0);
    }
    expect(isLockedOut(useSafeWordLockout.getState(), () => t0)).toBe(true);
    expect(lockoutRemainingMs(useSafeWordLockout.getState(), () => t0)).toBe(LOCKOUT_DURATION_MS);
    expect(
      lockoutRemainingMs(useSafeWordLockout.getState(), () => t0 + LOCKOUT_DURATION_MS / 2),
    ).toBe(LOCKOUT_DURATION_MS / 2);
    expect(isLockedOut(useSafeWordLockout.getState(), () => t0 + LOCKOUT_DURATION_MS + 1)).toBe(
      false,
    );
  });

  it('recordSuccess clears failures and any active lockout', () => {
    const t0 = 1_700_000_000_000;
    for (let i = 0; i < MAX_FAILURES_BEFORE_LOCKOUT; i++) {
      useSafeWordLockout.getState().recordFailure(() => t0);
    }
    useSafeWordLockout.getState().recordSuccess();
    expect(useSafeWordLockout.getState().failures).toBe(0);
    expect(useSafeWordLockout.getState().lockedUntil).toBeNull();
    expect(isLockedOut(useSafeWordLockout.getState(), () => t0)).toBe(false);
  });

  it('reset() restores the initial state', () => {
    const t0 = 1_700_000_000_000;
    useSafeWordLockout.getState().recordFailure(() => t0);
    useSafeWordLockout.getState().reset();
    expect(useSafeWordLockout.getState().failures).toBe(0);
    expect(useSafeWordLockout.getState().lockedUntil).toBeNull();
  });
});
