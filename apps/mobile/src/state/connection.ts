import { create } from 'zustand';

/**
 * Connection pairing status, mirrored from the local `connection` row.
 *  - unpaired:         no connection row yet
 *  - awaiting_safeword: pairing handshake done; both partners still need to
 *                       jointly define the Safe Word (S2)
 *  - paired:           handshake + Safe Word complete; normal use
 *  - severed:          severing has been confirmed by both; data wiped
 */
export type ConnectionStatus = 'unpaired' | 'awaiting_safeword' | 'paired' | 'severed';

interface ConnectionState {
  status: ConnectionStatus;
  /** Persisted connection id, available once a row exists. */
  connectionId: string | null;
  /** Ephemeral material set right after pairing, kept in memory until the
   *  Safe Word is defined. Cleared on advance to `paired`. */
  pendingRootKey: Uint8Array | null;
  /** Pending-sever (R8): unix seconds the wipe is due, or null. Mirrored
   *  from the connection row on boot + after each sync so the grace banner
   *  can render a countdown without re-querying. */
  severAt: number | null;
  /** Hex pubkey of the partner who started the pending sever (the only side
   *  that may undo it), or null. */
  severInitiatedByHex: string | null;
  setStatus: (status: ConnectionStatus) => void;
  setConnectionId: (id: string | null) => void;
  setPendingRootKey: (rootKey: Uint8Array | null) => void;
  setSever: (severAt: number | null, initiatedByHex: string | null) => void;
  /** Convenience: snapshot the pairing handshake result. */
  completePairing: (args: { connectionId: string; rootKey: Uint8Array }) => void;
  /** Convenience: clear the ephemeral pending material after Safe Word setup. */
  finalizePairing: () => void;
  /** Reset to the unpaired state after a sever wipe completes. */
  resetToUnpaired: () => void;
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  status: 'unpaired',
  connectionId: null,
  pendingRootKey: null,
  severAt: null,
  severInitiatedByHex: null,
  setStatus: (status) => set({ status }),
  setConnectionId: (connectionId) => set({ connectionId }),
  setPendingRootKey: (pendingRootKey) => set({ pendingRootKey }),
  setSever: (severAt, severInitiatedByHex) => set({ severAt, severInitiatedByHex }),
  completePairing: ({ connectionId, rootKey }) =>
    // Pairing now lands directly in 'paired' (the Safe Word is no longer an
    // onboarding gate). pendingRootKey is still stashed for the upcoming
    // optional-Safe-Word flow, but it no longer gates app use.
    set({ status: 'paired', connectionId, pendingRootKey: rootKey }),
  finalizePairing: () => set({ status: 'paired', pendingRootKey: null }),
  resetToUnpaired: () =>
    set({
      status: 'unpaired',
      connectionId: null,
      pendingRootKey: null,
      severAt: null,
      severInitiatedByHex: null,
    }),
}));
