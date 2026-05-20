import { describe, expect, it, jest } from '@jest/globals';

import {
  createBackgroundTracker,
  DEFAULT_BACKGROUND_LOCK_THRESHOLD_MS,
} from '../src/features/safeword/background-lock-policy';

/**
 * Pure-state-machine tests for the AppState lock policy. The React hook
 * wrapping this lives in the same module and is exercised indirectly via
 * RN AppState in the running app — we do not pull in the RN harness for
 * a unit test.
 */
describe('createBackgroundTracker', () => {
  it('does not lock on a brief background dip below the threshold', () => {
    let now = 1_700_000_000_000;
    const lock = jest.fn();
    const tracker = createBackgroundTracker({ now: () => now, lock });

    tracker.onChange('active');
    now += 1;
    tracker.onChange('background');
    now += 30_000;
    tracker.onChange('active');

    expect(lock).not.toHaveBeenCalled();
  });

  it('locks when more than the threshold elapses between background and active', () => {
    let now = 1_700_000_000_000;
    const lock = jest.fn();
    const tracker = createBackgroundTracker({ now: () => now, lock });

    tracker.onChange('active');
    now += 1;
    tracker.onChange('background');
    now += DEFAULT_BACKGROUND_LOCK_THRESHOLD_MS + 1;
    tracker.onChange('active');

    expect(lock).toHaveBeenCalledTimes(1);
  });

  it('locks at exactly the threshold (>=, not strictly >)', () => {
    let now = 1_700_000_000_000;
    const lock = jest.fn();
    const tracker = createBackgroundTracker({ now: () => now, lock, thresholdMs: 60_000 });

    tracker.onChange('active');
    now += 1;
    tracker.onChange('background');
    now += 60_000;
    tracker.onChange('active');

    expect(lock).toHaveBeenCalledTimes(1);
  });

  it('treats inactive → active as a return-from-background', () => {
    let now = 1_700_000_000_000;
    const lock = jest.fn();
    const tracker = createBackgroundTracker({ now: () => now, lock, thresholdMs: 1000 });

    tracker.onChange('active');
    now += 1;
    tracker.onChange('inactive');
    now += 5_000;
    tracker.onChange('active');

    expect(lock).toHaveBeenCalledTimes(1);
  });

  it('does not double-fire across consecutive active changes', () => {
    const now = 1_700_000_000_000;
    const lock = jest.fn();
    const tracker = createBackgroundTracker({ now: () => now, lock, thresholdMs: 1000 });

    tracker.onChange('active');
    tracker.onChange('active');
    tracker.onChange('active');

    expect(lock).not.toHaveBeenCalled();
  });

  it('uses a custom threshold when supplied', () => {
    let now = 1_700_000_000_000;
    const lock = jest.fn();
    const tracker = createBackgroundTracker({ now: () => now, lock, thresholdMs: 5_000 });

    tracker.onChange('active');
    now += 1;
    tracker.onChange('background');
    now += 4_999;
    tracker.onChange('active');
    expect(lock).not.toHaveBeenCalled();

    tracker.onChange('background');
    now += 5_000;
    tracker.onChange('active');
    expect(lock).toHaveBeenCalledTimes(1);
  });
});
