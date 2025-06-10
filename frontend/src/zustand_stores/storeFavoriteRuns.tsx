import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface FavoriteRun {
  id: number;
  name: string;
  timestamp: string;
  documentCount: number;
  schemeCount: number;
  InfospaceId: string | number;
  description?: string;
}

interface FavoriteRunsState {
  favoriteRuns: FavoriteRun[];
  addFavoriteRun: (run: FavoriteRun) => void;
  removeFavoriteRun: (runId: number) => void;
  isFavorite: (runId: number) => boolean;
  getFavoriteRunsByInfospace: (InfospaceId: string | number) => FavoriteRun[];
}

export const useFavoriteRunsStore = create<FavoriteRunsState>()(
  persist(
    (set, get) => ({
      favoriteRuns: [],
      
      addFavoriteRun: (run: FavoriteRun) => {
        set((state) => {
          // Check if run already exists
          const exists = state.favoriteRuns.some(r => r.id === run.id);
          if (exists) return state;
          
          return {
            favoriteRuns: [...state.favoriteRuns, run]
          };
        });
      },
      
      removeFavoriteRun: (runId: number) => {
        set((state) => ({
          favoriteRuns: state.favoriteRuns.filter(run => run.id !== runId)
        }));
      },
      
      isFavorite: (runId: number) => {
        return get().favoriteRuns.some(run => run.id === runId);
      },
      
      getFavoriteRunsByInfospace: (InfospaceId: string | number) => {
        // Convert both to strings for comparison to handle both string and number types
        const InfospaceIdStr = String(InfospaceId);
        return get().favoriteRuns.filter(run => String(run.InfospaceId) === InfospaceIdStr);
      }
    }),
    {
      name: 'favorite-runs-storage',
    }
  )
); 