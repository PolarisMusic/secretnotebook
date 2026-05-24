import { create } from 'zustand';
import type { SyncEngine } from './sync-engine';

/**
 * Singleton holder for the active SyncEngine. Populated by runBoot once
 * the connection is paired + connection_ratchet exists, and by the pairing
 * route as soon as persistConnection + initAndSaveRatchet land. Cleared on
 * severing (Phase 2).
 *
 * Separate store from the api/db ones so re-renders are tightly
 * scoped: only the components that actually invoke flush()/pull() or
 * enqueue() subscribe to it.
 */
interface SyncEngineState {
  engine: SyncEngine | null;
  setEngine: (engine: SyncEngine | null) => void;
}

export const useSyncEngineStore = create<SyncEngineState>((set) => ({
  engine: null,
  setEngine: (engine) => set({ engine }),
}));
