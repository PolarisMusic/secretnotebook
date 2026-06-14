import { create } from 'zustand';

/**
 * Visibility state for the app's hamburger menu. The menu itself is a
 * lightweight overlay (no react-navigation/drawer, no gesture-handler) — see
 * components/AppMenu.tsx — so this store is the single source of truth for
 * whether it's open.
 */
interface MenuState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

export const useMenuStore = create<MenuState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));
