'use client';

import React, { useState, createContext, useContext, useCallback } from 'react';
// Removed: import { useDocumentStore } from '@/zustand_stores/storeDocuments';
import DocumentDetailOverlay from './DocumentDetailOverlay';
import DocumentManagerOverlay from './DocumentManagerOverlay'; // Assuming this will be adapted or replaced

// --- Create Context ---
interface DocumentDetailContextType {
  openDetailOverlay: (recordId: number) => void;
}

const DocumentDetailContext = createContext<DocumentDetailContextType | undefined>(undefined);

export const useDocumentDetail = () => {
  const context = useContext(DocumentDetailContext);
  if (context === undefined) {
    throw new Error('useDocumentDetail must be used within a DocumentDetailProvider');
  }
  return context;
};
// --- End Create Context ---

interface DocumentDetailProviderProps {
  children: React.ReactNode;
  onLoadIntoRunner?: (runId: number, runName: string) => void;
}

export default function DocumentDetailProvider({
  children,
  onLoadIntoRunner
}: DocumentDetailProviderProps) {
  // Removed: const { isDetailOpen, selectedDocumentId, closeDocumentDetail } = useDocumentStore();
  const [isManagerOpen, setIsManagerOpen] = useState(false);
  // --- Manage Overlay State Here ---
  const [isDetailOverlayOpen, setIsDetailOverlayOpen] = useState(false);
  const [detailRecordId, setDetailRecordId] = useState<number | null>(null);
  // --- Add state for initial highlight ---
  const [highlightRecordIdOnOpen, setHighlightRecordIdOnOpen] = useState<number | null>(null);
  // --- End Add state ---
  // --- End Manage Overlay State ---

  // --- Functions to control the overlay ---
  const openDetailOverlay = useCallback((recordId: number) => {
    console.log(`[DocumentDetailProvider] Opening detail for record ID: ${recordId} and setting highlight.`);
    setDetailRecordId(recordId);
    setHighlightRecordIdOnOpen(recordId); // Set the ID to highlight
    setIsDetailOverlayOpen(true);
  }, []);

  const closeDetailOverlay = useCallback(() => {
    setIsDetailOverlayOpen(false);
    setDetailRecordId(null);
    setHighlightRecordIdOnOpen(null); // Clear highlight ID on close
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
    <DocumentDetailContext.Provider value={contextValue}>
      {children}
      <DocumentDetailOverlay
        // Use state for props
        open={isDetailOverlayOpen}
        onClose={closeDetailOverlay}
        dataRecordId={detailRecordId} // Pass the correct ID
        highlightRecordIdOnOpen={highlightRecordIdOnOpen} // Pass highlight ID
        onLoadIntoRunner={handleLoadIntoRunner}
        onOpenManagerRequest={handleOpenManagerRequest}
      />
      <DocumentManagerOverlay
        isOpen={isManagerOpen}
        onClose={handleCloseManager}
        onLoadIntoRunner={handleLoadIntoRunner}
      />
    </DocumentDetailContext.Provider>
    // --- End Wrap children ---
  );
} 