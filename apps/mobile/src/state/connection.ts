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
  setStatus: (status: ConnectionStatus) => void;
  setConnectionId: (id: string | null) => void;
  setPendingRootKey: (rootKey: Uint8Array | null) => void;
  /** Convenience: snapshot the pairing handshake result. */
  completePairing: (args: { connectionId: string; rootKey: Uint8Array }) => void;
  /** Convenience: clear the ephemeral pending material after Safe Word setup. */
  finalizePairing: () => void;
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  status: 'unpaired',
  connectionId: null,
  pendingRootKey: null,
  setStatus: (status) => set({ status }),
  setConnectionId: (connectionId) => set({ connectionId }),
  setPendingRootKey: (pendingRootKey) => set({ pendingRootKey }),
  completePairing: ({ connectionId, rootKey }) =>
    set({ status: 'awaiting_safeword', connectionId, pendingRootKey: rootKey }),
  finalizePairing: () => set({ status: 'paired', pendingRootKey: null }),
}));
