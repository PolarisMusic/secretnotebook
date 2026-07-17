import { isValidRendezvousCode, normalizeRendezvousCode } from '@secretnotebook/crypto';

/**
 * Deep links for the shared-code pairing flow. The initiator can send the
 * partner a `secretnotebook://pair?code=XXXX` link (text / Signal / email);
 * tapping it opens the app straight onto the pairing screen with the code
 * pre-filled, so nobody has to read out or retype a code.
 *
 * The link carries only the rendezvous code — a public handle, not a secret
 * (the X3DH handshake still runs on-device). Pure string helpers so they can
 * be unit-tested without the native Linking module.
 */
export const PAIR_LINK_SCHEME = 'secretnotebook';

/** Build a shareable deep link for a rendezvous `code`. */
export function buildPairLink(code: string): string {
  const normalized = normalizeRendezvousCode(code);
  return `${PAIR_LINK_SCHEME}://pair?code=${encodeURIComponent(normalized)}`;
}

/**
 * Extract a valid rendezvous code from a pairing deep link, or null if the
 * URL isn't one of ours / carries no valid code. Tolerant of casing, a
 * trailing slash before the query, and extra query params.
 */
export function parsePairLink(url: string): string | null {
  if (typeof url !== 'string') return null;
  if (!/^secretnotebook:\/\/pair\b/i.test(url.trim())) return null;
  const match = /[?&]code=([^&#]+)/i.exec(url);
  if (!match?.[1]) return null;
  let raw = match[1];
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // Leave raw as-is if it isn't valid percent-encoding.
  }
  const code = normalizeRendezvousCode(raw);
  return isValidRendezvousCode(code) ? code : null;
}
