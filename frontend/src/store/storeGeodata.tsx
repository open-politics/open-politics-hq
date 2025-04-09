import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import axios from 'axios';

interface CacheEntry {
  data: any;
  timestamp: number;
}

interface GeoDataState {
  geojsonData: any;
  eventGeojsonData: any;
  baselineGeoJsonCache: Record<string, CacheEntry>;
  eventGeoJsonCache: Record<string, CacheEntry>;
  isLoading: boolean;
  error: string | null;
  fetchBaselineGeoJson: (limit?: number, forceRefresh?: boolean) => Promise<void>;
  fetchEventGeoJson: (eventType: string, startDate?: string, endDate?: string, limit?: number, forceRefresh?: boolean) => Promise<void>;
  invalidateCache: () => void;
}

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds

const sanitizeIsoDate = (date: string | undefined) => {
  if (!date) return undefined;
  return new Date(date).toISOString().split('T')[0];
};

export const useGeoDataStore = create<GeoDataState>()(
  persist(
    (set, get) => ({
      geojsonData: null,
      eventGeojsonData: null,
      baselineGeoJsonCache: {},
      eventGeoJsonCache: {},
      isLoading: false,
      error: null,

      fetchBaselineGeoJson: async (limit = 100, forceRefresh = false) => {
        const cacheKey = `baseline_${limit}`;
        const cachedData = get().baselineGeoJsonCache[cacheKey];
        const now = Date.now();

        if (!forceRefresh && cachedData && (now - cachedData.timestamp) < CACHE_DURATION) {
          console.log('Using cached baseline GeoJSON data');
          set({ geojsonData: cachedData.data });
          return;
        }

        set({ isLoading: true, error: null });
        try {
          const response = await axios.get(`/api/geojson/baseline?limit=${limit}`);
          set({
            geojsonData: response.data,
            baselineGeoJsonCache: {
              ...get().baselineGeoJsonCache,
              [cacheKey]: { data: response.data, timestamp: now }
            },
            isLoading: false
          });
        } catch (error) {
          set({ error: 'Failed to fetch baseline GeoJSON data', isLoading: false });
        }
      },

      fetchEventGeoJson: async (eventType, startDate, endDate, limit = 100, forceRefresh = false) => {
        const sanitizedStartDate = sanitizeIsoDate(startDate);
        const sanitizedEndDate = sanitizeIsoDate(endDate);
        const cacheKey = `event_${eventType}_${sanitizedStartDate}_${sanitizedEndDate}_${limit}`;
        const cachedData = get().eventGeoJsonCache[cacheKey];
        const now = Date.now();

        if (!forceRefresh && cachedData && (now - cachedData.timestamp) < CACHE_DURATION) {
          console.log('Using cached event GeoJSON data');
          set({ eventGeojsonData: cachedData.data });
          return;
        }

        set({ isLoading: true, error: null });
        try {
          const params = new URLSearchParams({
            eventType,
            limit: limit.toString(),
            ...(sanitizedStartDate && { startDate: sanitizedStartDate }),
            ...(sanitizedEndDate && { endDate: sanitizedEndDate })
          });

          const response = await axios.get(`/api/geojson/events?${params.toString()}`);
          set({
            eventGeojsonData: response.data,
            eventGeoJsonCache: {
              ...get().eventGeoJsonCache,
              [cacheKey]: { data: response.data, timestamp: now }
            },
            isLoading: false
          });
        } catch (error) {
          set({ error: 'Failed to fetch event GeoJSON data', isLoading: false });
        }
      },

      invalidateCache: () => {
        set({
          baselineGeoJsonCache: {},
          eventGeoJsonCache: {}
        });
      }
    }),
    {
      name: 'geodata-storage',
      partialize: (state) => ({
        baselineGeoJsonCache: state.baselineGeoJsonCache,
        eventGeoJsonCache: state.eventGeoJsonCache
      })
    }
  )
); 