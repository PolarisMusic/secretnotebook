import { describe, expect, it } from '@jest/globals';

import type { PeerKeys, SelfKeys } from '../src/features/pairing/state-machine';
import { INITIAL_STATE, pairingReducer } from '../src/features/pairing/state-machine';

const selfKeys: SelfKeys = {
  identityPub: new Uint8Array(32).fill(1),
  identityPriv: new Uint8Array(32).fill(2),
  ephemeralPub: new Uint8Array(32).fill(3),
  ephemeralPriv: new Uint8Array(32).fill(4),
};
const peerKeys: PeerKeys = {
  identityPub: new Uint8Array(32).fill(5),
  ephemeralPub: new Uint8Array(32).fill(6),
};

describe('pairingReducer', () => {
  it('walks the happy path idle → ... → safeword_required', () => {
    let s = INITIAL_STATE;
    s = pairingReducer(s, { type: 'START_PAIRING', selfKeys });
    expect(s.name).toBe('scanning');
    s = pairingReducer(s, { type: 'PEER_FOUND', peerKeys, code: '123456' });
    expect(s.name).toBe('code_shown');
    s = pairingReducer(s, { type: 'CODE_CONFIRMED' });
    expect(s.name).toBe('biometric');
    s = pairingReducer(s, { type: 'BIOMETRIC_PASSED' });
    expect(s.name).toBe('handshake');
    s = pairingReducer(s, { type: 'HANDSHAKE_DONE', rootKey: new Uint8Array(32).fill(0xff) });
    expect(s.name).toBe('safeword_required');
    if (s.name === 'safeword_required') {
      expect(s.rootKey).toBeInstanceOf(Uint8Array);
      expect(s.rootKey.length).toBe(32);
    }
  });

  it('returns to idle when biometric fails (spec: "if mismatch, restart")', () => {
    let s = pairingReducer(INITIAL_STATE, { type: 'START_PAIRING', selfKeys });
    s = pairingReducer(s, { type: 'PEER_FOUND', peerKeys, code: '111111' });
    s = pairingReducer(s, { type: 'CODE_CONFIRMED' });
    s = pairingReducer(s, { type: 'BIOMETRIC_FAILED' });
    expect(s).toEqual(INITIAL_STATE);
  });

  it('CANCEL from any non-terminal state returns to idle', () => {
    let s = pairingReducer(INITIAL_STATE, { type: 'START_PAIRING', selfKeys });
    expect(pairingReducer(s, { type: 'CANCEL' })).toEqual(INITIAL_STATE);
    s = pairingReducer(s, { type: 'PEER_FOUND', peerKeys, code: '111111' });
    expect(pairingReducer(s, { type: 'CANCEL' })).toEqual(INITIAL_STATE);
    s = pairingReducer(s, { type: 'CODE_CONFIRMED' });
    expect(pairingReducer(s, { type: 'CANCEL' })).toEqual(INITIAL_STATE);
  });

  it('CANCEL is a no-op once paired or errored (terminal states)', () => {
    const paired = pairingReducer(
      pairingReducer(
        pairingReducer(
          pairingReducer(pairingReducer(INITIAL_STATE, { type: 'START_PAIRING', selfKeys }), {
            type: 'PEER_FOUND',
            peerKeys,
            code: 'x',
          }),
          { type: 'CODE_CONFIRMED' },
        ),
        { type: 'BIOMETRIC_PASSED' },
      ),
      { type: 'HANDSHAKE_DONE', rootKey: new Uint8Array(32) },
    );
    expect(pairingReducer(paired, { type: 'CANCEL' })).toBe(paired);

    const errored = pairingReducer(INITIAL_STATE, { type: 'TRANSPORT_ERROR', reason: 'lost' });
    expect(pairingReducer(errored, { type: 'CANCEL' })).toBe(errored);
  });

  it('TRANSPORT_ERROR from any state lands in error', () => {
    let s = pairingReducer(INITIAL_STATE, { type: 'START_PAIRING', selfKeys });
    s = pairingReducer(s, { type: 'TRANSPORT_ERROR', reason: 'radio down' });
    expect(s).toEqual({ name: 'error', reason: 'radio down' });
  });

  it('ignores out-of-order events without crashing', () => {
    expect(pairingReducer(INITIAL_STATE, { type: 'CODE_CONFIRMED' })).toEqual(INITIAL_STATE);
    expect(pairingReducer(INITIAL_STATE, { type: 'BIOMETRIC_PASSED' })).toEqual(INITIAL_STATE);
    expect(
      pairingReducer(INITIAL_STATE, { type: 'HANDSHAKE_DONE', rootKey: new Uint8Array(32) }),
    ).toEqual(INITIAL_STATE);
  });
});
