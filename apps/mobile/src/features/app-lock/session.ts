import { create } from 'zustand';

/**
 * App-lock session — in-memory only, never persisted, so every cold launch
 * starts locked and requires a fresh biometric unlock. This REPLACES the
 * Safe Word as the app-open gate (the Safe Word is being redesigned into an
 * optional roleplay term and no longer guards app access).
 *
 * A session is "unlocked" while `unlockedAt + ttlMs > now`. The gate
 * re-prompts as soon as that window closes (e.g. after a long background per
 * the background-lock policy).
 */
export const DEFAULT_APP_LOCK_TTL_MS = 30 * 60 * 1000;

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
 * Pure check, exported separately so non-React code can ask whether the
 * session is still alive without subscribing to the store.
 */
export function isAppUnlocked(
  state: Pick<AppLockSessionState, 'unlockedAt' | 'ttlMs'> = useAppLockSession.getState(),
  now: () => number = () => Date.now(),
): boolean {
  if (state.unlockedAt == null) return false;
  return now() - state.unlockedAt < state.ttlMs;
}
