import { describe, expect, it, jest } from '@jest/globals';
import type {
  FlushResult,
  PullResult,
  SyncEngine,
} from '../src/features/couple-channel/sync-engine';
import { runSyncCycle } from '../src/features/couple-channel/ticker';

interface MockEngine {
  flush: jest.Mock<() => Promise<FlushResult>>;
  pull: jest.Mock<() => Promise<PullResult>>;
}

function mockEngine(
  opts: {
    flushResult?: FlushResult;
    pullResult?: PullResult;
    flushError?: Error;
    pullError?: Error;
  } = {},
): { engine: SyncEngine; mock: MockEngine } {
  const m: MockEngine = {
    flush: jest.fn(async () => {
      if (opts.flushError) throw opts.flushError;
      return opts.flushResult ?? { attempted: 0, delivered: 0, failed: 0 };
    }),
    pull: jest.fn(async () => {
      if (opts.pullError) throw opts.pullError;
      return opts.pullResult ?? { fetched: 0, applied: 0, duplicates: 0 };
    }),
  };
  return { engine: m as unknown as SyncEngine, mock: m };
}

describe('runSyncCycle', () => {
  it('returns both step results when flush + pull succeed', async () => {
    const { engine, mock } = mockEngine({
      flushResult: { attempted: 2, delivered: 2, failed: 0 },
      pullResult: { fetched: 3, applied: 3, duplicates: 0 },
    });
    const out = await runSyncCycle(engine);
    expect(out.flushed).toEqual({ attempted: 2, delivered: 2, failed: 0 });
    expect(out.pulled).toEqual({ fetched: 3, applied: 3, duplicates: 0 });
    expect(mock.flush).toHaveBeenCalledTimes(1);
    expect(mock.pull).toHaveBeenCalledTimes(1);
  });

  it('still runs pull when flush throws, and surfaces the error to onError', async () => {
    const flushError = new Error('flush blew up');
    const { engine, mock } = mockEngine({
      flushError,
      pullResult: { fetched: 1, applied: 1, duplicates: 0 },
    });
    const onError = jest.fn();
    const out = await runSyncCycle(engine, { onError });
    expect(out.flushed).toEqual({ attempted: 0, delivered: 0, failed: 0 });
    expect(out.pulled).toEqual({ fetched: 1, applied: 1, duplicates: 0 });
    expect(mock.pull).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(flushError, 'flush');
  });

  it('surfaces pull errors via onError without re-throwing', async () => {
    const pullError = new Error('relay down');
    const { engine } = mockEngine({ pullError });
    const onError = jest.fn();
    const out = await runSyncCycle(engine, { onError });
    // No throw, defaults returned.
    expect(out).toEqual({
      flushed: { attempted: 0, delivered: 0, failed: 0 },
      pulled: { fetched: 0, applied: 0, duplicates: 0 },
    });
    expect(onError).toHaveBeenCalledWith(pullError, 'pull');
  });

  it("swallows both flush + pull errors so a foreground ticker can't lose its loop", async () => {
    const { engine } = mockEngine({
      flushError: new Error('flush'),
      pullError: new Error('pull'),
    });
    const onError = jest.fn();
    await expect(runSyncCycle(engine, { onError })).resolves.toBeTruthy();
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError.mock.calls.map((c) => c[1])).toEqual(['flush', 'pull']);
  });

  it('works with no onError handler — errors are silently swallowed', async () => {
    const { engine } = mockEngine({
      flushError: new Error('boom'),
      pullError: new Error('boom2'),
    });
    await expect(runSyncCycle(engine)).resolves.toEqual({
      flushed: { attempted: 0, delivered: 0, failed: 0 },
      pulled: { fetched: 0, applied: 0, duplicates: 0 },
    });
  });
});
