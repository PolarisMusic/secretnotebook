import type { SqlExecutor } from '../../db/executor';
import type { ConnectionRole } from '../connection/role-store';
import { getAppSetting, setAppSetting } from './store';

/**
 * Device-local Couple-Points visibility (Phase 4 follow-up). Gated by the
 * viewer's connection role with a user override:
 *   - default: hidden for `feminine`, shown for `masculine` / `neutral`
 *     (and when there's no role yet);
 *   - override: once the user flips the Settings switch, their explicit
 *     choice ('1'/'0') wins over the role default.
 *
 * Stored in `app_setting` (per device; never synced). The three-state read
 * (absent ⇒ role default) is what lets the default keep tracking the role
 * until the user has an opinion.
 */
export const POINTS_VISIBLE_KEY = 'points_visible';

export function roleDefaultPointsVisible(role: ConnectionRole | null): boolean {
  return role !== 'feminine';
}

/** Effective visibility: an explicit stored choice wins; else role default. */
export async function getPointsVisible(
  exec: SqlExecutor,
  role: ConnectionRole | null,
): Promise<boolean> {
  const stored = await getAppSetting(exec, POINTS_VISIBLE_KEY);
  if (stored === '1') return true;
  if (stored === '0') return false;
  return roleDefaultPointsVisible(role);
}

export async function setPointsVisible(exec: SqlExecutor, visible: boolean): Promise<void> {
  await setAppSetting(exec, POINTS_VISIBLE_KEY, visible ? '1' : '0');
}
