import { create } from 'zustand';

/**
 * The Content Explorer's current AQL query, mirrored here so the HQ operator can read
 * it (via the focus context) — to search into the query bar when the explorer is open
 * and to turn the current results into a bundle. Written by `AssetExplorer`; only
 * meaningful while the explorer is the open surface.
 */
interface ExploreState {
  query: string;
  setQuery: (query: string) => void;
}

export const useExploreState = create<ExploreState>((set) => ({
  query: '',
  setQuery: (query) => set({ query }),
}));
