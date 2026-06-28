import { computeBlindedRecipientIdHex } from '@secretnotebook/connection-protocol';
import { bytesToHex } from '@secretnotebook/crypto';
import { create } from 'zustand';

import { DEFAULT_API_CONFIG } from '../api/config';
import { countPendingNotes } from '../notes/pending-store';
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
  // --- session-cumulative counters (since boot) ---
  /** Sum of flushed.attempted across all cycles this session. */
  readonly totalAttempted: number;
  /** Sum of flushed.delivered across all cycles this session. */
  readonly totalDelivered: number;
  /** Sum of flushed.failed across all cycles this session. */
  readonly totalFailed: number;
  /** Max outbox depth observed this session. >0 ever ⇒ a save DID enqueue,
   *  even if it then drained too fast to catch in the per-cycle snapshot. */
  readonly peakOutboxDepth: number;
  /** Millis (Date.now()) of the most recent cycle that delivered ≥1 op,
   *  or null if no successful delivery yet. */
  readonly lastDeliveredAt: number | null;
  // --- local DB row counts (decisive for "did the save reach the outbox?") ---
  /** Total rows in `note` (shared + secret, sender + receiver-projected). */
  readonly noteCount: number;
  /** Rows in `pending_note` — a save that fell through to the pre-pairing
   *  draft path because engine was null at compose time. >0 with notes that
   *  should have shipped = the "engine null at submit" fork was taken. */
  readonly pendingNoteCount: number;
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
  totalAttempted: 0,
  totalDelivered: 0,
  totalFailed: 0,
  peakOutboxDepth: 0,
  lastDeliveredAt: null,
  noteCount: 0,
  pendingNoteCount: 0,
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
async function countNotes(engine: SyncEngine): Promise<number> {
  const rows = await engine.exec.query<{ n: number }>(`SELECT COUNT(*) AS n FROM note`, []);
  return Number(rows[0]?.n ?? 0);
}

export async function recordSyncCycle(
  engine: SyncEngine,
  flushed: FlushResult,
  pulled: PullResult,
): Promise<void> {
  try {
    const date = new Date();
    const [pollInbox, sendInbox, outboxDepth, noteCount, pendingNoteCount] = await Promise.all([
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
      countNotes(engine),
      countPendingNotes(engine.exec),
    ]);
    const prev = useSyncDebugStore.getState().snapshot;
    const prevTotals = prev ?? {
      totalAttempted: 0,
      totalDelivered: 0,
      totalFailed: 0,
      peakOutboxDepth: 0,
      lastDeliveredAt: null as number | null,
    };
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
      // Cumulative totals: a single screenshot answers "did anything ever
      // ship?" without having to catch the per-cycle delivery frame in the
      // ~15s window between enqueue and drain.
      totalAttempted: prevTotals.totalAttempted + flushed.attempted,
      totalDelivered: prevTotals.totalDelivered + flushed.delivered,
      totalFailed: prevTotals.totalFailed + flushed.failed,
      peakOutboxDepth: Math.max(prevTotals.peakOutboxDepth, outboxDepth),
      lastDeliveredAt: flushed.delivered > 0 ? Date.now() : prevTotals.lastDeliveredAt,
      noteCount,
      pendingNoteCount,
      // Clear a stale send error only when a flush actually drained rows
      // cleanly. A flush that THREW entirely reports attempted=0/failed=0
      // (runSyncCycle caught it) — that must not wipe the error onError just
      // recorded, or the panel flickers the real failure away.
      ...(flushed.attempted > 0 && flushed.failed === 0 ? { lastError: null } : {}),
    });
    // Apply the peak-vs-attempted reconciliation outside the merge above so
    // the calculation reads the updated outboxDepth/totalAttempted state.
    useSyncDebugStore.getState().merge({
      peakOutboxDepth: Math.max(prevTotals.peakOutboxDepth, outboxDepth, flushed.attempted),
    });
  } catch {
    // diagnostics are best-effort
  }
}

/**
 * Record a stand-alone flush (e.g. the immediate post-compose flush in
 * NotesComposeRoute) into the diagnostics store. Necessary because that
 * flush bypasses the ticker's onCycle hook — without this, the compose-
 * triggered drain looks invisible to the panel and the cumulative totals
 * stay at 0 even when sends are succeeding.
 *
 * Updates only flush-related fields, never overwriting the last pull's
 * snapshot.
 */
export async function recordFlush(engine: SyncEngine, flushed: FlushResult): Promise<void> {
  try {
    const outboxDepth = await countOutbox(engine.exec);
    const prev = useSyncDebugStore.getState().snapshot ?? BASE;
    useSyncDebugStore.getState().merge({
      lastFlush: flushed,
      outboxDepth,
      totalAttempted: prev.totalAttempted + flushed.attempted,
      totalDelivered: prev.totalDelivered + flushed.delivered,
      totalFailed: prev.totalFailed + flushed.failed,
      peakOutboxDepth: Math.max(prev.peakOutboxDepth, outboxDepth, flushed.attempted),
      lastDeliveredAt: flushed.delivered > 0 ? Date.now() : prev.lastDeliveredAt,
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
