import { computeBlindedRecipientIdHex } from '@secretnotebook/connection-protocol';
import { bytesToHex } from '@secretnotebook/crypto';
import { create } from 'zustand';

import { DEFAULT_API_CONFIG } from '../api/config';
import { countOutbox } from './outbox';
import type { FlushResult, PullResult, SyncEngine } from './sync-engine';

/**
 * A snapshot of the live sync state, surfaced on the in-app Sync diagnostics
 * screen so partner-note transfer can be debugged on a TestFlight build with
 * no Metro / Console.app attached.
 *
 * The decisive cross-phone comparison: THIS phone's `sendInbox` (where it
 * posts) must equal the OTHER phone's `pollInbox` (where it polls). They are
 * the same daily-rotated blinded id computed from the shared connection root,
 * so a mismatch means the two devices derived different roots at pairing —
 * the one failure mode the code can't catch on its own.
 */
export interface SyncDebugSnapshot {
  /** Resolved API host. Must be identical on both phones. */
  readonly baseUrl: string;
  /** connection.id prefix — same on both phones for one pairing. */
  readonly conn: string;
  readonly selfHex: string;
  readonly peerHex: string;
  /** connection-root prefix — same on both phones; differs ⇒ pairing bug. */
  readonly rootHex: string;
  /** Blinded inbox we GET (receive). */
  readonly pollInbox: string;
  /** Blinded inbox we POST to (send). Equals partner's pollInbox. */
  readonly sendInbox: string;
  /** Queued ops not yet delivered. Stuck > 0 ⇒ flush() can't POST. */
  readonly outboxDepth: number;
  readonly lastFlush: FlushResult | null;
  readonly lastPull: PullResult | null;
  /** Last thrown cycle error (flush/pull/manual), or null. */
  readonly lastError: string | null;
  readonly updatedAt: number;
}

const BASE: SyncDebugSnapshot = {
  baseUrl: DEFAULT_API_CONFIG.baseUrl,
  conn: '—',
  selfHex: '—',
  peerHex: '—',
  rootHex: '—',
  pollInbox: '—',
  sendInbox: '—',
  outboxDepth: 0,
  lastFlush: null,
  lastPull: null,
  lastError: null,
  updatedAt: 0,
};

interface SyncDebugState {
  snapshot: SyncDebugSnapshot | null;
  merge: (patch: Partial<SyncDebugSnapshot>) => void;
}

export const useSyncDebugStore = create<SyncDebugState>((set) => ({
  snapshot: null,
  merge: (patch) =>
    set((s) => ({ snapshot: { ...(s.snapshot ?? BASE), ...patch, updatedAt: Date.now() } })),
}));

/**
 * Recompute the diagnostics snapshot from the engine + the latest cycle
 * result. Wrapped in a swallow-all try/catch: a diagnostics failure must
 * never break a sync cycle. A clean flush (failed === 0) clears any stale
 * send error so the panel doesn't keep showing a resolved problem.
 */
export async function recordSyncCycle(
  engine: SyncEngine,
  flushed: FlushResult,
  pulled: PullResult,
): Promise<void> {
  try {
    const date = new Date();
    const [pollInbox, sendInbox, outboxDepth] = await Promise.all([
      computeBlindedRecipientIdHex({
        connectionRoot: engine.connectionRoot,
        recipientPubkey: engine.selfPub,
        date,
      }),
      computeBlindedRecipientIdHex({
        connectionRoot: engine.connectionRoot,
        recipientPubkey: engine.peerPub,
        date,
      }),
      countOutbox(engine.exec),
    ]);
    useSyncDebugStore.getState().merge({
      baseUrl: DEFAULT_API_CONFIG.baseUrl,
      conn: engine.connectionId.slice(0, 8),
      selfHex: bytesToHex(engine.selfPub).slice(0, 8),
      peerHex: bytesToHex(engine.peerPub).slice(0, 8),
      rootHex: bytesToHex(engine.connectionRoot).slice(0, 8),
      pollInbox: pollInbox.slice(0, 8),
      sendInbox: sendInbox.slice(0, 8),
      outboxDepth,
      lastFlush: flushed,
      lastPull: pulled,
      // Clear a stale send error only when a flush actually drained rows
      // cleanly. A flush that THREW entirely reports attempted=0/failed=0
      // (runSyncCycle caught it) — that must not wipe the error onError just
      // recorded, or the panel flickers the real failure away.
      ...(flushed.attempted > 0 && flushed.failed === 0 ? { lastError: null } : {}),
    });
  } catch {
    // diagnostics are best-effort
  }
}

/** Record a thrown cycle error (from the ticker's onError) into the panel. */
export function recordSyncError(step: string, message: string): void {
  useSyncDebugStore.getState().merge({ lastError: `${step}: ${message}` });
}
