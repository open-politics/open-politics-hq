'use client';

import { useState, useCallback } from 'react';
import { useAssetStore } from '@/zustand_stores/storeAssets';
import { useBundleStore } from '@/zustand_stores/storeBundles';
import { useTreeStore } from '@/zustand_stores/storeTree';
import { toast } from 'sonner';
import type { AssetRead, BundleRead } from '@/client';

interface UseToggleFavoriteOptions {
  asset?: AssetRead | null;
  bundle?: BundleRead | null;
}

interface UseToggleFavoriteReturn {
  isFavorited: boolean;
  isToggling: boolean;
  toggleFavorite: () => Promise<void>;
}

export function useToggleFavorite({ asset, bundle }: UseToggleFavoriteOptions): UseToggleFavoriteReturn {
  const { updateAsset } = useAssetStore();
  const { updateBundle } = useBundleStore();
  const { clearCache, fetchRootTree } = useTreeStore();

  const tags: string[] = (asset?.tags ?? bundle?.tags ?? []) as string[];
  const serverFavorited = tags.includes('favorite');

  const [optimisticOverride, setOptimisticOverride] = useState<boolean | null>(null);
  const [isToggling, setIsToggling] = useState(false);

  const isFavorited = optimisticOverride !== null ? optimisticOverride : serverFavorited;

  const toggleFavorite = useCallback(async () => {
    if (isToggling) return;
    const wasFav = isFavorited;
    const newTags = wasFav
      ? tags.filter((t) => t !== 'favorite')
      : [...tags, 'favorite'];

    setOptimisticOverride(!wasFav);
    setIsToggling(true);

    try {
      if (asset) {
        await updateAsset(asset.id, { tags: newTags });
      } else if (bundle) {
        await updateBundle(bundle.id, { tags: newTags });
      }
      clearCache();
      fetchRootTree();
    } catch {
      setOptimisticOverride(wasFav);
      toast.error('Failed to update favorite');
    } finally {
      setIsToggling(false);
      setTimeout(() => setOptimisticOverride(null), 1500);
    }
  }, [isFavorited, tags, asset, bundle, isToggling, updateAsset, updateBundle, clearCache, fetchRootTree]);

  return { isFavorited, isToggling, toggleFavorite };
}
