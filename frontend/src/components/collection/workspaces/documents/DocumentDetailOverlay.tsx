'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useClassificationSystem } from '@/hooks/useClassificationSystem';
import { useWorkspaceStore } from '@/zustand_stores/storeWorkspace';
import DocumentDetailView from './DocumentDetailView';
import { Button } from '@/components/ui/button';
import { Maximize, Loader2, AlertCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import EditDocumentOverlay from './EditDocumentOverlay';
import { useDataSourceStore } from '@/zustand_stores/storeDataSources';
import { DatarecordsService } from '@/client/services';

interface DocumentDetailOverlayProps {
  open: boolean;
  onClose: () => void;
  dataRecordId: number | null;
  highlightRecordIdOnOpen: number | null;
  onLoadIntoRunner?: (runId: number, runName: string) => void;
  onOpenManagerRequest?: () => void;
}

export default function DocumentDetailOverlay({
  open,
  onClose,
  dataRecordId,
  highlightRecordIdOnOpen,
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
  const [parentDataSourceId, setParentDataSourceId] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Fetch the data record details to get its parent data source ID
  const fetchDataRecordDetails = useCallback(async (recordId: number) => {
    if (!activeWorkspace?.id) return null;
    
    try {
      const record = await DatarecordsService.getDatarecord({
        workspaceId: activeWorkspace.id,
        datarecordId: recordId
      });
      return record.datasource_id;
    } catch (error) {
      console.error(`Error fetching data record ${recordId}:`, error);
      return null;
    }
  }, [activeWorkspace?.id]);

  const fetchData = useCallback(async () => {
    if (!activeWorkspace || !dataRecordId) return;
    
    setIsLoading(true);
    setLoadError(null);
    
    try {
      // First, fetch the schemes
      await loadSchemes();
      
      // Then, get the parent data source for this record
      const sourceId = await fetchDataRecordDetails(dataRecordId);
      
      if (sourceId) {
        setParentDataSourceId(sourceId);
        setDataFetched(true);
      } else {
        setLoadError(`Could not find the parent data source for record ID: ${dataRecordId}`);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      setLoadError('Failed to load data record details.');
      toast.error('Failed to load data record details.');
    } finally {
      setIsLoading(false);
    }
  }, [loadSchemes, activeWorkspace, dataRecordId, fetchDataRecordDetails]);

  useEffect(() => {
    if (open && dataRecordId && activeWorkspace && !dataFetched) {
      fetchData();
    }
    if (open) {
      setIsEditOpen(false);
    }
  }, [open, dataRecordId, activeWorkspace, dataFetched, fetchData]);

  useEffect(() => {
    if (!open) {
      setDataFetched(false);
      setIsEditOpen(false);
      setParentDataSourceId(null);
      setLoadError(null);
    }
  }, [open]);

  const handleOpenInManager = () => {
    if (parentDataSourceId) {
      // We now have the parent data source ID, so we can open that in the manager
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

  return (
    <>
      <Dialog open={open && !isEditOpen} onOpenChange={(isOpen) => !isOpen && onClose()}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0">
          <DialogHeader className="flex flex-row items-center justify-between p-4 border-b">
            <DialogTitle>Data Record Details {dataRecordId ? `(ID: ${dataRecordId})` : ''}</DialogTitle>
            {parentDataSourceId && (
              <Button
                variant="outline"
                size="icon"
                onClick={handleOpenInManager}
                title="Open in Data Source Manager"
                className="h-8 w-8"
              >
                <Maximize className="h-4 w-4" />
              </Button>
            )}
          </DialogHeader>
          <div className="flex-1 overflow-y-auto p-4">
            {isLoading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-6 w-6 animate-spin mr-2" />
                <p>Loading details...</p>
              </div>
            ) : loadError ? (
              <div className="flex flex-col items-center justify-center h-full text-destructive">
                <AlertCircle className="h-10 w-10 mb-4" />
                <p className="text-center">{loadError}</p>
              </div>
            ) : parentDataSourceId ? (
              <DocumentDetailView
                onEdit={handleEdit}
                schemes={schemes}
                selectedDataSourceId={parentDataSourceId}
                highlightRecordIdOnOpen={highlightRecordIdOnOpen}
                onLoadIntoRunner={handleLoadIntoRunner}
              />
            ) : (
              <div className="flex items-center justify-center h-full">
                <p>No data found or item does not exist.</p>
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