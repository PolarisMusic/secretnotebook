/**
 * Pure policy for "lock the Safe Word session if the app has been
 * backgrounded long enough." No React Native dependency so this file is
 * unit-testable in Node; the React hook wrapping it lives next door in
 * background-lock.ts.
 */
export type AppStateLike = 'active' | 'inactive' | 'background' | 'extension' | 'unknown';

export const DEFAULT_BACKGROUND_LOCK_THRESHOLD_MS = 60 * 1000;

export interface BackgroundLockOptions {
  /** ms */
  readonly thresholdMs?: number;
  readonly now?: () => number;
  /** Called when the threshold is exceeded on return-to-active. */
  readonly lock: () => void;
}

export interface BackgroundTracker {
  onChange: (next: AppStateLike) => void;
}

export function createBackgroundTracker(opts: BackgroundLockOptions): BackgroundTracker {
  const thresholdMs = opts.thresholdMs ?? DEFAULT_BACKGROUND_LOCK_THRESHOLD_MS;
  const now = opts.now ?? (() => Date.now());

  let backgroundedAt: number | null = null;
  let lastStatus: AppStateLike = 'active';

  return {
    onChange(next: AppStateLike) {
      // Going inactive/background: record the moment we left active.
      if ((next === 'background' || next === 'inactive') && lastStatus === 'active') {
        backgroundedAt = now();
      }

      // Returning to active: if we were gone long enough, lock.
      if (next === 'active' && lastStatus !== 'active') {
        if (backgroundedAt != null && now() - backgroundedAt >= thresholdMs) {
          opts.lock();
        }
        backgroundedAt = null;
      }

      lastStatus = next;
    },
  };
}
