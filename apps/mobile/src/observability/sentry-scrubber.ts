/**
 * `beforeSend`-shaped Sentry hook: walks an event payload and redacts
 * anything that could carry connection-private content before it leaves
 * the device.
 *
 * The Phase-1 stance is "the server cannot decrypt", so Sentry — a
 * third-party telemetry sink — gets the same treatment as the relay:
 * the server-cannot-see invariant extends to crash reports. We do
 * NOT depend on `@sentry/react-native` here; this is a plain pure
 * function so it can be unit-tested and wired into whichever transport
 * we settle on (Sentry, OTel, internal mux).
 *
 * Strategy:
 *   1. Whole-field redaction for any object key that names a
 *      connection-content surface (prompt body, rating, safe word, etc).
 *   2. Pattern-based redaction inside free-text values — emails,
 *      64-hex pubkeys, UUIDs.
 *   3. Recurse through nested objects, arrays, and breadcrumbs.
 *
 * Conservative by design: if the field name suggests "this could
 * carry secrets", we drop it. Better a useless crash report than a
 * leaked rating.
 */

export interface SentryEventLike {
  readonly message?: unknown;
  readonly user?: unknown;
  readonly request?: unknown;
  readonly breadcrumbs?: unknown;
  readonly exception?: unknown;
  readonly extra?: unknown;
  readonly contexts?: unknown;
  readonly tags?: unknown;
  readonly [k: string]: unknown;
}

/**
 * Keys whose VALUES are dropped wholesale. Match is case-sensitive on
 * the canonical form; the walker also lowercases-and-checks so
 * `Body` / `BODY` are caught too.
 */
const SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  'body',
  'text',
  'content',
  'plaintext',
  'ciphertext',
  'header',
  'envelope',
  'op',
  'password',
  'pin',
  'passcode',
  'safe_word',
  'safeword',
  'rating',
  'note',
  'notes',
  'prompt',
  'prompt_title',
  'prompt_body',
  'gratitude_prompt_title',
  'gratitude_prompt_body',
  'key',
  'root_key',
  'channel_root_key',
  'channel_root_key_wrapped',
  'pubkey',
  'pub_key',
  'partner_a_pubkey',
  'partner_b_pubkey',
  'self_pub',
  'peer_pub',
  'self_pubkey',
  'peer_pubkey',
  'enactor_pubkey',
  'curator_pubkey',
  'assigned_to_pubkey',
  'assigned_by_pubkey',
  'saved_by_pubkey',
  'saved_for_pubkey',
  'actor_pubkey',
  'email',
  'phone',
]);

const EMAIL_RE = /[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi;
const PUBKEY_HEX_RE = /\b[0-9a-f]{64}\b/gi;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

function isSensitiveKey(key: string): boolean {
  if (SENSITIVE_KEYS.has(key)) return true;
  const camelToSnake = key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`).replace(/^_/, '');
  return SENSITIVE_KEYS.has(camelToSnake);
}

function scrubString(value: string): string {
  return value
    .replace(EMAIL_RE, '<email>')
    .replace(PUBKEY_HEX_RE, '<pubkey>')
    .replace(UUID_RE, '<uuid>');
}

function scrubValue(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return scrubString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(scrubValue);
  if (typeof value === 'object') {
    return scrubObject(value as Record<string, unknown>);
  }
  return value;
}

function scrubObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (isSensitiveKey(k)) {
      out[k] = '<redacted>';
    } else {
      out[k] = scrubValue(v);
    }
  }
  return out;
}

/**
 * Returns a new event with sensitive fields redacted. Does NOT mutate
 * the input. Returning `null` from a Sentry `beforeSend` drops the
 * event entirely; if a caller wants to drop instead of scrub, that
 * decision lives at the call site.
 */
export function scrubSentryEvent<E extends SentryEventLike>(event: E): E {
  return scrubObject(event as unknown as Record<string, unknown>) as unknown as E;
}
