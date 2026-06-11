import { create } from 'zustand';

/**
 * Tester-build debug log. Kept tiny on purpose — append-only, capped at
 * MAX_LINES, no persistence. Surfaced via DebugOverlay so we can see
 * what's happening during boot + onboarding when TestFlight gives us no
 * console.
 *
 * Gated behind `EXPO_PUBLIC_DEBUG_OVERLAY=1`; the overlay returns null
 * otherwise so production builds bear no UI cost. The store itself is
 * harmless when never read.
 */

const MAX_LINES = 80;

export interface DebugLine {
  readonly id: number;
  readonly tag: string;
  readonly message: string;
  readonly level: 'info' | 'warn' | 'error';
  readonly at: number;
}

interface DebugLogState {
  readonly lines: ReadonlyArray<DebugLine>;
  push(tag: string, message: string, level?: 'info' | 'warn' | 'error'): void;
  clear(): void;
}

let nextId = 1;

export const useDebugLog = create<DebugLogState>((set) => ({
  lines: [],
  push: (tag, message, level = 'info') =>
    set((s) => {
      const line: DebugLine = { id: nextId++, tag, message, level, at: Date.now() };
      const next = [...s.lines, line];
      // Drop the oldest if we overflow; keeps the bottom-rendered tail
      // visually stable for the operator reading the overlay.
      return { lines: next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next };
    }),
  clear: () => set({ lines: [] }),
}));

/**
 * Imperative shortcut: lets non-React modules (boot pipeline, network
 * client, etc.) push log lines without taking a hook dependency. Reads
 * the store's current state so callers don't need to subscribe.
 */
export function debugLog(
  tag: string,
  message: string,
  level: 'info' | 'warn' | 'error' = 'info',
): void {
  useDebugLog.getState().push(tag, message, level);
}
