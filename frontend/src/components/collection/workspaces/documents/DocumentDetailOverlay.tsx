'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useDocumentStore } from '@/zustand_stores/storeDocuments';
import { useClassificationSystem } from '@/hooks/useClassificationSystem';
import { useWorkspaceStore } from '@/zustand_stores/storeWorkspace';
import DocumentDetailView from './DocumentsDetailView';
import { Button } from '@/components/ui/button';
import { Maximize, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { schemesToSchemeReads } from '@/lib/classification/adapters';
import EditDocumentOverlay from './EditDocumentOverlay';
import { DocumentRead } from '@/client';

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
  const { documents, fetchDocuments, setDocumentIdToSelect } = useDocumentStore();
  const { schemes, loadSchemes } = useClassificationSystem({
    autoLoadSchemes: false
  });
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const { activeWorkspace } = useWorkspaceStore();
  const [dataFetched, setDataFetched] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [documentToEdit, setDocumentToEdit] = useState<DocumentRead | null>(null);

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
      toast.error('Failed to load document details.');
    } finally {
      setIsLoading(false);
    }
  }, [fetchDocuments, loadSchemes, activeWorkspace]);

  useEffect(() => {
    if (open && documentId && activeWorkspace && !dataFetched) {
      fetchData();
    }
    if (open) {
        setIsEditOpen(false);
        setDocumentToEdit(null);
    }
  }, [open, documentId, activeWorkspace, dataFetched, fetchData]);

  useEffect(() => {
    if (!open) {
      setDataFetched(false);
      setIsEditOpen(false);
      setDocumentToEdit(null);
    }
  }, [open]);

  const handleOpenInManager = () => {
    if (documentId) {
      setDocumentIdToSelect(documentId);
      onOpenManagerRequest?.();
      onClose();
    }
  };

  const handleEdit = (document: DocumentRead) => {
    setDocumentToEdit(document);
    setIsEditOpen(true);
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

  const currentDocument = documentId ? documents.find(doc => doc.id === documentId) : null;

  return (
    <>
      <Dialog open={open && !isEditOpen} onOpenChange={(isOpen) => !isOpen && onClose()}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0">
          <DialogHeader className="flex flex-row items-center justify-between p-4 border-b">
            <DialogTitle>Document Details</DialogTitle>
            <Button
              variant="outline"
              size="icon"
              onClick={handleOpenInManager}
              title="Open in Document Manager"
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
                <p>Loading document details...</p>
              </div>
            ) : documentId ? (
              <DocumentDetailView
                documents={documents}
                newlyInsertedDocumentIds={[]}
                onEdit={handleEdit}
                schemes={schemesToSchemeReads(schemes)}
                selectedDocumentId={documentId}
                onLoadIntoRunner={handleLoadIntoRunner}
              />
            ) : (
              <div className="flex items-center justify-center h-full">
                 <p>No document selected.</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {currentDocument && (
        <EditDocumentOverlay
          open={isEditOpen}
          onClose={() => setIsEditOpen(false)}
          documentId={currentDocument.id}
          defaultTitle={currentDocument.title}
          defaultTopImage={currentDocument.top_image}
          defaultContentType={currentDocument.content_type || 'article'}
          defaultSource={currentDocument.source ?? ''}
          defaultTextContent={currentDocument.text_content}
          defaultSummary={currentDocument.summary ?? ''}
          defaultInsertionDate={currentDocument.insertion_date || new Date().toISOString()}
        />
      )}
    </>
  );
} 