'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { X, Maximize } from 'lucide-react';
import DocumentManager from './DocumentManager';
import DocumentDetailProvider from './DocumentDetailProvider';
import { useWorkspaceStore } from '@/zustand_stores/storeWorkspace';
import { useDocumentStore } from '@/zustand_stores/storeDocuments';
import { useClassificationSystem } from '@/hooks/useClassificationSystem';

interface DocumentManagerOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  onLoadIntoRunner?: (runId: number, runName: string) => void;
}

export default function DocumentManagerOverlay({
  isOpen,
  onClose,
  onLoadIntoRunner
}: DocumentManagerOverlayProps) {
  const { activeWorkspace } = useWorkspaceStore();
  const { fetchDocuments } = useDocumentStore();
  const { loadSchemes } = useClassificationSystem({
    autoLoadSchemes: true
  });
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen && activeWorkspace) {
      setIsLoading(true);
      Promise.all([
        fetchDocuments(),
        loadSchemes()
      ]).finally(() => {
        setIsLoading(false);
      });
    }
  }, [isOpen, activeWorkspace, fetchDocuments, loadSchemes]);

  return (
    <DocumentDetailProvider>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-6xl max-h-[90vh] w-[90vw] overflow-hidden flex flex-col">
          <DialogHeader className="flex flex-row items-center justify-between">
            <DialogTitle>Document Manager</DialogTitle>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              title="Close"
            >
              <X className="h-4 w-4" />
            </Button>
          </DialogHeader>
          <div className="flex-1 overflow-hidden">
            {isLoading ? (
              <div className="flex items-center justify-center h-full">
                <p>Loading documents...</p>
              </div>
            ) : (
              <DocumentManager onLoadIntoRunner={onLoadIntoRunner} />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </DocumentDetailProvider>
  );
} 