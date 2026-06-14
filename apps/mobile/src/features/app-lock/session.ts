import { create } from 'zustand';

/**
 * App-lock session — in-memory only, never persisted. Holds the unix-ms
 * timestamp of the most recent successful biometric unlock. The app is
 * "unlocked" while `unlockedAt + ttlMs > now`.
 *
 * This is the privacy gate that replaced the old Safe-Word-as-password gate:
 * it is a *biometric* lock on app open (Face ID / Touch ID / device
 * passcode), completely decoupled from the Safe Word concept (which is being
 * redesigned into an optional roleplay term). The store is module-level and
 * not persisted, so a cold launch always starts `locked`.
 */
export const DEFAULT_APP_LOCK_TTL_MS = 5 * 60 * 1000;

interface AppLockSessionState {
  unlockedAt: number | null;
  ttlMs: number;
  setTtl: (ttlMs: number) => void;
  unlock: (now?: () => number) => void;
  lock: () => void;
}

export const useAppLockSession = create<AppLockSessionState>((set) => ({
  unlockedAt: null,
  ttlMs: DEFAULT_APP_LOCK_TTL_MS,
  setTtl: (ttlMs) => set({ ttlMs }),
  unlock: (now = () => Date.now()) => set({ unlockedAt: now() }),
  lock: () => set({ unlockedAt: null }),
}));

/**
 * Pure check, exported separately so non-React code can ask whether the app
 * is still unlocked without subscribing to the store.
 */
export function isAppUnlocked(
  state: Pick<AppLockSessionState, 'unlockedAt' | 'ttlMs'> = useAppLockSession.getState(),
  now: () => number = () => Date.now(),
): boolean {
  if (state.unlockedAt == null) return false;
  return now() - state.unlockedAt < state.ttlMs;
}
