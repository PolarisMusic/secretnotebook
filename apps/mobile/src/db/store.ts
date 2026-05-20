import { create } from 'zustand';

import type { SqlExecutor } from './executor';

/**
 * Singleton holder for the open SqlExecutor. Set once at app start after
 * the biometric unlock → device_master → SQLCipher-key chain runs, then
 * consumed by feature routes that need to read/write the local DB.
 *
 * Lives in its own store (rather than on the couple store) so that
 * navigation logic can stay tied to couple.status without taking a hard
 * dependency on whether the DB happens to be open yet.
 */
interface DatabaseState {
  exec: SqlExecutor | null;
  setExec: (exec: SqlExecutor | null) => void;
}

export const useDatabaseStore = create<DatabaseState>((set) => ({
  exec: null,
  setExec: (exec) => set({ exec }),
}));
