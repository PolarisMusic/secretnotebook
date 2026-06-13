import { getSodium } from './sodium.js';

/**
 * Rendezvous codes for the long-distance ("we're apart") pairing path.
 *
 * The relay rendezvous (apps/api/src/routes/pair-rendezvous.ts) pairs the
 * two devices that post a hello under the same code. The original UX let
 * BOTH partners type a code they agreed on out loud, which meant the code
 * space was whatever humans pick — and humans overwhelmingly pick the same
 * handful of phrases ("iloveyou", "password", a shared pet name). Two
 * unrelated couples reaching for "iloveyou" inside the same 10-minute TTL
 * window would cross-pair through the relay.
 *
 * The fix is to take code invention away from users entirely: one device
 * GENERATES a high-entropy code and the other ENTERS it. These helpers back
 * that flow.
 *
 *   - `generateRendezvousCode()` draws an 8-char code from a 31-symbol
 *     alphabet using libsodium's CSPRNG. 31^8 ≈ 8.5e11 possibilities; with a
 *     10-minute TTL and a handful of simultaneous pairings, an accidental
 *     collision is ~1 in 10^12 rather than near-certain.
 *   - `formatRendezvousCode()` renders the canonical code for a human to
 *     read or dictate (uppercase, dash-grouped: "K7QH-92RT").
 *   - `normalizeRendezvousCode()` turns whatever the joiner types — with or
 *     without the dash, any case, stray spaces — back into the canonical
 *     wire form so both devices post under byte-identical codes.
 *
 * Canonical (wire) form is lowercase alphanumeric, no separators. It is a
 * strict subset of the server's `[a-z0-9-]{6,16}` route regex.
 */

/**
 * Crockford-style alphabet with the visually ambiguous glyphs removed:
 * no `i`/`l`/`o` (confusable with `1`/`1`/`0`) and no `0`/`1`. 31 symbols.
 */
export const RENDEZVOUS_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export const RENDEZVOUS_CODE_LENGTH = 8;

/** Canonical (post-normalize) wire form: lowercase alphanumeric, 6–16 chars. */
export const RENDEZVOUS_CODE_RE = /^[a-z0-9]{6,16}$/;

/**
 * Generate a fresh rendezvous code in canonical wire form.
 *
 * Uses rejection sampling over libsodium random bytes so the distribution
 * across the alphabet is uniform (plain `byte % 31` would bias the first
 * eight symbols). `randombytes_buf` is the same CSPRNG the rest of the
 * package relies on, so this works identically on Node and React Native.
 */
export async function generateRendezvousCode(
  length: number = RENDEZVOUS_CODE_LENGTH,
): Promise<string> {
  if (length < 1) throw new Error('rendezvous code length must be positive');
  const sodium = await getSodium();
  const alphabet = RENDEZVOUS_ALPHABET;
  const n = alphabet.length;
  // Largest multiple of n that fits in a byte; bytes at or above it are
  // rejected so the modulo below stays unbiased.
  const ceiling = 256 - (256 % n);

  let out = '';
  while (out.length < length) {
    // Draw a little extra to amortise rejections without re-entering sodium.
    const buf = sodium.randombytes_buf((length - out.length) * 2);
    for (let i = 0; i < buf.length && out.length < length; i++) {
      const b = buf[i] as number;
      if (b < ceiling) out += alphabet[b % n];
    }
  }
  return out;
}

/**
 * Collapse arbitrary user input into the canonical wire form: NFKC-folded,
 * lowercased, with everything outside `[a-z0-9]` (dashes, spaces, the
 * occasional pasted newline) stripped. The result is what both devices POST
 * to the relay; callers should validate it with {@link isValidRendezvousCode}.
 */
export function normalizeRendezvousCode(input: string): string {
  return input
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** True iff `code` is already in valid canonical wire form. */
export function isValidRendezvousCode(code: string): boolean {
  return RENDEZVOUS_CODE_RE.test(code);
}

/**
 * Human-facing rendering of a code: uppercased and grouped into blocks of
 * four for easy dictation ("K7QH-92RT"). Accepts canonical or raw input.
 */
export function formatRendezvousCode(code: string, groupSize = 4): string {
  const clean = normalizeRendezvousCode(code).toUpperCase();
  if (groupSize < 1) return clean;
  const groups: string[] = [];
  for (let i = 0; i < clean.length; i += groupSize) {
    groups.push(clean.slice(i, i + groupSize));
  }
  return groups.join('-');
}
