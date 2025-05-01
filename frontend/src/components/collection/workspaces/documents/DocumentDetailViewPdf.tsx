// frontend/src/components/collection/workspaces/documents/DocumentDetailViewPdf.tsx
import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Eye, Download, X, Files, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DataSourceRead as ClientDataSourceRead, DataRecordRead } from '@/client/models'; // Assuming client models are needed

interface DocumentDetailViewPdfProps {
  dataSource: ClientDataSourceRead;
  associatedRecords: DataRecordRead[];
  isLoadingRecords: boolean;
  selectedIndividualRecord: DataRecordRead | null;
  setSelectedIndividualRecord: (record: DataRecordRead | null) => void;
  renderEditableField: (record: DataRecordRead | null, field: 'title' | 'event_timestamp') => React.ReactNode;
  renderTextDisplay: (text: string | null) => React.ReactNode;
  handleViewPdf: () => void;
  handleDownloadPdf: () => void;
  isFetchingPdfForView: boolean;
  isPdfViewerOpen: boolean;
}

const DocumentDetailViewPdf: React.FC<DocumentDetailViewPdfProps> = ({
  dataSource,
  associatedRecords,
  isLoadingRecords,
  selectedIndividualRecord,
  setSelectedIndividualRecord,
  renderEditableField,
  renderTextDisplay,
  handleViewPdf,
  handleDownloadPdf,
  isFetchingPdfForView,
  isPdfViewerOpen,
}) => {
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

          {isBulkPdf && (
              <div className="mt-3 pt-3 border-t">
                  <h4 className="text-xs font-semibold mb-1.5 text-muted-foreground">Individual Files ({associatedRecords.length}):</h4>
                  {isLoadingRecords ? (
                      <p className="text-xs italic text-muted-foreground">Loading file list...</p>
                  ) : associatedRecords.length > 0 ? (
                      <ScrollArea className="max-h-32 overflow-y-auto pr-2">
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
                      <p className="text-xs italic text-muted-foreground">No individual file records found (or still processing).</p>
                  )}
              </div>
          )}
      </div>

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

      {/* PDF Action Buttons */}
      <div className="flex items-center gap-2 mb-4 border-t pt-4 mt-auto">
        <Button onClick={handleViewPdf} variant="outline" size="sm" disabled={isFetchingPdfForView || (isBulkPdf && !selectedIndividualRecord)} title={isBulkPdf && !selectedIndividualRecord ? "Select an individual file above to view" : ""}>
          {isFetchingPdfForView ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : isPdfViewerOpen ? (
            <X className="mr-2 h-4 w-4" />
          ) : (
            <Eye className="mr-2 h-4 w-4" />
          )}
          {isPdfViewerOpen ? 'Close Viewer' : (isBulkPdf ? 'View Selected PDF' : 'View Inline')}
        </Button>
        <Button onClick={handleDownloadPdf} variant="outline" size="sm" disabled={isBulkPdf && !selectedIndividualRecord} title={isBulkPdf && !selectedIndividualRecord ? "Select an individual file above to download" : ""}>
          <Download className="mr-2 h-4 w-4" />
          {isBulkPdf ? 'Download Selected PDF' : 'Download PDF'}
        </Button>
      </div>
    </div>
  );
};

export default DocumentDetailViewPdf;
