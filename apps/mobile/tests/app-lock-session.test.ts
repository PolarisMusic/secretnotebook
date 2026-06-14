import { describe, expect, it } from '@jest/globals';

import {
  DEFAULT_APP_LOCK_TTL_MS,
  isAppUnlocked,
  useAppLockSession,
} from '../src/features/app-lock/session';

describe('app-lock session', () => {
  it('starts locked (no unlockedAt)', () => {
    useAppLockSession.setState({ unlockedAt: null, ttlMs: DEFAULT_APP_LOCK_TTL_MS });
    expect(isAppUnlocked()).toBe(false);
  });

  it('unlock() marks the app unlocked within the TTL window', () => {
    const t = 1_000_000;
    useAppLockSession.setState({ unlockedAt: null, ttlMs: 60_000 });
    useAppLockSession.getState().unlock(() => t);
    expect(isAppUnlocked({ unlockedAt: t, ttlMs: 60_000 }, () => t + 59_999)).toBe(true);
  });

  it('re-locks once the TTL elapses', () => {
    const t = 1_000_000;
    expect(isAppUnlocked({ unlockedAt: t, ttlMs: 60_000 }, () => t + 60_001)).toBe(false);
  });

  it('lock() clears the unlock timestamp', () => {
    useAppLockSession.getState().unlock(() => 1);
    useAppLockSession.getState().lock();
    expect(useAppLockSession.getState().unlockedAt).toBeNull();
    expect(isAppUnlocked()).toBe(false);
  });
});
