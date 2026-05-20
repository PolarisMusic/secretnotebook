import { create } from 'zustand';

/**
 * Safe Word lockout policy — in-memory, never persisted (so a process
 * restart resets it, intentionally; a stolen-phone adversary already had
 * to defeat the device unlock).
 *
 * Acceptance: "wrong rejects 3× and locks for 30s". The third wrong
 * answer flips the lockout on; subsequent attempts are refused without
 * even running Argon2id (which would otherwise burn CPU on an attacker's
 * behalf). A successful verify resets the counter.
 */
export const MAX_FAILURES_BEFORE_LOCKOUT = 3;
export const LOCKOUT_DURATION_MS = 30 * 1000;

interface LockoutState {
  failures: number;
  lockedUntil: number | null;
  recordFailure: (now?: () => number) => void;
  recordSuccess: () => void;
  reset: () => void;
}

export const useSafeWordLockout = create<LockoutState>((set, get) => ({
  failures: 0,
  lockedUntil: null,
  recordFailure: (now = () => Date.now()) => {
    const next = get().failures + 1;
    if (next >= MAX_FAILURES_BEFORE_LOCKOUT) {
      set({ failures: next, lockedUntil: now() + LOCKOUT_DURATION_MS });
    } else {
      set({ failures: next });
    }
  },
  recordSuccess: () => set({ failures: 0, lockedUntil: null }),
  reset: () => set({ failures: 0, lockedUntil: null }),
}));

/**
 * Returns the number of milliseconds the caller must still wait before
 * trying again, or 0 if attempts are allowed.
 */
export function lockoutRemainingMs(
  state: Pick<LockoutState, 'lockedUntil'> = useSafeWordLockout.getState(),
  now: () => number = () => Date.now(),
): number {
  if (state.lockedUntil == null) return 0;
  return Math.max(0, state.lockedUntil - now());
}

export function isLockedOut(
  state: Pick<LockoutState, 'lockedUntil'> = useSafeWordLockout.getState(),
  now: () => number = () => Date.now(),
): boolean {
  return lockoutRemainingMs(state, now) > 0;
}
