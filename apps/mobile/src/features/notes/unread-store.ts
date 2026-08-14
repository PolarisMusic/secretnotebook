import { create } from 'zustand';

import type { SqlExecutor } from '../../db/executor';
import { getNotesLastViewedAt } from '../settings/store';

/**
 * Unread-notes badge state. "Unread" means: created after the watermark the
 * notes list stamps on each visit (`notes_last_viewed_at`) and authored by the
 * partner — your own note is never news to you.
 *
 * Deliberately a tiny derived counter rather than push notifications: real
 * push needs APNs credentials and a server component, whereas this reuses the
 * watermark the list already maintains and costs one COUNT query per refresh.
 */
interface UnreadState {
  count: number;
  setCount: (n: number) => void;
}

export const useUnreadNotesStore = create<UnreadState>((set) => ({
  count: 0,
  setCount: (n) => set({ count: n }),
}));

/**
 * Recompute the unread count. Called after each sync pull (so the badge tracks
 * notes that arrive while you're on another screen) and whenever the notes
 * list reloads. `selfPubkey` omitted ⇒ unpaired, nothing can be unread.
 */
export async function refreshUnreadNotes(
  exec: SqlExecutor,
  selfPubkey: Uint8Array | null,
): Promise<void> {
  if (!selfPubkey) {
    useUnreadNotesStore.getState().setCount(0);
    return;
  }
  const since = await getNotesLastViewedAt(exec);
  // Never visited the list yet — treat everything as already seen rather than
  // flooding a first-run user with a badge for their whole history.
  if (since == null) {
    useUnreadNotesStore.getState().setCount(0);
    return;
  }
  const rows = await exec.query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM note
      WHERE created_at > ?
        AND author_pubkey != ?
        AND deleted_at IS NULL`,
    [since, selfPubkey],
  );
  useUnreadNotesStore.getState().setCount(rows[0]?.n ?? 0);
}
