'use client';

import React, { useState } from 'react';
import { useDocumentStore } from '@/zustand_stores/storeDocuments';
import DocumentDetailOverlay from './DocumentDetailOverlay';
import DocumentManagerOverlay from './DocumentManagerOverlay';

interface DocumentDetailProviderProps {
  children: React.ReactNode;
  onLoadIntoRunner?: (runId: number, runName: string) => void;
}

export default function DocumentDetailProvider({
  children,
  onLoadIntoRunner
}: DocumentDetailProviderProps) {
  const { isDetailOpen, selectedDocumentId, closeDocumentDetail } = useDocumentStore();
  const [isManagerOpen, setIsManagerOpen] = useState(false);

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