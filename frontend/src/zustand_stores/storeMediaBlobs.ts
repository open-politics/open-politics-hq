/**
 * Media Blob Store - Centralized Blob URL Cache
 * =============================================
 * 
 * Manages blob URLs for authenticated media files (PDFs, images, videos, audio).
 * Provides:
 * - Centralized cache (shared across all components)
 * - Automatic deduplication (prevents duplicate requests)
 * - Synchronous cache lookups (instant for cached URLs)
 * - Memory management (revokes URLs when needed)
 * 
 * Performance: Eliminates duplicate requests and component re-render cascades
 */

import { create } from 'zustand';
import { useInfospaceStore } from './storeInfospace';
import { toast } from 'sonner';

interface MediaBlobState {
  // Cache: blobPath -> blob URL
  blobCache: Map<string, string>;
  
  // Loading states: blobPath -> boolean
  loadingStates: Map<string, boolean>;
  
  // Promise cache for deduplication: blobPath -> Promise
  promiseCache: Map<string, Promise<string | null>>;
  
  // Actions
  getBlobUrl: (blobPath: string) => Promise<string | null>;
  clearCache: () => void;
  revokeBlobUrl: (blobPath: string) => void;
  isLoading: (blobPath: string) => boolean;
}

export const useMediaBlobStore = create<MediaBlobState>((set, get) => ({
  blobCache: new Map(),
  loadingStates: new Map(),
  promiseCache: new Map(),

  getBlobUrl: async (blobPath: string) => {
    const state = get();
    
    // 1. Check cache first (synchronous, instant)
    if (state.blobCache.has(blobPath)) {
      return state.blobCache.get(blobPath)!;
    }
    
    // 2. Check if already loading (deduplication)
    if (state.promiseCache.has(blobPath)) {
      return state.promiseCache.get(blobPath)!;
    }
    
    // 3. Start loading
    const { activeInfospace } = useInfospaceStore.getState();
    if (!activeInfospace?.id) {
      return null;
    }
    
    const loadingPromise = (async () => {
      set((state) => ({
        loadingStates: new Map(state.loadingStates).set(blobPath, true),
      }));
      
      try {
        const response = await fetch(
          `/api/v1/files/stream/${encodeURIComponent(blobPath)}`,
          {
            headers: {
              'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
            },
          }
        );
        
        if (!response.ok) {
          throw new Error(`Failed to fetch: ${response.status}`);
        }
        
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        
        // Update cache
        set((state) => ({
          blobCache: new Map(state.blobCache).set(blobPath, blobUrl),
          loadingStates: new Map(state.loadingStates).set(blobPath, false),
        }));
        
        return blobUrl;
      } catch (error) {
        console.error('Error fetching media blob:', error);
        toast.error(`Failed to load media: ${error instanceof Error ? error.message : 'Unknown error'}`);
        
        set((state) => ({
          loadingStates: new Map(state.loadingStates).set(blobPath, false),
        }));
        
        return null;
      } finally {
        // Remove from promise cache when done
        set((state) => {
          const newCache = new Map(state.promiseCache);
          newCache.delete(blobPath);
          return { promiseCache: newCache };
        });
      }
    })();
    
    // Cache the promise
    set((state) => ({
      promiseCache: new Map(state.promiseCache).set(blobPath, loadingPromise),
    }));
    
    return loadingPromise;
  },

  isLoading: (blobPath: string) => {
    return get().loadingStates.get(blobPath) ?? false;
  },

  clearCache: () => {
    const state = get();
    // Revoke all blob URLs
    state.blobCache.forEach((url) => URL.revokeObjectURL(url));
    set({
      blobCache: new Map(),
      loadingStates: new Map(),
      promiseCache: new Map(),
    });
  },

  revokeBlobUrl: (blobPath: string) => {
    const state = get();
    const url = state.blobCache.get(blobPath);
    if (url) {
      URL.revokeObjectURL(url);
      set((state) => {
        const newCache = new Map(state.blobCache);
        newCache.delete(blobPath);
        return { blobCache: newCache };
      });
    }
  },
}));
