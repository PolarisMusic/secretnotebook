/**
 * Build-time flag that permits pairing a device with ITSELF (same identity
 * key) — i.e. self-pairing for single-device testing. Off by default; the
 * pairing handshake refuses a peer whose identity pubkey equals our own
 * unless this is set. Turn it on with EXPO_PUBLIC_ALLOW_SELF_PAIR=1 in a
 * test build.
 *
 * Read at module load. Metro inlines `EXPO_PUBLIC_*` env vars at bundle
 * time, so a runtime-loaded module can't smuggle a different value in.
 * Mirrors iap/config.ts's DEV_GRANT_ENTITLEMENT pattern.
 */
// The `react` types we ship don't include Node's globals; declare the
// narrow shape we use locally instead of pulling in @types/node.
declare const process: { readonly env: Readonly<Record<string, string | undefined>> } | undefined;

export const ALLOW_SELF_PAIR =
  typeof process !== 'undefined' && process?.env?.EXPO_PUBLIC_ALLOW_SELF_PAIR === '1';
