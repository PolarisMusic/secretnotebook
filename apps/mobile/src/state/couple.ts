import { create } from 'zustand';

/**
 * Couple pairing status, mirrored from the local `couple` row.
 *  - unpaired:         no couple row yet
 *  - awaiting_safeword: pairing handshake done; both partners still need to
 *                       jointly define the Safe Word (S2)
 *  - paired:           handshake + Safe Word complete; normal use
 *  - severed:          severing has been confirmed by both; data wiped
 */
export type CoupleStatus = 'unpaired' | 'awaiting_safeword' | 'paired' | 'severed';

interface CoupleState {
  status: CoupleStatus;
  /** Persisted couple id, available once a row exists. */
  coupleId: string | null;
  /** Ephemeral material set right after pairing, kept in memory until the
   *  Safe Word is defined. Cleared on advance to `paired`. */
  pendingRootKey: Uint8Array | null;
  setStatus: (status: CoupleStatus) => void;
  setCoupleId: (id: string | null) => void;
  setPendingRootKey: (rootKey: Uint8Array | null) => void;
  /** Convenience: snapshot the pairing handshake result. */
  completePairing: (args: { coupleId: string; rootKey: Uint8Array }) => void;
  /** Convenience: clear the ephemeral pending material after Safe Word setup. */
  finalizePairing: () => void;
}

export const useCoupleStore = create<CoupleState>((set) => ({
  status: 'unpaired',
  coupleId: null,
  pendingRootKey: null,
  setStatus: (status) => set({ status }),
  setCoupleId: (coupleId) => set({ coupleId }),
  setPendingRootKey: (pendingRootKey) => set({ pendingRootKey }),
  completePairing: ({ coupleId, rootKey }) =>
    set({ status: 'awaiting_safeword', coupleId, pendingRootKey: rootKey }),
  finalizePairing: () => set({ status: 'paired', pendingRootKey: null }),
}));
