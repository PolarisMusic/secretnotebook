/**
 * Base URL for the moderation API. Override via Expo `extra` at runtime;
 * default points at the local docker-compose stack.
 */
export interface ApiConfig {
  readonly baseUrl: string;
}

export const DEFAULT_API_CONFIG: ApiConfig = {
  baseUrl: 'http://localhost:3000',
};
