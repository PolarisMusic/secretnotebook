import { create } from 'zustand';

/**
 * Safe Word session — in-memory only, never persisted (acceptance: "no
 * session token in DB or MMKV"). Holds the unix-ms timestamp of the most
 * recent successful Safe Word check. A session is "satisfied" while
 * `satisfiedAt + ttlMs > now`; the gate re-prompts as soon as that
 * window closes.
 *
 * The store is intentionally module-level and not persisted, so a cold
 * launch starts every session as `locked`.
 */
export const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000;

interface SafeWordSessionState {
  satisfiedAt: number | null;
  ttlMs: number;
  setTtl: (ttlMs: number) => void;
  satisfy: (now?: () => number) => void;
  lock: () => void;
  touch: (now?: () => number) => void;
}

export const useSafeWordSession = create<SafeWordSessionState>((set) => ({
  satisfiedAt: null,
  ttlMs: DEFAULT_SESSION_TTL_MS,
  setTtl: (ttlMs) => set({ ttlMs }),
  satisfy: (now = () => Date.now()) => set({ satisfiedAt: now() }),
  lock: () => set({ satisfiedAt: null }),
  touch: (now = () => Date.now()) =>
    set((s) => (s.satisfiedAt == null ? s : { ...s, satisfiedAt: now() })),
}));

/**
 * Pure check, exported separately so non-React code (e.g. background
 * timers, deep links) can ask whether the session is still alive without
 * subscribing to the store.
 */
export function isSafeWordSatisfied(
  state: Pick<SafeWordSessionState, 'satisfiedAt' | 'ttlMs'> = useSafeWordSession.getState(),
  now: () => number = () => Date.now(),
): boolean {
  if (state.satisfiedAt == null) return false;
  return now() - state.satisfiedAt < state.ttlMs;
}
