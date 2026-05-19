/**
 * Pairing state machine — typed reducer.
 *
 * Documented in implementation-details S1:
 *   idle → scanning → code_shown → biometric → handshake → safeword_required
 *
 * Plus two terminal-ish failure paths:
 *   - cancel from any non-terminal state returns to idle
 *   - biometric mismatch returns to idle (the spec says "if mismatch,
 *     restart")
 *   - any transport error transitions to `error` carrying the reason
 *
 * The reducer is a pure function; side effects (transport.start, biometric
 * prompt, X3DH derivation) live in a separate orchestrator so the reducer
 * can be exercised exhaustively from unit tests without mocks.
 */
export interface SelfKeys {
  readonly identityPub: Uint8Array;
  readonly identityPriv: Uint8Array;
  readonly ephemeralPub: Uint8Array;
  readonly ephemeralPriv: Uint8Array;
}

export interface PeerKeys {
  readonly identityPub: Uint8Array;
  readonly ephemeralPub: Uint8Array;
}

export type PairingState =
  | { readonly name: 'idle' }
  | { readonly name: 'scanning'; readonly selfKeys: SelfKeys }
  | {
      readonly name: 'code_shown';
      readonly selfKeys: SelfKeys;
      readonly peerKeys: PeerKeys;
      readonly code: string;
    }
  | {
      readonly name: 'biometric';
      readonly selfKeys: SelfKeys;
      readonly peerKeys: PeerKeys;
      readonly code: string;
    }
  | {
      readonly name: 'handshake';
      readonly selfKeys: SelfKeys;
      readonly peerKeys: PeerKeys;
      readonly code: string;
    }
  | {
      readonly name: 'safeword_required';
      readonly selfKeys: SelfKeys;
      readonly peerKeys: PeerKeys;
      readonly rootKey: Uint8Array;
    }
  | { readonly name: 'error'; readonly reason: string };

export type PairingEvent =
  | { readonly type: 'START_PAIRING'; readonly selfKeys: SelfKeys }
  | { readonly type: 'PEER_FOUND'; readonly peerKeys: PeerKeys; readonly code: string }
  | { readonly type: 'CODE_CONFIRMED' }
  | { readonly type: 'BIOMETRIC_PASSED' }
  | { readonly type: 'BIOMETRIC_FAILED' }
  | { readonly type: 'HANDSHAKE_DONE'; readonly rootKey: Uint8Array }
  | { readonly type: 'CANCEL' }
  | { readonly type: 'TRANSPORT_ERROR'; readonly reason: string };

export const INITIAL_STATE: PairingState = { name: 'idle' };

export function pairingReducer(state: PairingState, event: PairingEvent): PairingState {
  // CANCEL from any non-terminal state returns to idle. The three terminal
  // states (idle, safeword_required, error) absorb it.
  if (
    event.type === 'CANCEL' &&
    state.name !== 'idle' &&
    state.name !== 'safeword_required' &&
    state.name !== 'error'
  ) {
    return INITIAL_STATE;
  }

  // TRANSPORT_ERROR from anywhere lands in error. The orchestrator is
  // responsible for stopping the transport before re-issuing START_PAIRING.
  if (event.type === 'TRANSPORT_ERROR') {
    return { name: 'error', reason: event.reason };
  }

  switch (state.name) {
    case 'idle':
      if (event.type === 'START_PAIRING') {
        return { name: 'scanning', selfKeys: event.selfKeys };
      }
      return state;

    case 'scanning':
      if (event.type === 'PEER_FOUND') {
        return {
          name: 'code_shown',
          selfKeys: state.selfKeys,
          peerKeys: event.peerKeys,
          code: event.code,
        };
      }
      return state;

    case 'code_shown':
      if (event.type === 'CODE_CONFIRMED') {
        return {
          name: 'biometric',
          selfKeys: state.selfKeys,
          peerKeys: state.peerKeys,
          code: state.code,
        };
      }
      return state;

    case 'biometric':
      if (event.type === 'BIOMETRIC_PASSED') {
        return {
          name: 'handshake',
          selfKeys: state.selfKeys,
          peerKeys: state.peerKeys,
          code: state.code,
        };
      }
      if (event.type === 'BIOMETRIC_FAILED') {
        // Spec: "if mismatch, restart"
        return INITIAL_STATE;
      }
      return state;

    case 'handshake':
      if (event.type === 'HANDSHAKE_DONE') {
        return {
          name: 'safeword_required',
          selfKeys: state.selfKeys,
          peerKeys: state.peerKeys,
          rootKey: event.rootKey,
        };
      }
      return state;

    case 'safeword_required':
    case 'error':
      return state;

    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}
