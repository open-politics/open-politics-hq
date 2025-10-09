'use client';

import React, { useState, createContext, useContext, useCallback } from 'react';
// Removed: import { useDocumentStore } from '@/zustand_stores/storeDocuments';
import AssetDetailOverlay from './AssetDetailOverlay';
import AssetManagerOverlay from '../Helper/AssetManagerOverlay'; // Assuming this will be adapted or replaced
import { TextSpanHighlightProvider } from '@/components/collection/contexts/TextSpanHighlightContext';
import { FormattedAnnotation } from '@/lib/annotations/types';
import { AnnotationSchemaRead } from '@/client';

// --- Create Context ---
interface AssetDetailContextType {
  openDetailOverlay: (assetId: number) => void;
}

const AssetDetailContext = createContext<AssetDetailContextType | undefined>(undefined);

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
}

export default function AssetDetailProvider({
  children,
  onLoadIntoRunner,
  annotationResults,
  schemas
}: AssetDetailProviderProps) {
  // Removed: const { isDetailOpen, selectedDocumentId, closeDocumentDetail } = useDocumentStore();
  const [isManagerOpen, setIsManagerOpen] = useState(false);
  // --- Manage Overlay State Here ---
  const [isDetailOverlayOpen, setIsDetailOverlayOpen] = useState(false);
  const [detailAssetId, setDetailAssetId] = useState<number | null>(null);
  // --- Add state for initial highlight ---
  const [highlightAssetIdOnOpen, setHighlightAssetIdOnOpen] = useState<number | null>(null);
  // --- End Add state ---
  // --- End Manage Overlay State ---

  // --- Functions to control the overlay ---
  const openDetailOverlay = useCallback((assetId: number) => {
    console.log(`[AssetDetailProvider] Opening detail for asset ID: ${assetId} and setting highlight.`);
    setDetailAssetId(assetId);
    setHighlightAssetIdOnOpen(assetId); // Set the ID to highlight
    setIsDetailOverlayOpen(true);
  }, []);

  const closeDetailOverlay = useCallback(() => {
    setIsDetailOverlayOpen(false);
    setDetailAssetId(null);
    setHighlightAssetIdOnOpen(null); // Clear highlight ID on close
  }, []);
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
  const contextValue = {
    openDetailOverlay,
  };
  // --- End Provide context value ---

  return (
    // --- Wrap children with Provider ---
    <TextSpanHighlightProvider>
      <AssetDetailContext.Provider value={contextValue}>
        {children}
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
        />
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