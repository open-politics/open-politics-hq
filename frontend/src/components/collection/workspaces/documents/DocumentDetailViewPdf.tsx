// frontend/src/components/collection/workspaces/documents/DocumentDetailViewPdf.tsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Eye, Download, X, Files, FileText, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DataSourceRead as ClientDataSourceRead, DataRecordRead } from '@/client/models'; // Assuming client models are needed
import { useToast } from '@/components/ui/use-toast';

interface DocumentDetailViewPdfProps {
  dataSource: ClientDataSourceRead;
  associatedRecords: DataRecordRead[];
  isLoadingRecords: boolean;
  selectedIndividualRecord: DataRecordRead | null;
  setSelectedIndividualRecord: (record: DataRecordRead | null) => void;
  renderEditableField: (record: DataRecordRead | null, field: 'title' | 'event_timestamp') => React.ReactNode;
  renderTextDisplay: (text: string | null) => React.ReactNode;
  handleDownloadPdf: () => void;
  activeWorkspaceId: number;
}

const DocumentDetailViewPdf: React.FC<DocumentDetailViewPdfProps> = ({
  dataSource,
  associatedRecords,
  isLoadingRecords,
  selectedIndividualRecord,
  setSelectedIndividualRecord,
  renderEditableField,
  renderTextDisplay,
  handleDownloadPdf,
  activeWorkspaceId,
}) => {
  const { toast } = useToast();
  const [isPdfViewerOpen, setIsPdfViewerOpen] = useState(false);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [isFetchingPdfForView, setIsFetchingPdfForView] = useState(false);
  const [currentlyViewedRecordId, setCurrentlyViewedRecordId] = useState<number | null>(null);

  const isBulkPdf = dataSource.source_metadata && typeof dataSource.source_metadata.file_count === 'number' && dataSource.source_metadata.file_count > 1;
  const fileCount = dataSource.source_metadata?.file_count as number | undefined;
  const pageCount = dataSource.source_metadata?.page_count as number | undefined;
  const processedPages = dataSource.source_metadata?.processed_page_count as number | undefined;
  const filenameFromDetails = dataSource.origin_details?.filename as string | undefined;
  const displayFilename = isBulkPdf ? dataSource.name : (filenameFromDetails || dataSource.name || `DataSource ${dataSource.id}`);

  const statusBadge = dataSource.status ? (
      <Badge variant={
          dataSource.status === 'complete' ? 'default'
          : dataSource.status === 'failed' ? 'destructive'
          : dataSource.status === 'processing' ? 'secondary'
          : dataSource.status === 'pending' ? 'secondary'
          : 'outline'
      }
          className="capitalize flex items-center gap-1"
      >
          {dataSource.status === 'processing' && <Loader2 className="h-3 w-3 animate-spin" />}
          {dataSource.status === 'complete' ? 'Completed'
           : dataSource.status === 'failed' ? 'Failed'
           : dataSource.status === 'processing' ? 'Processing'
           : dataSource.status === 'pending' ? 'Pending'
           : dataSource.status}
      </Badge>
  ) : (
      <Badge variant="outline">Unknown</Badge>
  );

  // Determine the record to potentially display/edit fields for
  const recordForFields = isBulkPdf ? selectedIndividualRecord : (associatedRecords.length > 0 ? associatedRecords[0] : null);

  // --- PDF Fetching and Viewing Logic (Moved from DocumentDetailView) ---
  const fetchAndSetPdfBlob = useCallback(async (recordToView: DataRecordRead | null): Promise<string | null> => {
    if (!recordToView?.id || !activeWorkspaceId) {
      console.error("Cannot fetch PDF blob: Missing record ID or workspace ID.");
      return null;
    }

    const viewUrl = `/api/v1/workspaces/${activeWorkspaceId}/datarecords/${recordToView.id}/content`;
    const token = typeof window !== 'undefined' ? localStorage.getItem("access_token") : null;

    if (!token) {
      toast({ title: "Authentication Error", description: "Could not find authentication token.", variant: "destructive" });
      return null;
    }

    setIsFetchingPdfForView(true);
    // Revoke any existing URL before fetching a new one to prevent memory leaks
    if (pdfBlobUrl) {
      window.URL.revokeObjectURL(pdfBlobUrl);
      setPdfBlobUrl(null);
    }
    setCurrentlyViewedRecordId(null); // Clear potentially stale ID before fetching

    try {
      const response = await fetch(viewUrl, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!response.ok) {
        let errorDetail = `HTTP error! Status: ${response.status}`;
        try {
          const errorData = await response.json();
          errorDetail = errorData.detail || errorDetail;
        } catch (e) { /* Ignore */ }
        throw new Error(errorDetail);
      }

      const blob = await response.blob();
      if (blob.size === 0 || blob.type !== 'application/pdf') {
        throw new Error(blob.type !== 'application/pdf' ? "Received file is not a PDF." : "Received empty PDF file.");
      }

      const objectUrl = window.URL.createObjectURL(blob);
      setCurrentlyViewedRecordId(recordToView.id); // Set viewed ID on successful fetch
      return objectUrl; // Return the new URL on success

    } catch (error: any) {
      console.error("Failed to fetch PDF blob:", error);
      toast({
        title: "PDF Load Failed",
        description: error.message || "Could not load the PDF file.",
        variant: "destructive"
      });
      setCurrentlyViewedRecordId(null); // Ensure ID is cleared on error
      return null; // Return null on failure
    } finally {
      setIsFetchingPdfForView(false);
    }
  }, [activeWorkspaceId, toast, pdfBlobUrl]);

  const handleTogglePdfViewer = useCallback(async (forceOpenForRecord?: DataRecordRead) => {
    if (isPdfViewerOpen && !forceOpenForRecord) {
      setIsPdfViewerOpen(false);
      if (pdfBlobUrl) {
        window.URL.revokeObjectURL(pdfBlobUrl);
        setPdfBlobUrl(null);
      }
      setCurrentlyViewedRecordId(null);
      return;
    }

    const recordToView = forceOpenForRecord || selectedIndividualRecord || (associatedRecords.length > 0 ? associatedRecords[0] : null);

    if (!recordToView) {
      toast({ title: "Cannot View PDF", description: isBulkPdf ? "Please select an individual PDF file to view." : "No PDF record available to view.", variant: "destructive" });
      return;
    }

    // If already viewing this record and viewer is open, do nothing (or potentially re-fetch if needed, but simple for now)
    if (isPdfViewerOpen && currentlyViewedRecordId === recordToView.id && pdfBlobUrl) {
        console.log("PDF already open for this record.");
        return;
    }

    const newBlobUrl = await fetchAndSetPdfBlob(recordToView);
    if (newBlobUrl) {
      setPdfBlobUrl(newBlobUrl);
      setIsPdfViewerOpen(true);
    } else {
      setIsPdfViewerOpen(false); // Ensure viewer is closed on error
    }
  }, [isPdfViewerOpen, pdfBlobUrl, selectedIndividualRecord, associatedRecords, fetchAndSetPdfBlob, toast, isBulkPdf, currentlyViewedRecordId]);

  // Effect to load PDF when selectedIndividualRecord changes AND viewer is open
  useEffect(() => {
    if (isPdfViewerOpen && selectedIndividualRecord && selectedIndividualRecord.id !== currentlyViewedRecordId) {
      console.log(`[DocumentDetailViewPdf] selectedIndividualRecord changed to ${selectedIndividualRecord.id}, viewer open. Fetching PDF.`);
      handleTogglePdfViewer(selectedIndividualRecord); // This will fetch and open for the new record
    }
    // Do not close viewer if selectedIndividualRecord becomes null while open, let user explicitly close.
  }, [selectedIndividualRecord, isPdfViewerOpen, currentlyViewedRecordId, handleTogglePdfViewer]);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (pdfBlobUrl) {
        window.URL.revokeObjectURL(pdfBlobUrl);
      }
    };
  }, [pdfBlobUrl]);
  // --- End PDF Fetching and Viewing Logic ---

  // --- PDF Navigation Logic ---
  const currentRecordIndex = useMemo(() => {
    if (!isBulkPdf || !selectedIndividualRecord) return -1;
    return associatedRecords.findIndex(record => record.id === selectedIndividualRecord.id);
  }, [isBulkPdf, associatedRecords, selectedIndividualRecord]);

  const handlePreviousPdf = () => {
    if (isBulkPdf && currentRecordIndex > 0) {
      setSelectedIndividualRecord(associatedRecords[currentRecordIndex - 1]);
      // The useEffect above will handle fetching/displaying if viewer is open
    }
  };

  const handleNextPdf = () => {
    if (isBulkPdf && currentRecordIndex < associatedRecords.length - 1) {
      setSelectedIndividualRecord(associatedRecords[currentRecordIndex + 1]);
      // The useEffect above will handle fetching/displaying if viewer is open
    }
  };
  // --- End PDF Navigation Logic ---

  return (
    <div className="p-4 border rounded-lg bg-muted/30 h-full flex flex-col">
      <h3 className="text-lg font-semibold mb-3 flex items-center">
         {isBulkPdf ? <Files className="h-5 w-5 mr-2 text-primary" /> : <FileText className="h-5 w-5 mr-2 text-primary" />}
         {isBulkPdf ? 'Bulk PDF Details' : 'PDF Details'}
      </h3>
      
      <div className="space-y-2 mb-4 text-sm flex-grow">
          {renderEditableField(recordForFields, 'title')}
          <p><strong>Source Name:</strong> {displayFilename}</p>
          {isBulkPdf && fileCount !== undefined && <p><strong>Files Included:</strong> {fileCount}</p>}
          {!isBulkPdf && pageCount !== undefined && <p><strong>Total Pages:</strong> {pageCount}</p>}
          {!isBulkPdf && processedPages !== undefined && <p><strong>Processed Pages:</strong> {processedPages}</p>}
          <div className="flex items-center gap-1"><strong>Overall Status:</strong> {statusBadge}</div>
          {dataSource.status === 'failed' && dataSource.error_message && (
              <p className="text-destructive text-xs"><strong>Error:</strong> {dataSource.error_message}</p>
          )}
           {renderEditableField(recordForFields, 'event_timestamp')}

           {/* Text Content Display */}
            {(() => {
                const recordForTextDisplay = isBulkPdf ? selectedIndividualRecord : (associatedRecords.length > 0 ? associatedRecords[0] : null);
                if (recordForTextDisplay) {
                    const textTitle = isBulkPdf
                        ? `Text Content for: ${(recordForTextDisplay.source_metadata as any)?.original_filename || `Record ${recordForTextDisplay.id}`}`
                        : 'Extracted Text Content';
                    return (
                        <div className="mt-3 pt-3 border-t">
                            <h4 className="text-xs font-semibold mb-1.5 text-muted-foreground">{textTitle}</h4>
                            {renderTextDisplay(recordForTextDisplay.text_content)}
                        </div>
                    );
                }
                else if (!isBulkPdf && !isLoadingRecords) {
                    return (
                        <div className="mt-3 pt-3 border-t">
                            <p className="text-xs italic text-muted-foreground">No text content record found.</p>
                        </div>
                    );
                }
                return null;
            })()}

          {isBulkPdf && (
              <div className="mt-3 pt-3 border-t">
                  <h4 className="text-xs font-semibold mb-1.5 text-muted-foreground">Individual Files ({associatedRecords.length}):</h4>
                  <div className="h-32">
                      {isLoadingRecords ? (
                          <p className="text-xs italic text-muted-foreground pt-2">Loading file list...</p>
                      ) : associatedRecords.length > 0 ? (
                          <ScrollArea className="h-full overflow-y-auto pr-2">
                              <ul className="space-y-1 text-xs">
                                  {associatedRecords.map(record => {
                                      const originalFilename = (record.source_metadata as any)?.original_filename;
                                      const isSelected = selectedIndividualRecord?.id === record.id;
                                      return (
                                          <li key={record.id}
                                              className={cn(
                                                  "truncate p-1 rounded border cursor-pointer hover:bg-muted/80 flex items-center gap-1",
                                                  isSelected ? "bg-primary/10 border-primary/30 ring-1 ring-primary/30" : "bg-background"
                                              )}
                                              title={originalFilename || `Record ${record.id}`}
                                              onClick={() => setSelectedIndividualRecord(isSelected ? null : record)} // Allow deselection
                                          >
                                              <FileText className="h-3 w-3 inline-block mr-1.5 align-middle shrink-0" />
                                              <span className="truncate flex-grow">{originalFilename || `Record ${record.id}`}</span>
                                          </li>
                                      );
                                  })}
                              </ul>
                          </ScrollArea>
                      ) : (
                          <p className="text-xs italic text-muted-foreground pt-2">No individual file records found (or still processing).</p>
                      )}
                  </div>
              </div>
          )}
      </div>

      

      {/* --- MODIFIED: PDF Action and Navigation Buttons --- */}
      <div className="flex items-center justify-between gap-2 mb-4 border-t pt-4 mt-auto">
        <div className="flex items-center gap-2">
            <Button 
                onClick={() => handleTogglePdfViewer()} 
                variant="outline" 
                size="sm" 
                disabled={isFetchingPdfForView || (!isBulkPdf && associatedRecords.length === 0) || (isBulkPdf && !selectedIndividualRecord)}
                title={isBulkPdf && !selectedIndividualRecord ? "Select an individual file to view" : (isPdfViewerOpen ? "Close PDF Viewer" : (isBulkPdf ? "View Selected PDF" : "View Inline PDF"))}
            >
            {isFetchingPdfForView ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : isPdfViewerOpen ? (
                <X className="mr-2 h-4 w-4" />
            ) : (
                <Eye className="mr-2 h-4 w-4" />
            )}
            {isPdfViewerOpen ? 'Close Viewer' : (isBulkPdf ? 'View Selected' : 'View PDF')}
            </Button>
            <Button onClick={handleDownloadPdf} variant="outline" size="sm" disabled={isBulkPdf && !selectedIndividualRecord} title={isBulkPdf && !selectedIndividualRecord ? "Select an individual file to download" : "Download PDF"}>
            <Download className="mr-2 h-4 w-4" />
            {isBulkPdf ? 'Download Selected' : 'Download'}
            </Button>
        </div>

        {isBulkPdf && associatedRecords.length > 1 && (
            <div className="flex items-center gap-1">
                <Button 
                    onClick={handlePreviousPdf} 
                    variant="outline" 
                    size="icon" 
                    className="h-9 w-9"
                    disabled={currentRecordIndex <= 0}
                    title="Previous PDF"
                >
                    <ChevronLeft className="h-4 w-4" />
                    <span className="sr-only">Previous PDF</span>
                </Button>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                    File {currentRecordIndex + 1} of {associatedRecords.length}
                </span>
                <Button 
                    onClick={handleNextPdf} 
                    variant="outline" 
                    size="icon" 
                    className="h-9 w-9"
                    disabled={currentRecordIndex >= associatedRecords.length - 1}
                    title="Next PDF"
                >
                    <ChevronRight className="h-4 w-4" />
                    <span className="sr-only">Next PDF</span>
                </Button>
            </div>
        )}
      </div>
      {/* --- END MODIFIED BUTTONS --- */}

      {/* --- ADDED: Embedded PDF Viewer --- */}
      {isPdfViewerOpen && pdfBlobUrl && (
        <div className="mt-0 mb-4 border rounded-lg overflow-hidden shadow-md flex-grow min-h-[400px] h-[60vh]">
            <iframe
                src={pdfBlobUrl}
                title={selectedIndividualRecord ? (selectedIndividualRecord.source_metadata as any)?.original_filename || `Record ${selectedIndividualRecord.id}` : dataSource?.name || 'PDF Viewer'}
                width="100%"
                height="100%"
                style={{ border: 'none' }}
            />
        </div>
      )}
      {/* --- END ADDED --- */}
    </div>
  );
};

export default DocumentDetailViewPdf;
