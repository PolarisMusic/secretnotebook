/**
 * Build-time flag that flips the IAP entitlement gate into "always
 * granted" mode for internal tester distribution. MUST be unset (or
 * "0") in any build that ships to external testers / production —
 * with it on, the publish gate degenerates to no-op, which is the
 * opposite of the R5 promise.
 *
 * Read at module load. Metro inlines `EXPO_PUBLIC_*` env vars at
 * bundle time, so a different value can't be smuggled in by a
 * runtime-loaded module.
 */
// Metro substitutes `process.env.EXPO_PUBLIC_*` at bundle time; the
// `react` types we ship don't include Node's globals, so declare the
// narrow shape we use locally instead of pulling in @types/node.
declare const process: { readonly env: Readonly<Record<string, string | undefined>> } | undefined;

export const DEV_GRANT_ENTITLEMENT =
  typeof process !== 'undefined' && process?.env?.EXPO_PUBLIC_DEV_GRANT_ENTITLEMENT === '1';
