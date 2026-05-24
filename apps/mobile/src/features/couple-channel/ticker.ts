import { useEffect, useRef } from 'react';
import type { FlushResult, PullResult, SyncEngine } from './sync-engine';

export interface SyncCycleResult {
  flushed: FlushResult;
  pulled: PullResult;
}

export type SyncStep = 'flush' | 'pull';

/**
 * One full sync cycle: flush() → pull(). Pure-ish — no timers, no React.
 * Errors thrown by either step are caught and forwarded to `onError`;
 * the cycle does not abort halfway so the read path still runs if a
 * transient write blip failed.
 */
export async function runSyncCycle(
  engine: SyncEngine,
  opts: { onError?: (err: Error, step: SyncStep) => void } = {},
): Promise<SyncCycleResult> {
  let flushed: FlushResult = { attempted: 0, delivered: 0, failed: 0 };
  let pulled: PullResult = { fetched: 0, applied: 0, duplicates: 0 };
  try {
    flushed = await engine.flush();
  } catch (e) {
    opts.onError?.(e as Error, 'flush');
  }
  try {
    pulled = await engine.pull();
  } catch (e) {
    opts.onError?.(e as Error, 'pull');
  }
  return { flushed, pulled };
}

export const DEFAULT_SYNC_INTERVAL_MS = 15_000;

export interface UseSyncTickerOpts {
  /** Sync cycle interval. Defaults to 15s — short enough for a feels-live
   *  Save → see-it flow, long enough not to thrash the relay. */
  readonly intervalMs?: number;
  /** Fire one cycle immediately on mount (don't wait for the first tick). */
  readonly runOnMount?: boolean;
  /** Optional error sink — surfaced inline rather than crashing the timer. */
  readonly onError?: (err: Error, step: SyncStep) => void;
}

/**
 * React hook that drives the engine on a foreground timer. Set the
 * engine to null (e.g. on severing) to stop ticking. The hook
 * deliberately does NOT touch react-native-background-fetch — that's
 * a Mac-runbook native-module wire-up. This covers the foreground
 * case ("user is staring at the screen, the partner just saved
 * something, it should show up within 15s").
 *
 * The hook guards against overlapping cycles: if a tick fires while
 * the previous cycle is still in flight, the new tick is dropped.
 * That keeps slow networks from queuing cycles up at the engine.
 */
export function useSyncTicker(engine: SyncEngine | null, opts: UseSyncTickerOpts = {}): void {
  const intervalMs = opts.intervalMs ?? DEFAULT_SYNC_INTERVAL_MS;
  const runOnMount = opts.runOnMount ?? true;
  const onError = opts.onError;
  const inflight = useRef(false);

  useEffect(() => {
    if (!engine) return;
    let cancelled = false;

    const tick = async (): Promise<void> => {
      if (cancelled || inflight.current) return;
      inflight.current = true;
      try {
        await runSyncCycle(engine, { onError });
      } finally {
        inflight.current = false;
      }
    };

    if (runOnMount) void tick();
    const handle = setInterval(() => void tick(), intervalMs);
    return (): void => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [engine, intervalMs, runOnMount, onError]);
}
