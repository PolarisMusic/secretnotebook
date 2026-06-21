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
  /** Guard for the gate's one-shot auto-prompt, held here (not in the gate
   *  component) so it survives a remount of the gate — otherwise an upstream
   *  store hydrating and re-rendering RootStack would fire Face ID twice in a
   *  row. Reset whenever a new locked session begins (lock(), plus the
   *  cold-start default) so each lock auto-prompts exactly once. */
  autoPrompted: boolean;
  setTtl: (ttlMs: number) => void;
  unlock: (now?: () => number) => void;
  lock: () => void;
  /** Record that this lock-session's auto-prompt has fired. */
  markAutoPrompted: () => void;
}

export const useAppLockSession = create<AppLockSessionState>((set) => ({
  unlockedAt: null,
  ttlMs: DEFAULT_APP_LOCK_TTL_MS,
  autoPrompted: false,
  setTtl: (ttlMs) => set({ ttlMs }),
  unlock: (now = () => Date.now()) => set({ unlockedAt: now() }),
  lock: () => set({ unlockedAt: null, autoPrompted: false }),
  markAutoPrompted: () => set({ autoPrompted: true }),
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
