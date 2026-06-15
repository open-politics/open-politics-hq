'use client';

import { createContext, useContext } from 'react';
import { useDock } from '@/zustand_stores/storeDock';

/**
 * The AssetDetail context + hook, split out from AssetDetailProvider so leaf
 * consumers (AssetDetailView, AssetDetailOverlay) can read the interface without
 * importing the Provider — which imports the overlay, which imports the view.
 * Pulling the hook here breaks that render-time import cycle; this module depends
 * only on the dock store. AssetDetailProvider re-exports these for everyone else.
 */

export type DetailViewType = 'asset' | 'bundle' | null;

export interface AssetDetailContextType {
  /** `fromBundleId`: the bundle the asset was opened from, for the breadcrumb. */
  openDetailOverlay: (assetId: number, fromBundleId?: number) => void;
  openBundleDetail: (bundleId: number) => void;
  closeDetailOverlay: () => void;
  isOpen: boolean;
  selectedAssetId: number | null;
  selectedBundleId: number | null;
  viewType: DetailViewType;
  /** Register the current row order so the overlay can navigate ↑↓ between rows. */
  setNavAssetIds: (ids: number[]) => void;
  /** Move the open overlay to the previous/next asset in the registered list. No-op when not registered. */
  navigateAdjacent: (direction: 'prev' | 'next') => void;
  /** True when there is a registered list of nav IDs and adjacency is possible. */
  hasNav: boolean;
  navHasPrev: boolean;
  navHasNext: boolean;
}

export const AssetDetailContext = createContext<AssetDetailContextType | undefined>(undefined);

/**
 * Adapts the global right dock onto the AssetDetail interface. Used when no
 * AssetDetailProvider is in scope (the common case under the bare hq layout):
 * opening an asset/bundle docks it in the right panel instead of throwing.
 */
function useDockAsAssetDetail(): AssetDetailContextType {
  const entry = useDock((s) => s.entry);
  const navIds = useDock((s) => s.navIds);
  const openAsset = useDock((s) => s.openAsset);
  const openBundle = useDock((s) => s.openBundle);
  const close = useDock((s) => s.close);
  const setNavAssetIds = useDock((s) => s.setNavAssetIds);
  const navigateAdjacent = useDock((s) => s.navigateAdjacent);

  const selectedAssetId = entry?.key === 'assetDetail' ? (entry.init.assetId as number) : null;
  const selectedBundleId = entry?.key === 'bundleDetail' ? (entry.init.bundleId as number) : null;
  const viewType: DetailViewType = entry?.key === 'assetDetail' ? 'asset' : entry?.key === 'bundleDetail' ? 'bundle' : null;
  const idx = selectedAssetId != null ? navIds.indexOf(selectedAssetId) : -1;
  const hasNav = navIds.length > 0 && idx >= 0;

  return {
    openDetailOverlay: openAsset,
    openBundleDetail: openBundle,
    closeDetailOverlay: close,
    isOpen: viewType !== null,
    selectedAssetId,
    selectedBundleId,
    viewType,
    setNavAssetIds,
    navigateAdjacent,
    hasNav,
    navHasPrev: hasNav && idx > 0,
    navHasNext: hasNav && idx < navIds.length - 1,
  };
}

export const useAssetDetail = (): AssetDetailContextType => {
  // Inside an annotation overlay provider (runner, monitoring, …) use that —
  // a focused Dialog with row-nav over a specific result set. Otherwise the
  // global dock. Same interface either way, so consumers never branch.
  const context = useContext(AssetDetailContext);
  const dock = useDockAsAssetDetail();
  return context ?? dock;
};
