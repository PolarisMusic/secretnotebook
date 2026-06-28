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

/**
 * Window after a successful biometric during which the gate skips a
 * re-prompt. Shorter than the main lock TTL so a background-lock that fires
 * within the window (e.g. device-lock after 2 min of inactivity, < 5 min
 * since last scan) doesn't immediately demand another Face ID. Cleared on
 * explicit lock() so a user-initiated "lock now" still requires a fresh scan.
 */
export const RECENTLY_AUTHENTICATED_TTL_MS = 5 * 60 * 1000;

interface AppLockSessionState {
  unlockedAt: number | null;
  ttlMs: number;
  /** Guard for the gate's one-shot auto-prompt, held here (not in the gate
   *  component) so it survives a remount of the gate — otherwise an upstream
   *  store hydrating and re-rendering RootStack would fire Face ID twice in a
   *  row. Reset whenever a new locked session begins (lock(), plus the
   *  cold-start default) so each lock auto-prompts exactly once. */
  autoPrompted: boolean;
  /** Epoch-ms deadline for the "skip biometric" grace window set after every
   *  successful scan (or after bootstrap, where keychain read was the implicit
   *  biometric). NULL until the first successful authentication. */
  recentlyAuthenticatedUntil: number | null;
  setTtl: (ttlMs: number) => void;
  unlock: (now?: () => number) => void;
  lock: () => void;
  /** Record that this lock-session's auto-prompt has fired. */
  markAutoPrompted: () => void;
  /** Record a successful authentication so non-critical re-prompts within
   *  RECENTLY_AUTHENTICATED_TTL_MS can be skipped. */
  markRecentlyAuthenticated: (now?: () => number) => void;
}

export const useAppLockSession = create<AppLockSessionState>((set) => ({
  unlockedAt: null,
  ttlMs: DEFAULT_APP_LOCK_TTL_MS,
  autoPrompted: false,
  recentlyAuthenticatedUntil: null,
  setTtl: (ttlMs) => set({ ttlMs }),
  unlock: (now = () => Date.now()) => set({ unlockedAt: now() }),
  lock: () => set({ unlockedAt: null, autoPrompted: false, recentlyAuthenticatedUntil: null }),
  markAutoPrompted: () => set({ autoPrompted: true }),
  markRecentlyAuthenticated: (now = () => Date.now()) =>
    set({ recentlyAuthenticatedUntil: now() + RECENTLY_AUTHENTICATED_TTL_MS }),
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

/**
 * True within RECENTLY_AUTHENTICATED_TTL_MS of the last successful biometric
 * or implicit keychain unlock. The gate uses this to skip a re-prompt when
 * the user has already scanned very recently (e.g. a background-lock that
 * fires within minutes of the last Face ID).
 */
export function isRecentlyAuthenticated(
  state: Pick<AppLockSessionState, 'recentlyAuthenticatedUntil'> = useAppLockSession.getState(),
  now: () => number = () => Date.now(),
): boolean {
  if (state.recentlyAuthenticatedUntil == null) return false;
  return now() < state.recentlyAuthenticatedUntil;
}
