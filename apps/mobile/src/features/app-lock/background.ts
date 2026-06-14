import { useEffect } from 'react';
import { AppState } from 'react-native';

import {
  createBackgroundTracker,
  type BackgroundLockOptions,
} from '../safeword/background-lock-policy';
import { useAppLockSession } from './session';

/**
 * Re-lock the app after it has been backgrounded longer than the threshold.
 * Reuses the pure `createBackgroundTracker` policy (shared with the old
 * safeword gate) and points its `lock` callback at the app-lock session.
 */
export function useAppLockBackground(opts: Omit<BackgroundLockOptions, 'lock'> = {}): void {
  useEffect(() => {
    const tracker = createBackgroundTracker({
      ...opts,
      lock: () => useAppLockSession.getState().lock(),
    });
    const sub = AppState.addEventListener('change', tracker.onChange);
    return () => sub.remove();
  }, [opts]);
}
