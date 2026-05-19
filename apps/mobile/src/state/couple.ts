import { create } from 'zustand';

/**
 * Couple pairing status, mirrored from the local `couple` row.
 *  - unpaired:         no couple row yet
 *  - awaiting_safeword: pairing handshake done; both partners still need to
 *                       jointly define the Safe Word
 *  - paired:           handshake + Safe Word complete; normal use
 *  - severed:          severing has been confirmed by both; data wiped
 */
export type CoupleStatus = 'unpaired' | 'awaiting_safeword' | 'paired' | 'severed';

interface CoupleState {
  status: CoupleStatus;
  setStatus: (status: CoupleStatus) => void;
}

export const useCoupleStore = create<CoupleState>((set) => ({
  status: 'unpaired',
  setStatus: (status) => set({ status }),
}));
