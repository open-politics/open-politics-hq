'use client';

import React, { createContext, useContext, useState, ReactNode } from 'react';

interface DocumentDetailContextType {
  isOpen: boolean;
  documentId: number | null;
  openDocument: (id: number) => void;
  closeDocument: () => void;
}

const DocumentDetailContext = createContext<DocumentDetailContextType | undefined>(undefined);

export function DocumentDetailProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [documentId, setDocumentId] = useState<number | null>(null);

  const openDocument = (id: number) => {
    setDocumentId(id);
    setIsOpen(true);
  };

  const closeDocument = () => {
    setIsOpen(false);
  };

  return (
    <DocumentDetailContext.Provider
      value={{
        isOpen,
        documentId,
        openDocument,
        closeDocument
      }}
    >
      {children}
    </DocumentDetailContext.Provider>
  );
}

export function useDocumentDetail() {
  const context = useContext(DocumentDetailContext);
  if (context === undefined) {
    throw new Error('useDocumentDetail must be used within a DocumentDetailProvider');
  }
  return context;
} 