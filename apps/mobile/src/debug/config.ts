// Metro inlines EXPO_PUBLIC_* at bundle time. See features/iap/config.ts
// for the same pattern.
declare const process: { readonly env: Readonly<Record<string, string | undefined>> } | undefined;

/**
 * Show the always-on debug overlay during onboarding / boot. Tester-build
 * only — leave OFF for any external distribution. Read at module load
 * so the value is locked in for the session.
 */
export const DEBUG_OVERLAY_ENABLED =
  typeof process !== 'undefined' && process?.env?.EXPO_PUBLIC_DEBUG_OVERLAY === '1';
