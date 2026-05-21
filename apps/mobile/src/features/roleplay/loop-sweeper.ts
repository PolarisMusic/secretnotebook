import type { SqlExecutor } from '../../db/executor';
import {
  awardCouplePoints,
  deriveLedgerEntryId,
  LEDGER_REASON,
  POINTS_LOOP_COMPLETED,
} from '../ledger/couple-points';
import type { SyncEngine } from '../couple-channel/sync-engine';

export interface SweepResult {
  /** Sessions that newly received their +25 award in this sweep. */
  awardedSessionIds: string[];
}

interface CandidateRow {
  id: string;
}

/**
 * Find role-play sessions whose gratitude loop has fully closed
 * (both done_at columns set) but whose +25 ledger entry has not
 * landed yet, and fire the award. Run on the foreground ticker
 * after each pull — the awarder's deterministic ledger id makes
 * concurrent races from both partners idempotent. This covers the
 * "both partners mark gratitude before either has synced the
 * other's op" case, which markGratitudeStep can't catch from a
 * single action call.
 */
export async function sweepCompletedLoops(
  exec: SqlExecutor,
  engine: SyncEngine,
  opts: { now?: () => number } = {},
): Promise<SweepResult> {
  const rows = await exec.query<CandidateRow>(
    `SELECT id FROM roleplay_session
      WHERE gratitude_enactor_done_at IS NOT NULL
        AND gratitude_curator_done_at IS NOT NULL`,
  );
  const awarded: string[] = [];
  for (const row of rows) {
    const ledgerId = await deriveLedgerEntryId(LEDGER_REASON.loopCompleted, row.id);
    const existing = await exec.query<{ id: string }>(
      `SELECT id FROM ledger_entry WHERE id = ? LIMIT 1`,
      [ledgerId],
    );
    if (existing.length > 0) continue;
    await awardCouplePoints({
      exec,
      engine,
      delta: POINTS_LOOP_COMPLETED,
      reason: LEDGER_REASON.loopCompleted,
      refId: row.id,
      now: opts.now,
    });
    awarded.push(row.id);
  }
  return { awardedSessionIds: awarded };
}
