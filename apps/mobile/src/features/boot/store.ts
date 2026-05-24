import { create } from 'zustand';

/**
 * Boot phase, surfaced to the top-level App component so it can render a
 * splash / error UI before the navigator mounts. In-memory only.
 *   - idle      : before runBoot() is called (e.g. initial render)
 *   - running   : pipeline in flight (keychain → SQLCipher → migrations)
 *   - ready     : DatabaseStore + ConnectionStore populated, safe to render
 *                 the navigator
 *   - error     : any step rejected; the BootScreen shows the message and
 *                 a Retry button
 */
export type BootPhase = 'idle' | 'running' | 'ready' | 'error';

interface BootState {
  phase: BootPhase;
  error: string | null;
  start: () => void;
  succeed: () => void;
  fail: (message: string) => void;
  reset: () => void;
}

export const useBootStore = create<BootState>((set) => ({
  phase: 'idle',
  error: null,
  start: () => set({ phase: 'running', error: null }),
  succeed: () => set({ phase: 'ready', error: null }),
  fail: (message) => set({ phase: 'error', error: message }),
  reset: () => set({ phase: 'idle', error: null }),
}));
