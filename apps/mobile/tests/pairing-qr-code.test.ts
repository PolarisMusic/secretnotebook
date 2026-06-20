import { describe, expect, it } from '@jest/globals';
import { formatRendezvousCode, generateRendezvousCode } from '@secretnotebook/crypto';

import {
  encodePairingQr,
  parsePairingQr,
  PAIRING_QR_SCHEME,
} from '../src/features/pairing/qr-code';

describe('pairing QR code', () => {
  it('round-trips a freshly generated rendezvous code', async () => {
    const code = await generateRendezvousCode();
    const payload = encodePairingQr(code);
    expect(payload.startsWith(`${PAIRING_QR_SCHEME}://pair?code=`)).toBe(true);
    expect(parsePairingQr(payload)).toBe(code);
  });

  it('parses our scheme back to the canonical code', () => {
    expect(parsePairingQr('secretnotebook://pair?code=k7qh92rt')).toBe('k7qh92rt');
  });

  it('reads the code param among others', () => {
    expect(parsePairingQr('secretnotebook://pair?x=1&code=k7qh92rt&y=2')).toBe('k7qh92rt');
  });

  it('normalizes an uppercase / dash-grouped code carried in the scheme', () => {
    const payload = `secretnotebook://pair?code=${encodeURIComponent(formatRendezvousCode('k7qh92rt'))}`;
    expect(parsePairingQr(payload)).toBe('k7qh92rt');
  });

  it('ignores surrounding whitespace', () => {
    expect(parsePairingQr('  secretnotebook://pair?code=k7qh92rt  ')).toBe('k7qh92rt');
  });

  it('returns null for arbitrary, non-pairing QRs', () => {
    expect(parsePairingQr('https://example.com/foo')).toBeNull();
    expect(parsePairingQr('hello world')).toBeNull(); // would normalize to a "valid" code without the scheme guard
    expect(parsePairingQr('WIFI:S:home;P:secret;;')).toBeNull();
  });

  it('returns null when our scheme carries an invalid or missing code', () => {
    expect(parsePairingQr('secretnotebook://pair?code=ab')).toBeNull(); // too short
    expect(parsePairingQr('secretnotebook://pair?code=')).toBeNull();
    expect(parsePairingQr('secretnotebook://pair?nope=k7qh92rt')).toBeNull();
  });
});
