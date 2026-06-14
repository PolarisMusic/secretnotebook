import type { SqlExecutor } from '../../db/executor';

/**
 * Device-local key/value settings (the `app_setting` table from migration
 * 010). These are UI preferences that never sync to the partner — e.g. the
 * one-time intro "seen" flag now, and media-hidden / points-display toggles
 * in later phases.
 */

export const INTRO_SEEN_KEY = 'intro_seen';

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
