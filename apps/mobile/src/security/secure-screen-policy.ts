/**
 * Pure policy for "block screenshot + screen-recording of every
 * connection-content surface."
 *
 * On Android this maps to the per-window FLAG_SECURE flag — when set on
 * the host Activity, the OS refuses screenshots, hides the window from
 * screen-recording APIs, and substitutes a black thumbnail in the
 * recents view. On iOS the OS handles recents-thumbnail blurring
 * automatically (no per-screen API to hook into), so this policy is a
 * no-op there.
 *
 * The actual platform call lives in the RN binding next door
 * (secure-screen.ts); this file is RN-free so the three branches —
 * applied / iOS no-op / no-module no-op — are unit-testable in Node.
 *
 * The native module is wired up at prebuild time per RUNBOOK.md
 * (apps/mobile/RUNBOOK.md §FLAG_SECURE). Until the module is installed
 * the JS hook gracefully degrades to a no-op so dev builds and tests
 * don't blow up.
 */
export type PlatformLike = 'ios' | 'android' | 'web' | 'macos' | 'windows' | string;

export type SecureScreenOutcome = 'applied' | 'noop:non-android' | 'noop:no-module';

export interface SecureScreenOptions {
  readonly platform: PlatformLike;
  /** The native bridge, or null when the module isn't registered. */
  readonly setFlagSecure: ((enabled: boolean) => void) | null;
}

export function applySecureScreen(
  enabled: boolean,
  opts: SecureScreenOptions,
): SecureScreenOutcome {
  if (opts.platform !== 'android') return 'noop:non-android';
  if (!opts.setFlagSecure) return 'noop:no-module';
  opts.setFlagSecure(enabled);
  return 'applied';
}
