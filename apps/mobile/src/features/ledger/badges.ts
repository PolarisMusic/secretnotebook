import type { SqlExecutor } from '../../db/executor';
import { getAppSetting, setAppSetting } from '../settings/store';

/**
 * Connection milestone badges, keyed off the couple's running Sparks total
 * (SUM of ledger_entry.delta — see sumConnectionPoints). Purely cosmetic:
 * a shared sense of progress, themed as a spark growing into a galaxy.
 *
 * To tweak the ladder, edit BADGE_MILESTONES below — names, emoji, and
 * thresholds are all here in one place. Keep it sorted ascending by
 * `threshold`; the helpers rely on that order.
 */
export interface Badge {
  /** Sparks needed to earn it. */
  readonly threshold: number;
  readonly name: string;
  readonly emoji: string;
}

export const BADGE_MILESTONES: readonly Badge[] = [
  { threshold: 100, name: 'First Spark', emoji: '✨' },
  { threshold: 500, name: 'Kindling', emoji: '🔥' },
  { threshold: 1_000, name: 'Warm Glow', emoji: '🌟' },
  { threshold: 2_000, name: 'Steady Flame', emoji: '🕯️' },
  { threshold: 5_000, name: 'Bonfire', emoji: '🔥' },
  { threshold: 10_000, name: 'Wildfire', emoji: '🌋' },
  { threshold: 25_000, name: 'Sunrise', emoji: '🌅' },
  { threshold: 50_000, name: 'Radiant', emoji: '💎' },
  { threshold: 100_000, name: 'Luminary', emoji: '💫' },
  { threshold: 250_000, name: 'Shooting Star', emoji: '🌠' },
  { threshold: 500_000, name: 'Constellation', emoji: '🌌' },
  { threshold: 1_000_000, name: 'Galaxy', emoji: '🪐' },
  { threshold: 2_000_000, name: 'Supernova', emoji: '🌟' },
  { threshold: 5_000_000, name: 'Eternal Flame', emoji: '♾️' },
];

/** Badges earned at `totalPoints`, ascending. */
export function earnedBadges(totalPoints: number): readonly Badge[] {
  return BADGE_MILESTONES.filter((b) => totalPoints >= b.threshold);
}

/** The next badge still to earn, or null once every badge is earned. */
export function nextBadge(totalPoints: number): Badge | null {
  return BADGE_MILESTONES.find((b) => totalPoints < b.threshold) ?? null;
}

/** The highest badge earned so far, or null below the first threshold. */
export function highestBadge(totalPoints: number): Badge | null {
  const earned = earnedBadges(totalPoints);
  return earned.length > 0 ? (earned[earned.length - 1] ?? null) : null;
}

/** app_setting key holding the highest badge threshold the user has been
 *  congratulated for — the celebration high-water mark. */
const BADGE_SEEN_KEY = 'badge_seen_threshold';

/**
 * Detect milestones crossed since the last check and advance the high-water
 * mark so each badge celebrates exactly once (even across app restarts and
 * whichever screen notices first). Returns the newly earned badges, ascending
 * — the caller decides how to celebrate (typically an alert for the highest).
 */
export async function collectNewlyEarnedBadges(
  exec: SqlExecutor,
  totalPoints: number,
): Promise<readonly Badge[]> {
  const seenRaw = await getAppSetting(exec, BADGE_SEEN_KEY);
  const seen = seenRaw != null ? Number.parseInt(seenRaw, 10) : 0;
  const seenThreshold = Number.isFinite(seen) ? seen : 0;
  const newly = BADGE_MILESTONES.filter(
    (b) => b.threshold > seenThreshold && totalPoints >= b.threshold,
  );
  const highest = highestBadge(totalPoints);
  if (highest != null && highest.threshold > seenThreshold) {
    await setAppSetting(exec, BADGE_SEEN_KEY, String(highest.threshold));
  }
  return newly;
}
