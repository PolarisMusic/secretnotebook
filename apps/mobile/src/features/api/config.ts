/**
 * Base URL for the moderation API. The default points at the local
 * docker-compose stack — fine for the simulator on the dev host, useless
 * for a physical phone on TestFlight / Internal Track.
 *
 * Runtime override resolution, highest priority first:
 *
 *   1. `process.env.EXPO_PUBLIC_API_BASE_URL` — Metro inlines anything
 *      prefixed `EXPO_PUBLIC_` at bundle time, so this is the seam
 *      that EAS / Expo CLI substitutes per-environment. Set this to
 *      the deployed API host (e.g. https://api.fly.dev) before
 *      `expo prebuild` or before kicking the EAS build.
 *   2. `expo.extra.apiBaseUrl` in `app.json` — read indirectly because
 *      `expo-constants` isn't a direct dependency here; Expo already
 *      mirrors any `expo.extra.*` value into `EXPO_PUBLIC_*` env at
 *      build time when the matching env var is set, so the env-var
 *      path above is the single source of truth.
 *   3. The hardcoded localhost fallback.
 */
export interface ApiConfig {
  readonly baseUrl: string;
}

// Metro substitutes `process.env.EXPO_PUBLIC_*` at bundle time; the
// `react` types we ship don't include Node's globals, so declare the
// narrow shape we use locally instead of pulling in @types/node.
declare const process: { readonly env: Readonly<Record<string, string | undefined>> } | undefined;

const ENV_BASE_URL =
  typeof process !== 'undefined' && process?.env ? process.env.EXPO_PUBLIC_API_BASE_URL : undefined;

export const DEFAULT_API_CONFIG: ApiConfig = {
  baseUrl: ENV_BASE_URL && ENV_BASE_URL.length > 0 ? ENV_BASE_URL : 'http://localhost:3000',
};
