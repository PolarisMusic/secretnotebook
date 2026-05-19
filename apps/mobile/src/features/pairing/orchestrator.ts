import { deriveRootKey, pairingCode } from '@secretnotebook/crypto';
import type { PairingTransport } from '@secretnotebook/couple-protocol';

import type { PairingEvent, PairingState, SelfKeys } from './state-machine';
import { INITIAL_STATE, pairingReducer } from './state-machine';

/**
 * Orchestrates the pairing handshake by wiring the pure reducer to the
 * transport and to the crypto package. Side effects performed here:
 *   - transport.start / send / stop
 *   - reading PEER_FOUND from incoming `hello` messages
 *   - computing the 6-digit pairing code
 *   - calling deriveRootKey once both sides have biometric-confirmed
 *
 * Biometric confirmation is *requested* by the orchestrator emitting a
 * callback; the screen is responsible for invoking
 * expo-local-authentication and dispatching BIOMETRIC_PASSED /
 * BIOMETRIC_FAILED. This keeps the orchestrator runnable in Node tests
 * with a fake biometric prompt.
 */
export interface PairingHooks {
  /** Called when the pairing code is ready to show. Resolve with `true`
   *  to accept (biometric/manual confirmation passed), `false` to reject. */
  confirmCode(code: string): Promise<boolean>;
}

export interface OrchestratorOptions {
  readonly transport: PairingTransport;
  readonly hooks: PairingHooks;
  readonly selfKeys: SelfKeys;
  /** Test-only hook: invoked after every reducer transition. */
  readonly onTransition?: (state: PairingState, event: PairingEvent) => void;
}

export interface PairingRun {
  readonly result: Promise<PairingState>;
  cancel(): void;
}

export function runPairing(opts: OrchestratorOptions): PairingRun {
  let state: PairingState = INITIAL_STATE;
  let resolved = false;
  let resolveResult!: (s: PairingState) => void;
  const result = new Promise<PairingState>((resolve) => {
    resolveResult = resolve;
  });

  const unsubMsg = opts.transport.onMessage((msg) => {
    // The only message we accept in S1 is `hello`.
    void pairingCode(opts.selfKeys.identityPub, msg.identityPub).then((code) => {
      dispatch({
        type: 'PEER_FOUND',
        peerKeys: { identityPub: msg.identityPub, ephemeralPub: msg.ephemeralPub },
        code,
      });
    });
  });

  const unsubErr = opts.transport.onError((err) => {
    dispatch({ type: 'TRANSPORT_ERROR', reason: err.message });
  });

  function finish(final: PairingState): void {
    if (resolved) return;
    resolved = true;
    unsubMsg();
    unsubErr();
    resolveResult(final);
  }

  function dispatch(event: PairingEvent): void {
    const next = pairingReducer(state, event);
    if (next === state) return;
    state = next;
    opts.onTransition?.(state, event);

    if (state.name === 'code_shown') {
      // Confirm the code (biometric on device; promise in tests). A `false`
      // result is treated as a user-initiated cancel: spec says
      // "if mismatch, restart" — that's CANCEL → idle in our reducer.
      void opts.hooks
        .confirmCode(state.code)
        .then((ok) => dispatch(ok ? { type: 'CODE_CONFIRMED' } : { type: 'CANCEL' }))
        .catch((e) =>
          dispatch({ type: 'TRANSPORT_ERROR', reason: (e as Error).message ?? 'confirm failed' }),
        );
    } else if (state.name === 'biometric') {
      dispatch({ type: 'BIOMETRIC_PASSED' });
    } else if (state.name === 'handshake') {
      void deriveRootKey({
        selfIdentityPrivate: opts.selfKeys.identityPriv,
        selfEphemeralPrivate: opts.selfKeys.ephemeralPriv,
        selfIdentityPublic: opts.selfKeys.identityPub,
        peerIdentityPublic: state.peerKeys.identityPub,
        peerEphemeralPublic: state.peerKeys.ephemeralPub,
      })
        .then((rootKey) => dispatch({ type: 'HANDSHAKE_DONE', rootKey }))
        .catch((e) =>
          dispatch({ type: 'TRANSPORT_ERROR', reason: (e as Error).message ?? 'handshake failed' }),
        );
    } else if (
      state.name === 'safeword_required' ||
      state.name === 'idle' ||
      state.name === 'error'
    ) {
      // Terminal for S1 (idle and error from CANCEL / TRANSPORT_ERROR;
      // safeword_required when the happy path completes).
      if (event.type !== 'START_PAIRING') finish(state);
    }
  }

  // Boot the run: enter scanning and announce our hello.
  void (async () => {
    try {
      await opts.transport.start();
      dispatch({ type: 'START_PAIRING', selfKeys: opts.selfKeys });
      await opts.transport.send({
        kind: 'hello',
        identityPub: opts.selfKeys.identityPub,
        ephemeralPub: opts.selfKeys.ephemeralPub,
      });
    } catch (e) {
      dispatch({ type: 'TRANSPORT_ERROR', reason: (e as Error).message ?? 'transport failed' });
    }
  })();

  return {
    result,
    cancel() {
      dispatch({ type: 'CANCEL' });
    },
  };
}
