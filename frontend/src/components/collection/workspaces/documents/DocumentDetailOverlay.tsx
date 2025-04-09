'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useDocumentStore } from '@/zustand_stores/storeDocuments';
import { useClassificationSystem } from '@/hooks/useClassificationSystem';
import { useWorkspaceStore } from '@/zustand_stores/storeWorkspace';
import DocumentDetailView from './DocumentsDetailView';
import { Button } from '@/components/ui/button';
import { X, Maximize } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { schemesToSchemeReads } from '@/lib/classification/adapters';

interface DocumentDetailOverlayProps {
  open: boolean;
  onClose: () => void;
  documentId: number | null;
  onLoadIntoRunner?: (runId: number, runName: string) => void;
}

export default function DocumentDetailOverlay({
  open,
  onClose,
  documentId,
  onLoadIntoRunner
}: DocumentDetailOverlayProps) {
  const { documents, fetchDocuments } = useDocumentStore();
  const { schemes, loadSchemes } = useClassificationSystem({
    autoLoadSchemes: true
  });
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const { activeWorkspace } = useWorkspaceStore();
  const [dataFetched, setDataFetched] = useState(false);

  // Memoize the fetch function to prevent unnecessary re-renders
  const fetchData = useCallback(async () => {
    if (!activeWorkspace) return;
    
    setIsLoading(true);
    try {
      await Promise.all([
        fetchDocuments(),
        loadSchemes()
      ]);
      setDataFetched(true);
    } catch (error) {
      console.error('Error fetching document data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [fetchDocuments, loadSchemes, activeWorkspace]);

  // Only fetch data when the overlay is opened and data hasn't been fetched yet
  useEffect(() => {
    if (open && documentId && activeWorkspace && !dataFetched) {
      fetchData();
    }
  }, [open, documentId, activeWorkspace, dataFetched, fetchData]);

  // Reset dataFetched when the overlay is closed
  useEffect(() => {
    if (!open) {
      setDataFetched(false);
    }
  }, [open]);

  const handleViewFullPage = () => {
    if (documentId) {
      // Navigate to the document detail page
      router.push(`/documents/${documentId}`);
      onClose();
    }
  };

  const handleEdit = (document: any) => {
    // This is a placeholder for the edit functionality
    console.log('Edit document:', document);
  };

  const handleLoadIntoRunner = (runId: number, runName: string) => {
    if (onLoadIntoRunner) {
      toast.success(`Loading into Classification Runner`, {
        description: `Loading run "${runName}" (ID: ${runId}) into the Classification Runner`,
        duration: 3000,
      });
      
      onLoadIntoRunner(runId, runName);
      onClose(); // Close the overlay after loading into runner
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex flex-row items-center justify-between">
          <DialogTitle>Document Details</DialogTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={handleViewFullPage}
              title="View full page"
            >
              <Maximize className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              title="Close"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>
        <div className="flex-1 overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <p>Loading document details...</p>
            </div>
          ) : (
            <DocumentDetailView
              documents={documents}
              newlyInsertedDocumentIds={[]}
              onEdit={handleEdit}
              schemes={schemesToSchemeReads(schemes)}
              selectedDocumentId={documentId}
              onLoadIntoRunner={handleLoadIntoRunner}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
} 