'use client';

import React, { useState } from 'react';
// Removed: import { useDocumentStore } from '@/zustand_stores/storeDocuments';
import DocumentDetailOverlay from './DocumentDetailOverlay';
import DocumentManagerOverlay from './DocumentManagerOverlay'; // Assuming this will be adapted or replaced

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
  const [isDetailOpen, setIsDetailOpen] = useState(false); // Added local state as placeholder
  const [selectedDocumentId, setSelectedDocumentId] = useState<number | null>(null); // Added local state as placeholder

  // Placeholder function, real logic depends on how detail is opened now
  const closeDocumentDetail = () => {
    setIsDetailOpen(false);
    setSelectedDocumentId(null);
  };

  const handleLoadIntoRunner = (runId: number, runName: string) => {
    if (onLoadIntoRunner) {
      onLoadIntoRunner(runId, runName);
      closeDocumentDetail();
      setIsManagerOpen(false);
    }
  };

  const handleOpenManagerRequest = () => {
    setIsManagerOpen(true);
  };

  const handleCloseManager = () => {
    setIsManagerOpen(false);
  };

  // TODO: Need a way to set isDetailOpen and selectedDocumentId based on user action
  // This component might need context or props to trigger the detail view

  return (
    <>
      {children}
      <DocumentDetailOverlay
        open={isDetailOpen}
        onClose={closeDocumentDetail}
        documentId={selectedDocumentId}
        onLoadIntoRunner={handleLoadIntoRunner}
        onOpenManagerRequest={handleOpenManagerRequest}
      />
      <DocumentManagerOverlay
        isOpen={isManagerOpen}
        onClose={handleCloseManager}
        onLoadIntoRunner={handleLoadIntoRunner}
      />
    </>
  );
} 