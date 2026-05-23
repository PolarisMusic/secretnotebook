import { create } from 'zustand';
import type { ApiClient } from './client';

/**
 * Singleton holder for the signed ApiClient. Set once by runBoot after
 * the keychain unlock + deriveDeviceSigningKey chain. Routes pull this
 * via `useApiStore(s => s.client)`. Lives in its own store rather than
 * on the boot store so re-renders are scoped tightly.
 */
interface ApiState {
  client: ApiClient | null;
  setClient: (client: ApiClient | null) => void;
}

export const useApiStore = create<ApiState>((set) => ({
  client: null,
  setClient: (client) => set({ client }),
}));
