/**
 * Base URL for the moderation / relay API (apps/api).
 *
 * Resolution, highest priority first:
 *
 *   1. `process.env.EXPO_PUBLIC_API_BASE_URL` — Metro inlines anything
 *      prefixed `EXPO_PUBLIC_` at bundle time, so this is the seam EAS /
 *      Expo CLI substitutes per-environment. Set it to
 *      `http://localhost:3000` when running the local docker-compose stack
 *      against the simulator.
 *   2. The deployed Fly.io host below — the default, so a build that ships
 *      without the env var still reaches a real server instead of localhost
 *      (a real phone can't reach localhost, which was the original
 *      "notes don't transfer" bug).
 *
 * `app.json` `expo.extra.apiBaseUrl` mirrors the default for documentation /
 * parity only; it is not read here (expo-constants isn't a dependency).
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

/** Deployed API host — used unless EXPO_PUBLIC_API_BASE_URL overrides it. */
const DEFAULT_BASE_URL = 'https://polaris-secretnotebook-api.fly.dev';

export const DEFAULT_API_CONFIG: ApiConfig = {
  baseUrl: ENV_BASE_URL && ENV_BASE_URL.length > 0 ? ENV_BASE_URL : DEFAULT_BASE_URL,
};
