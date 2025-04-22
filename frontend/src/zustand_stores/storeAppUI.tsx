import { create } from 'zustand';

interface AppUIState {
  isClassificationDockOpen: boolean;
  isSchemeManagerOpen: boolean; // Example: Add state for scheme manager visibility
  // Add other global UI states as needed

  toggleClassificationDock: () => void;
  openClassificationDock: () => void;
  closeClassificationDock: () => void;

  toggleSchemeManager: () => void;
  openSchemeManager: () => void;
  closeSchemeManager: () => void;
}

export const useAppUIStore = create<AppUIState>((set) => ({
  // Initial state
  isClassificationDockOpen: false,
  isSchemeManagerOpen: false,

  // Actions for Classification Dock
  toggleClassificationDock: () => set((state) => ({ isClassificationDockOpen: !state.isClassificationDockOpen })),
  openClassificationDock: () => set({ isClassificationDockOpen: true }),
  closeClassificationDock: () => set({ isClassificationDockOpen: false }),

  // Actions for Scheme Manager
  toggleSchemeManager: () => set((state) => ({ isSchemeManagerOpen: !state.isSchemeManagerOpen })),
  openSchemeManager: () => set({ isSchemeManagerOpen: true }),
  closeSchemeManager: () => set({ isSchemeManagerOpen: false }),
})); 