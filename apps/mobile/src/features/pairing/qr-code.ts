import { isValidRendezvousCode, normalizeRendezvousCode } from '@secretnotebook/crypto';

/**
 * Pairing QR payloads. The QR no longer carries a pairing *hello* (the old
 * one-sided QrTransport); it carries the short relay rendezvous code so both
 * devices pair over the symmetric RelayTransport — one shows the QR, the
 * other scans it, and both join the same `/v1/pair/:code` rendezvous.
 *
 * A tiny custom scheme lets the scanner tell our pairing QRs apart from
 * arbitrary QR codes the camera might happen to see; anything that isn't our
 * scheme (or doesn't carry a valid code) is ignored so scanning keeps
 * looking instead of starting a doomed rendezvous on junk.
 */
export const PAIRING_QR_SCHEME = 'secretnotebook';

const PAIRING_QR_PREFIX = `${PAIRING_QR_SCHEME}://pair?`;

/**
 * Encode a rendezvous code (canonical wire form, from
 * `generateRendezvousCode`) as a scannable pairing-QR payload.
 */
export function encodePairingQr(code: string): string {
  return `${PAIRING_QR_PREFIX}code=${encodeURIComponent(code)}`;
}

/**
 * Extract a rendezvous code from a scanned QR payload, or `null` when the
 * text isn't one of our pairing QRs (or doesn't carry a valid code). The
 * returned code is canonical wire form, ready to hand to `RelayTransport`.
 */
export function parsePairingQr(text: string): string | null {
  const raw = text.trim();
  if (!raw.toLowerCase().startsWith(PAIRING_QR_PREFIX)) return null;

  let candidate: string | null = null;
  for (const part of raw.slice(PAIRING_QR_PREFIX.length).split('&')) {
    const eq = part.indexOf('=');
    if (eq === -1 || part.slice(0, eq) !== 'code') continue;
    try {
      candidate = decodeURIComponent(part.slice(eq + 1));
    } catch {
      return null; // malformed percent-encoding — not a usable code
    }
    break;
  }

  if (candidate === null) return null;
  const normalized = normalizeRendezvousCode(candidate);
  return isValidRendezvousCode(normalized) ? normalized : null;
}
