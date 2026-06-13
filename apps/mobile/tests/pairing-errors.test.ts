import { describe, expect, it } from '@jest/globals';

import { friendlyPairingError } from '../src/features/pairing/errors';

describe('friendlyPairingError', () => {
  it('maps the relay 404 (server missing the route / updating)', () => {
    expect(friendlyPairingError('pair rendezvous POST failed: 404')).toMatch(/pairing server/i);
    expect(friendlyPairingError('pair rendezvous POST failed: 404')).toMatch(/updating/i);
  });

  it('maps the relay 409 (code already used by another pairing)', () => {
    expect(friendlyPairingError('pair rendezvous POST failed: 409')).toMatch(/already used/i);
  });

  it('maps the relay 429 (rate limited)', () => {
    expect(friendlyPairingError('pair rendezvous POST failed: 429')).toMatch(/too many/i);
  });

  it('maps other relay HTTP failures to a generic server message', () => {
    expect(friendlyPairingError('pair rendezvous POST failed: 500')).toMatch(/pairing server/i);
  });

  it('maps the relay timeout', () => {
    const msg = friendlyPairingError('pairing timed out — ask your partner to retry the same code');
    expect(msg).toMatch(/in time/i);
  });

  it('maps a raw network failure', () => {
    expect(friendlyPairingError('Network request failed')).toMatch(/connection problem/i);
  });

  it('maps malformed / wrong pairing-message errors (bad QR)', () => {
    expect(friendlyPairingError('pairing message: unsupported version 2')).toMatch(/wasn't valid/i);
    expect(friendlyPairingError('pairing message: malformed hex')).toMatch(/wasn't valid/i);
    expect(friendlyPairingError('pairing message: unknown kind bye')).toMatch(/wasn't valid/i);
  });

  it('maps scanning your own code', () => {
    expect(friendlyPairingError('peer identity must differ from self')).toMatch(/your own code/i);
  });

  it('maps a database-not-ready error', () => {
    expect(friendlyPairingError('Database is not ready; cannot persist connection')).toMatch(
      /getting ready/i,
    );
  });

  it('falls back to a generic message for anything unrecognised', () => {
    expect(friendlyPairingError('kaboom 0xdeadbeef')).toBe(
      'Something went wrong while pairing. Please try again.',
    );
  });

  it('never echoes raw status codes or internal tokens to the user', () => {
    const out = friendlyPairingError('pair rendezvous POST failed: 404');
    expect(out).not.toMatch(/404|rendezvous|POST/);
  });
});
