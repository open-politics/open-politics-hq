'use client';

import { useState, useEffect, useRef } from 'react';
import { AssetsService } from '@/client';
import type { AssetRead } from '@/client';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';

/**
 * Global cache for asset children to avoid re-fetching
 * Shared across all card instances
 */
const childrenCache = new Map<number, AssetRead[]>();
const fetchingSet = new Set<number>();

/**
 * useAssetChildren - Lazy load children for a single asset
 * 
 * Used by cards that need to display featured images from child assets.
 * Features:
 * - Global cache to avoid duplicate fetches
 * - Only fetches when the hook is actually used
 * - Lightweight - just gets first few children for images
 * 
 * @param assetId - The asset ID to fetch children for
 * @param enabled - Whether to actually fetch (default: true)
 */
export function useAssetChildren(assetId: number, enabled: boolean = true) {
  const [children, setChildren] = useState<AssetRead[] | undefined>(
    childrenCache.get(assetId)
  );
  const [isLoading, setIsLoading] = useState(false);
  const mountedRef = useRef(true);

  const { activeInfospace } = useInfospaceStore();

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!enabled || !assetId || !activeInfospace?.id) return;
    
    // Already have cached data
    if (childrenCache.has(assetId)) {
      setChildren(childrenCache.get(assetId));
      return;
    }
    
    // Already fetching
    if (fetchingSet.has(assetId)) return;
    
    const fetchChildren = async () => {
      fetchingSet.add(assetId);
      setIsLoading(true);
      
      try {
        const response = await AssetsService.getAssetChildren({
          infospaceId: activeInfospace.id,
          assetId,
          limit: 5, // Just need a few for images
        });
        
        // Cache the result
        childrenCache.set(assetId, response);
        
        if (mountedRef.current) {
          setChildren(response);
        }
      } catch (err) {
        console.warn(`[useAssetChildren] Failed to fetch children for ${assetId}:`, err);
        // Cache empty array to prevent re-fetching
        childrenCache.set(assetId, []);
      } finally {
        fetchingSet.delete(assetId);
        if (mountedRef.current) {
          setIsLoading(false);
        }
      }
    };
    
    fetchChildren();
  }, [assetId, enabled, activeInfospace?.id]);

  return { children, isLoading };
}

/**
 * Clear the children cache (useful after mutations)
 */
export function clearChildrenCache() {
  childrenCache.clear();
}
