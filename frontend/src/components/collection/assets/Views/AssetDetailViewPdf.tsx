// frontend/src/components/collection/Infospaces/documents/AssetDetailViewPdf.tsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Eye, Download, X, Files, FileText, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AssetRead } from '@/client';
import { toast } from 'sonner';

// Define placeholder types since DataRecordRead doesn't exist
interface AssetRecord {
  id: number;
  title: string;
  text_content: string | null;
  source_metadata?: Record<string, any>;
  event_timestamp?: string;
}

interface AssetDetailViewPdfProps {
  asset: AssetRead;
  associatedRecords: AssetRecord[];
  isLoadingRecords: boolean;
  selectedIndividualRecord: AssetRecord | null;
  setSelectedIndividualRecord: (record: AssetRecord | null) => void;
  renderEditableField: (record: AssetRecord | null, field: 'title' | 'event_timestamp') => React.ReactNode;
  renderTextDisplay: (text: string | null) => React.ReactNode;
  handleDownloadPdf: () => void;
  activeInfospaceId: number;
}

const AssetDetailViewPdf: React.FC<AssetDetailViewPdfProps> = ({
  asset,
  associatedRecords,
  isLoadingRecords,
  selectedIndividualRecord,
  setSelectedIndividualRecord,
  renderEditableField,
  renderTextDisplay,
  handleDownloadPdf,
  activeInfospaceId,
}) => {
  const [isPdfViewerOpen, setIsPdfViewerOpen] = useState(false);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [isFetchingPdfForView, setIsFetchingPdfForView] = useState(false);
  const [currentlyViewedRecordId, setCurrentlyViewedRecordId] = useState<number | null>(null);

  const isBulkPdf = asset.source_metadata && typeof asset.source_metadata.file_count === 'number' && asset.source_metadata.file_count > 1;
  const fileCount = asset.source_metadata?.file_count as number | undefined;
  const pageCount = asset.source_metadata?.page_count as number | undefined;
  const processedPages = asset.source_metadata?.processed_page_count as number | undefined;
  const filenameFromDetails = asset.source_metadata?.filename as string | undefined;
  const displayFilename = isBulkPdf ? asset.title : (filenameFromDetails || asset.title || `Asset ${asset.id}`);

  // For now, assume assets don't have a status field like DataSources did
  const statusBadge = (
      <Badge variant="default" className="capitalize flex items-center gap-1">
          Complete
      </Badge>
  );

  // Determine the record to potentially display/edit fields for
  const recordForFields = isBulkPdf ? selectedIndividualRecord : (associatedRecords.length > 0 ? associatedRecords[0] : null);

  // --- PDF Fetching and Viewing Logic ---
  const fetchAndSetPdfBlob = useCallback(async (recordToView: AssetRecord | null): Promise<string | null> => {
    if (!recordToView?.id || !activeInfospaceId) {
      console.error("Cannot fetch PDF blob: Missing record ID or Infospace ID.");
      return null;
    }

    // For now, we'll use the asset API instead of the old datarecords API
    const viewUrl = `/api/v1/assets/infospaces/${activeInfospaceId}/assets/${recordToView.id}`;
    const token = typeof window !== 'undefined' ? localStorage.getItem("access_token") : null;

    if (!token) {
      toast.error("Could not find authentication token.");
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
      toast.error(error.message || "Could not load the PDF file.");
      setCurrentlyViewedRecordId(null); // Ensure ID is cleared on error
      return null; // Return null on failure
    } finally {
      setIsFetchingPdfForView(false);
    }
  }, [activeInfospaceId, pdfBlobUrl]);

  const handleTogglePdfViewer = useCallback(async (forceOpenForRecord?: AssetRecord) => {
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
      toast.error(isBulkPdf ? "Please select an individual PDF file to view." : "No PDF record available to view.");
      return;
    }

    // If already viewing this record and viewer is open, do nothing
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
  }, [isPdfViewerOpen, pdfBlobUrl, selectedIndividualRecord, associatedRecords, fetchAndSetPdfBlob, isBulkPdf, currentlyViewedRecordId]);

  // Effect to load PDF when selectedIndividualRecord changes AND viewer is open
  useEffect(() => {
    if (isPdfViewerOpen && selectedIndividualRecord && selectedIndividualRecord.id !== currentlyViewedRecordId) {
      console.log(`[AssetDetailViewPdf] selectedIndividualRecord changed to ${selectedIndividualRecord.id}, viewer open. Fetching PDF.`);
      handleTogglePdfViewer(selectedIndividualRecord); // This will fetch and open for the new record
    }
  }, [selectedIndividualRecord, isPdfViewerOpen, currentlyViewedRecordId, handleTogglePdfViewer]);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (pdfBlobUrl) {
        window.URL.revokeObjectURL(pdfBlobUrl);
      }
    };
  }, [pdfBlobUrl]);

  // --- PDF Navigation Logic ---
  const currentRecordIndex = useMemo(() => {
    if (!isBulkPdf || !selectedIndividualRecord) return -1;
    return associatedRecords.findIndex(record => record.id === selectedIndividualRecord.id);
  }, [isBulkPdf, associatedRecords, selectedIndividualRecord]);

  const handlePreviousPdf = () => {
    if (isBulkPdf && currentRecordIndex > 0) {
      setSelectedIndividualRecord(associatedRecords[currentRecordIndex - 1]);
    }
  };

  const handleNextPdf = () => {
    if (isBulkPdf && currentRecordIndex < associatedRecords.length - 1) {
      setSelectedIndividualRecord(associatedRecords[currentRecordIndex + 1]);
    }
  };

  return (
    <div className="p-4 bg-muted/30 h-full flex flex-col">
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

      {/* PDF Action and Navigation Buttons */}
      <div className="flex items-center justify-between gap-2 mb-4 border-t pt-4 mt-auto">
        <div className="flex items-center gap-2">
            <Button 
                onClick={() => handleTogglePdfViewer()} 
                variant="outline" 
                size="sm" 
                disabled={isFetchingPdfForView || (!isBulkPdf && associatedRecords.length === 0) || !!(isBulkPdf && !selectedIndividualRecord)}
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
            <Button onClick={handleDownloadPdf} variant="outline" size="sm" disabled={!!(isBulkPdf && !selectedIndividualRecord)} title={isBulkPdf && !selectedIndividualRecord ? "Select an individual file to download" : "Download PDF"}>
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

      {/* Embedded PDF Viewer */}
      {isPdfViewerOpen && pdfBlobUrl && (
        <div className="mt-0 mb-4 border rounded-lg overflow-hidden shadow-md flex-grow min-h-[400px] h-[60vh]">
            <iframe
                src={pdfBlobUrl}
                title={selectedIndividualRecord ? (selectedIndividualRecord.source_metadata as any)?.original_filename || `Record ${selectedIndividualRecord.id}` : asset?.title || 'PDF Viewer'}
                width="100%"
                height="100%"
                style={{ border: 'none' }}
            />
        </div>
      )}
    </div>
  );
};

export default AssetDetailViewPdf;
