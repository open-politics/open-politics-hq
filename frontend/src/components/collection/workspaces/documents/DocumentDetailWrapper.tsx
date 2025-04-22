'use client';

import React, { useState } from 'react';
import DocumentDetailOverlay from './DocumentDetailOverlay';

interface DocumentDetailWrapperProps {
  children: React.ReactNode;
  onLoadIntoRunner?: (runId: number, runName: string) => void;
}

export default function DocumentDetailWrapper({
  children,
  onLoadIntoRunner
}: DocumentDetailWrapperProps) {
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [selectedDocumentId, setSelectedDocumentId] = useState<number | null>(null);

  const handleLoadIntoRunner = (runId: number, runName: string) => {
    if (onLoadIntoRunner) {
      onLoadIntoRunner(runId, runName);
      setIsDetailOpen(false);
    }
  };

  return (
    <>
      {children}
      <DocumentDetailOverlay
        open={isDetailOpen}
        onClose={() => setIsDetailOpen(false)}
        documentId={selectedDocumentId}
        onLoadIntoRunner={handleLoadIntoRunner}
      />
    </>
  );
} 