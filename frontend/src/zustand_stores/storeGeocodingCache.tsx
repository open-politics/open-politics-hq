// Create new file: frontend/src/zustand_stores/storeGeocodingCache.ts

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { MapPoint } from '@/components/collection/workspaces/classifications/ClassificationResultsMap'; // Adjust path if needed

interface GeocodingCacheEntry {
  points: MapPoint[];
  timestamp: number;
}

interface GeocodingCacheState {
  // Cache maps a unique key (e.g., 'workspaceId-runId' or 'workspaceId-resultsHash') to cached data
  cache: Record<string, GeocodingCacheEntry>;
  // Cache expiration time in milliseconds (e.g., 1 hour)
  cacheDuration: number;

  // Actions
  getCache: (key: string) => MapPoint[] | null;
  setCache: (key: string, points: MapPoint[]) => void;
  clearCache: () => void; // Optional: Action to clear the entire cache
  setCacheDuration: (durationMs: number) => void; // Optional: Allow setting duration
}

export const useGeocodingCacheStore = create<GeocodingCacheState>()(
  // Persist allows saving the cache to localStorage/sessionStorage
  persist(
    (set, get) => ({
      cache: {},
      cacheDuration: 60 * 60 * 1000, // Default to 1 hour

      getCache: (key) => {
        const { cache, cacheDuration } = get();
        const entry = cache[key];

        if (entry && (Date.now() - entry.timestamp < cacheDuration)) {
          console.log(`[Geocoding Cache] HIT for key: ${key}`);
          return entry.points;
        }

        console.log(`[Geocoding Cache] MISS for key: ${key}`);
        // Optionally remove expired entry
        if (entry) {
            set((state) => {
                const newCache = { ...state.cache };
                delete newCache[key];
                return { cache: newCache };
            });
        }
        return null;
      },

      setCache: (key, points) => {
        console.log(`[Geocoding Cache] SET for key: ${key}, points: ${points.length}`);
        set((state) => ({
          cache: {
            ...state.cache,
            [key]: {
              points,
              timestamp: Date.now(),
            },
          },
        }));
      },

      clearCache: () => {
        console.log('[Geocoding Cache] CLEAR');
        set({ cache: {} });
      },

      setCacheDuration: (durationMs) => {
        set({ cacheDuration: durationMs });
      }
    }),
    {
      name: 'geocoding-cache-storage', // Name of the item in storage
      storage: createJSONStorage(() => sessionStorage), // Use sessionStorage to clear cache on browser close, or localStorage for longer persistence
      partialize: (state) => ({ cache: state.cache, cacheDuration: state.cacheDuration }), // Only persist cache and duration
    }
  )
);