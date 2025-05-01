'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useClassificationSystem } from '@/hooks/useClassificationSystem';
import { useWorkspaceStore } from '@/zustand_stores/storeWorkspace';
import DocumentDetailView from './LegacyDocumentDetailView';
import { Button } from '@/components/ui/button';
import { Maximize, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import EditDocumentOverlay from './EditDocumentOverlay';

interface DocumentDetailOverlayProps {
  open: boolean;
  onClose: () => void;
  documentId: number | null;
  onLoadIntoRunner?: (runId: number, runName: string) => void;
  onOpenManagerRequest?: () => void;
}

export default function DocumentDetailOverlay({
  open,
  onClose,
  documentId,
  onLoadIntoRunner,
  onOpenManagerRequest
}: DocumentDetailOverlayProps) {
  const { schemes, loadSchemes } = useClassificationSystem({
    autoLoadSchemes: false
  });
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const { activeWorkspace } = useWorkspaceStore();
  const [dataFetched, setDataFetched] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);

  const fetchData = useCallback(async () => {
    if (!activeWorkspace) return;
    
    setIsLoading(true);
    try {
      await Promise.all([
        loadSchemes()
      ]);
      setDataFetched(true);
    } catch (error) {
      console.error('Error fetching document data:', error);
      toast.error('Failed to load document details.');
    } finally {
      setIsLoading(false);
    }
  }, [loadSchemes, activeWorkspace]);

  useEffect(() => {
    if (open && documentId && activeWorkspace && !dataFetched) {
      fetchData();
    }
    if (open) {
        setIsEditOpen(false);
    }
  }, [open, documentId, activeWorkspace, dataFetched, fetchData]);

  useEffect(() => {
    if (!open) {
      setDataFetched(false);
      setIsEditOpen(false);
    }
  }, [open]);

  const handleOpenInManager = () => {
    if (documentId) {
      console.warn('handleOpenInManager needs refactoring for DataSources/DataRecords');
      onOpenManagerRequest?.();
      onClose();
    }
  };

  const handleEdit = (/* document */) => {
    console.warn('handleEdit needs refactoring');
  };

  const handleLoadIntoRunner = (runId: number, runName: string) => {
    if (onLoadIntoRunner) {
      toast.success(`Loading into Classification Runner`, {
        description: `Loading run "${runName}" (ID: ${runId}) into the Classification Runner`,
        duration: 3000,
      });
      
      onLoadIntoRunner(runId, runName);
      onClose();
    }
  };

  const currentDocument: any = null;

  return (
    <>
      <Dialog open={open && !isEditOpen} onOpenChange={(isOpen) => !isOpen && onClose()}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0">
          <DialogHeader className="flex flex-row items-center justify-between p-4 border-b">
            <DialogTitle>Data Record Details</DialogTitle>
            <Button
              variant="outline"
              size="icon"
              onClick={handleOpenInManager}
              title="Open in Data Source Manager"
              className="h-8 w-8"
              disabled={!documentId}
            >
              <Maximize className="h-4 w-4" />
            </Button>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto p-4">
            {isLoading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-6 w-6 animate-spin mr-2" />
                <p>Loading details...</p>
              </div>
            ) : documentId ? (
              <DocumentDetailView
                onEdit={handleEdit}
                schemes={schemes}
                selectedDataSourceId={documentId}
                onLoadIntoRunner={handleLoadIntoRunner}
              />
            ) : (
              <div className="flex items-center justify-center h-full">
                 <p>No item selected.</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* {currentDocument && (
        <EditDocumentOverlay
          open={isEditOpen}
          onClose={() => setIsEditOpen(false)}
          documentId={currentDocument.id}
        />
      )} */}
    </>
  );
} 