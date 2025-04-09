'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { X, Maximize, Loader2 } from 'lucide-react';
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
    autoLoadSchemes: false
  });
  const [isLoading, setIsLoading] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false);

  useEffect(() => {
    if (isOpen && activeWorkspace && !dataLoaded) {
      setIsLoading(true);
      setDataLoaded(true);
      Promise.all([
        fetchDocuments(),
        loadSchemes()
      ]).finally(() => {
        setIsLoading(false);
      });
    }
    if (!isOpen) {
      setDataLoaded(false);
    }
  }, [isOpen, activeWorkspace, fetchDocuments, loadSchemes, dataLoaded]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] w-[90vw] overflow-hidden flex flex-col p-0">
        <DialogHeader className="flex flex-row items-center justify-between p-4 border-b">
          <DialogTitle>Document Manager</DialogTitle>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            title="Close"
            className="h-8 w-8"
          >
            <X className="h-4 w-4" />
          </Button>
        </DialogHeader>
        <div className="flex-1 overflow-hidden p-4">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              <p>Loading documents...</p>
            </div>
          ) : (
            <DocumentManager onLoadIntoRunner={onLoadIntoRunner} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
} 