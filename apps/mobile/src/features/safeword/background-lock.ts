import { useEffect } from 'react';
import { AppState } from 'react-native';

import { createBackgroundTracker, type BackgroundLockOptions } from './background-lock-policy';
import { useSafeWordSession } from './session';

// Re-export the pure policy surface so consumers have one import path.
export {
  DEFAULT_BACKGROUND_LOCK_THRESHOLD_MS,
  createBackgroundTracker,
} from './background-lock-policy';
export type {
  AppStateLike,
  BackgroundLockOptions,
  BackgroundTracker,
} from './background-lock-policy';

/**
 * React hook wrapping the pure background-lock policy. Subscribes to
 * RN's AppState, locks the Safe Word session if the user is gone for
 * more than `thresholdMs` (default 60 s — matches the S2 acceptance:
 * "background >60 s shows the gate").
 */
export function useBackgroundLock(opts: Omit<BackgroundLockOptions, 'lock'> = {}): void {
  useEffect(() => {
    const tracker = createBackgroundTracker({
      ...opts,
      lock: () => useSafeWordSession.getState().lock(),
    });
    const sub = AppState.addEventListener('change', tracker.onChange);
    return () => sub.remove();
  }, [opts]);
}
