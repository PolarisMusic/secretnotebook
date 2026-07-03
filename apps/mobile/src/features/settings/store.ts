import type { SqlExecutor } from '../../db/executor';

/**
 * Device-local key/value settings (the `app_setting` table from migration
 * 010). These are UI preferences that never sync to the partner — e.g. the
 * one-time intro "seen" flag now, and media-hidden / points-display toggles
 * in later phases.
 */

export const INTRO_SEEN_KEY = 'intro_seen';

/** Unix-seconds the user last looked at the notes list. Notes created after
 *  it (that aren't the user's own) render with a "new" marker. */
export const NOTES_LAST_VIEWED_KEY = 'notes_last_viewed_at';

export async function getAppSetting(exec: SqlExecutor, key: string): Promise<string | null> {
  const rows = await exec.query<{ value: string }>('SELECT value FROM app_setting WHERE key = ?', [
    key,
  ]);
  return rows[0]?.value ?? null;
}

export async function setAppSetting(exec: SqlExecutor, key: string, value: string): Promise<void> {
  await exec.execute(
    `INSERT INTO app_setting (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

/** Read the notes last-viewed watermark (Unix seconds), or null if never set. */
export async function getNotesLastViewedAt(exec: SqlExecutor): Promise<number | null> {
  const raw = await getAppSetting(exec, NOTES_LAST_VIEWED_KEY);
  if (raw == null) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

/** Stamp the notes last-viewed watermark to `secs` (Unix seconds). */
export async function setNotesLastViewedAt(exec: SqlExecutor, secs: number): Promise<void> {
  await setAppSetting(exec, NOTES_LAST_VIEWED_KEY, String(Math.floor(secs)));
}
