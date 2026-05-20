'use client';

import React, { useState, createContext, useContext, useCallback, useRef, useMemo } from 'react';
// Removed: import { useDocumentStore } from '@/zustand_stores/storeDocuments';
import AssetDetailOverlay from './AssetDetailOverlay';
import AssetManagerOverlay from '../Helper/AssetManagerOverlay'; // Assuming this will be adapted or replaced
import { TextSpanHighlightProvider } from '@/components/collection/contexts/TextSpanHighlightContext';
import { FormattedAnnotation } from '@/lib/annotations/types';
import { AnnotationSchemaRead } from '@/client';

// --- Type for what's being viewed ---
type DetailViewType = 'asset' | 'bundle' | null;

// --- Create Context ---
interface AssetDetailContextType {
  openDetailOverlay: (assetId: number) => void;
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

export const useAssetDetail = () => {
  const context = useContext(AssetDetailContext);
  if (context === undefined) {
    throw new Error('useAssetDetail must be used within a AssetDetailProvider');
  }
  return context;
};
// --- End Create Context ---

interface AssetDetailProviderProps {
  children: React.ReactNode;
  onLoadIntoRunner?: (runId: number, runName: string) => void;
  // NEW: Optional annotation context for when provider is used in annotation runner
  annotationResults?: FormattedAnnotation[];
  schemas?: AnnotationSchemaRead[];
  // Render mode: 'overlay' (Dialog) or 'panel' (for layout integration)
  renderMode?: 'overlay' | 'panel';
  // NEW: Optional run ID to filter annotations to current run only
  activeRunId?: number | null;
}

export default function AssetDetailProvider({
  children,
  onLoadIntoRunner,
  annotationResults,
  schemas,
  renderMode = 'overlay',
  activeRunId = null
}: AssetDetailProviderProps) {
  // Removed: const { isDetailOpen, selectedDocumentId, closeDocumentDetail } = useDocumentStore();
  const [isManagerOpen, setIsManagerOpen] = useState(false);
  // --- Manage Overlay State Here ---
  const [isDetailOverlayOpen, setIsDetailOverlayOpen] = useState(false);
  const [detailAssetId, setDetailAssetId] = useState<number | null>(null);
  const [detailBundleId, setDetailBundleId] = useState<number | null>(null);
  const [viewType, setViewType] = useState<DetailViewType>(null);
  // --- Add state for initial highlight ---
  const [highlightAssetIdOnOpen, setHighlightAssetIdOnOpen] = useState<number | null>(null);
  // --- End Add state ---

  // Row-order list registered by the underlying surface (e.g. the results table)
  // so the overlay can navigate ↑↓ across rows.
  const navAssetIdsRef = useRef<number[]>([]);
  const [navTick, setNavTick] = useState(0); // bump to recompute hasPrev/hasNext when ids change
  const setNavAssetIds = useCallback((ids: number[]) => {
    navAssetIdsRef.current = ids;
    setNavTick((t) => t + 1);
  }, []);
  // --- End Manage Overlay State ---

  // --- Functions to control the overlay ---
  const openDetailOverlay = useCallback((assetId: number) => {
    console.log(`[AssetDetailProvider] Opening detail for asset ID: ${assetId} and setting highlight.`);
    setDetailAssetId(assetId);
    setDetailBundleId(null);
    setViewType('asset');
    setHighlightAssetIdOnOpen(assetId); // Set the ID to highlight
    setIsDetailOverlayOpen(true);
  }, []);

  const openBundleDetail = useCallback((bundleId: number) => {
    console.log(`[AssetDetailProvider] Opening detail for bundle ID: ${bundleId}`);
    setDetailBundleId(bundleId);
    setDetailAssetId(null);
    setViewType('bundle');
    setHighlightAssetIdOnOpen(null);
    setIsDetailOverlayOpen(true);
  }, []);

  const closeDetailOverlay = useCallback(() => {
    setIsDetailOverlayOpen(false);
    setDetailAssetId(null);
    setDetailBundleId(null);
    setViewType(null);
    setHighlightAssetIdOnOpen(null); // Clear highlight ID on close
  }, []);

  const navigateAdjacent = useCallback((direction: 'prev' | 'next') => {
    const ids = navAssetIdsRef.current;
    if (!ids.length || detailAssetId == null) return;
    const idx = ids.indexOf(detailAssetId);
    if (idx < 0) return;
    const target = direction === 'prev' ? idx - 1 : idx + 1;
    if (target < 0 || target >= ids.length) return;
    openDetailOverlay(ids[target]);
  }, [detailAssetId, openDetailOverlay]);

  const navIds = navAssetIdsRef.current;
  const navIdx = detailAssetId != null ? navIds.indexOf(detailAssetId) : -1;
  const hasNav = navIds.length > 0 && navIdx >= 0;
  const navHasPrev = hasNav && navIdx > 0;
  const navHasNext = hasNav && navIdx < navIds.length - 1;
  // navTick keeps these derived values in sync when navAssetIds is updated.
  void navTick;
  // --- End Functions ---

  const handleLoadIntoRunner = (runId: number, runName: string) => {
    if (onLoadIntoRunner) {
      onLoadIntoRunner(runId, runName);
      closeDetailOverlay(); // Use the state function
      setIsManagerOpen(false);
    }
  };

  const handleOpenManagerRequest = () => {
    setIsManagerOpen(true);
  };

  const handleCloseManager = () => {
    setIsManagerOpen(false);
  };

  // --- Provide context value ---
  // Memoised so consumers don't re-render every time AssetDetailProvider's parent renders.
  const contextValue = useMemo(() => ({
    openDetailOverlay,
    openBundleDetail,
    closeDetailOverlay,
    isOpen: isDetailOverlayOpen,
    selectedAssetId: detailAssetId,
    selectedBundleId: detailBundleId,
    viewType,
    setNavAssetIds,
    navigateAdjacent,
    hasNav,
    navHasPrev,
    navHasNext,
  }), [
    openDetailOverlay,
    openBundleDetail,
    closeDetailOverlay,
    isDetailOverlayOpen,
    detailAssetId,
    detailBundleId,
    viewType,
    setNavAssetIds,
    navigateAdjacent,
    hasNav,
    navHasPrev,
    navHasNext,
  ]);
  // --- End Provide context value ---

  return (
    // --- Wrap children with Provider ---
    <TextSpanHighlightProvider>
      <AssetDetailContext.Provider value={contextValue}>
        {children}
        {/* Only render overlay in 'overlay' mode - 'panel' mode is handled by layout */}
        {renderMode === 'overlay' && (
          <AssetDetailOverlay
            // Use state for props
            open={isDetailOverlayOpen}
            onClose={closeDetailOverlay}
            assetId={detailAssetId} // Pass the correct ID
            highlightAssetIdOnOpen={highlightAssetIdOnOpen} // Pass highlight ID
            onLoadIntoRunner={handleLoadIntoRunner}
            onOpenManagerRequest={handleOpenManagerRequest}
            annotationResults={annotationResults}
            schemas={schemas}
            activeRunId={activeRunId} // Pass run ID to filter annotations
          />
        )}
        <AssetManagerOverlay
          isOpen={isManagerOpen}
          onClose={handleCloseManager}
          onLoadIntoRunner={handleLoadIntoRunner}
        />
      </AssetDetailContext.Provider>
    </TextSpanHighlightProvider>
    // --- End Wrap children ---
  );
} 