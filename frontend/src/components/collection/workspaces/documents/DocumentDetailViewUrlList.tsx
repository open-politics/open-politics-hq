// frontend/src/components/collection/workspaces/documents/DocumentDetailViewUrlList.tsx
import React, { ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Pagination, PaginationContent, PaginationItem, PaginationPrevious, PaginationNext } from "@/components/ui/pagination";
import { Loader2, RefreshCw, Trash2, PlusCircle, Save, ExternalLink, AlertCircle, ChevronDown, ChevronUp, X } from 'lucide-react';
import { cn } from "@/lib/utils";
import { DataSourceRead as ClientDataSourceRead, DataRecordRead } from '@/client/models';
import { RecurringTask } from '@/zustand_stores/storeRecurringTasks'; // Assuming type is exported
import { formatDistanceToNow } from 'date-fns';
import Cronstrue from 'cronstrue';
import { Badge } from '@/components/ui/badge';

// Define view mode type if not imported
type ScrapedContentViewMode = 'flat' | 'grouped';

interface DocumentDetailViewUrlListProps {
  dataSource: ClientDataSourceRead;
  urlListDataRecords: DataRecordRead[];
  isLoadingUrlList: boolean;
  urlListError: string | null;
  scrapedContentViewMode: ScrapedContentViewMode;
  setScrapedContentViewMode: (mode: ScrapedContentViewMode) => void;
  highlightedRecordId: number | null;
  setHighlightedRecordId: (id: number | null) => void;
  editableUrls: string[];
  setEditableUrls: React.Dispatch<React.SetStateAction<string[]>>;
  newUrlInput: string;
  setNewUrlInput: (input: string) => void;
  handleAddUrl: () => void;
  handleRemoveUrl: (url: string) => void;
  handleSaveUrls: () => void;
  isSavingUrls: boolean;
  handleRefetch: () => void;
  isRefetching: boolean;
  renderEditableField: (record: DataRecordRead, field: 'title' | 'event_timestamp') => React.ReactNode;
  renderTextDisplay: (text: string | null) => React.ReactNode;
  urlListCurrentPage: number;
  urlListTotalPages: number;
  urlListTotalRecords: number;
  handleUrlListPageChange: (page: number) => void;
  sortedFlatList: DataRecordRead[];
  groupedRecords: Record<string, DataRecordRead[]>;
  // Scheduling props
  localIngestTask: RecurringTask | null;
  enableScheduledIngestion: boolean;
  setEnableScheduledIngestion: (enabled: boolean) => void;
  ingestionSchedule: string;
  setIngestionSchedule: (schedule: string) => void;
  cronExplanation: string;
  isUpdatingSchedule: boolean;
  handleScheduleUpdate: () => void;
  initialScheduleState: { enabled: boolean; schedule: string };
  fetchedHighlightRecord: DataRecordRead | null;
}

const DocumentDetailViewUrlList: React.FC<DocumentDetailViewUrlListProps> = ({
  dataSource,
  urlListDataRecords,
  isLoadingUrlList,
  urlListError,
  scrapedContentViewMode,
  setScrapedContentViewMode,
  highlightedRecordId,
  setHighlightedRecordId,
  editableUrls,
  setEditableUrls, // Directly passed setter
  newUrlInput,
  setNewUrlInput,
  handleAddUrl,
  handleRemoveUrl,
  handleSaveUrls,
  isSavingUrls,
  handleRefetch,
  isRefetching,
  renderEditableField,
  renderTextDisplay,
  urlListCurrentPage,
  urlListTotalPages,
  urlListTotalRecords,
  handleUrlListPageChange,
  sortedFlatList,
  groupedRecords,
  localIngestTask,
  enableScheduledIngestion,
  setEnableScheduledIngestion,
  ingestionSchedule,
  setIngestionSchedule,
  cronExplanation,
  isUpdatingSchedule,
  handleScheduleUpdate,
  initialScheduleState,
  fetchedHighlightRecord,
}) => {

  // Find the highlighted record *from the current page data*
  const highlightedRecord = React.useMemo(() => {
      if (highlightedRecordId === null) return null;
      // Check both flat list and grouped records *for the current page*
      let foundRecord = sortedFlatList.find(r => r.id === highlightedRecordId);
      if (foundRecord) return foundRecord;

      for (const url in groupedRecords) {
          foundRecord = groupedRecords[url].find(r => r.id === highlightedRecordId);
          if (foundRecord) return foundRecord;
      }
      // It might be in the original urlListDataRecords if pagination is active and the record is not on the current page's flat/grouped list
      // This fallback is less reliable now, as urlListDataRecords is also paged.
      // The primary mechanism now is the `fetchedHighlightRecord` prop for records not on the current page.
      // return urlListDataRecords.find(r => r.id === highlightedRecordId) || null; // Keep commented or remove
      return null; // Return null if not found in current page data
  }, [highlightedRecordId, sortedFlatList, groupedRecords]);

  // ---> ADDED: Determine the record to display in the highlighted view ---
  // Prioritize the fetched record if its ID matches and it's not found on the current page.
  // Otherwise, use the record found on the current page (if any).
  const displayRecord = React.useMemo(() => {
    if (highlightedRecordId === null) return null;
    if (highlightedRecord) return highlightedRecord; // Prefer record from current page if available
    if (fetchedHighlightRecord?.id === highlightedRecordId) return fetchedHighlightRecord; // Fallback to fetched record
    return null;
  }, [highlightedRecord, fetchedHighlightRecord, highlightedRecordId]);
  // ---> END ADDED ---

  const renderScheduledIngestionCard = () => {
     const hasChanged =
        enableScheduledIngestion !== initialScheduleState.enabled ||
        (enableScheduledIngestion && ingestionSchedule !== initialScheduleState.schedule);

     return (
        <Card className="mt-4">
            <CardHeader>
                <CardTitle className="text-base">Scheduled Ingestion</CardTitle>
                <CardDescription>
                    Configure automatic scraping of the source URLs on a regular schedule.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                 <div className="flex items-center justify-between space-x-2 pt-2">
                    <Label htmlFor="scheduled-ingestion-switch-detail-url" className="flex flex-col space-y-1">
                        <span>Enable Scheduled Ingestion</span>
                        <span className="font-normal leading-snug text-muted-foreground text-xs">
                            {enableScheduledIngestion ? "Task is active and will run on schedule." : "Task is currently paused or not created."}
                        </span>
                    </Label>
                    <Switch
                        id="scheduled-ingestion-switch-detail-url"
                        checked={enableScheduledIngestion}
                        onCheckedChange={setEnableScheduledIngestion}
                        disabled={isUpdatingSchedule}
                        aria-label="Enable Scheduled Ingestion"
                    />
                </div>
                {enableScheduledIngestion && (
                    <div className="space-y-1 pl-3 ml-1 border-l">
                        <Label htmlFor="ingestion-schedule-detail-url" className="text-sm">Schedule (Cron Format)</Label>
                        <Input
                            id="ingestion-schedule-detail-url"
                            value={ingestionSchedule}
                            onChange={(e) => setIngestionSchedule(e.target.value)}
                            placeholder="e.g., 0 0 * * *"
                            className="h-9 text-sm font-mono"
                            disabled={isUpdatingSchedule}
                        />
                        <p className="text-xs text-muted-foreground">
                             {cronExplanation || 'Enter a 5-part cron schedule.'} (UTC)
                        </p>
                    </div>
                )}
                 {localIngestTask && (
                     <div className="text-xs text-muted-foreground pt-3 border-t space-y-1">
                         <p>Task Name: <span className='font-medium text-foreground'>{localIngestTask.name}</span></p>
                         <p>Last Run: {localIngestTask.last_run_at ? formatDistanceToNow(new Date(localIngestTask.last_run_at), { addSuffix: true }) : 'Never'}</p>
                         <p>Last Status: {localIngestTask.last_run_status ?
                             <Badge variant={localIngestTask.last_run_status === 'success' ? 'default' : 'destructive'} className='text-xs'>
                                 {localIngestTask.last_run_status}
                             </Badge> : 'N/A'}
                         </p>
                         {localIngestTask.last_run_message && <p>Last Message: {localIngestTask.last_run_message}</p>}
                     </div>
                 )}
            </CardContent>
            <CardFooter>
                 <Button
                    onClick={handleScheduleUpdate}
                    disabled={isUpdatingSchedule || !hasChanged}
                    size="sm"
                 >
                     {isUpdatingSchedule && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                     Save Schedule Changes
                 </Button>
            </CardFooter>
        </Card>
     );
  }

  const originalUrls = (dataSource.origin_details as any)?.urls || [];
  const hasUrlListChanged = JSON.stringify([...editableUrls].sort()) !== JSON.stringify([...originalUrls].sort());

  return (
    <div className='space-y-6'> {/* Add parent div with spacing */}
      {/* --- Highlighted Record Display (Full Width) --- */}
       {displayRecord && (
            <Card className="w-full border-primary/30 bg-primary/5">
                <CardHeader className="flex flex-row items-center justify-between py-2 px-4 border-b">
                    <CardTitle className="text-base flex items-center gap-2">
                      Selected Record (ID: {displayRecord.id})
                      {(displayRecord.source_metadata as any)?.original_url &&
                          <a href={(displayRecord.source_metadata as any)?.original_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center text-xs font-normal ml-1" title={(displayRecord.source_metadata as any)?.original_url}>
                              <span className="truncate max-w-[300px]">{(displayRecord.source_metadata as any)?.original_url}</span>
                              <ExternalLink className="h-3 w-3 ml-1 shrink-0" />
                          </a>
                      }
                    </CardTitle>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setHighlightedRecordId(null)}>
                        <X className="h-4 w-4" />
                        <span className="sr-only">Close highlighted record view</span>
                    </Button>
                </CardHeader>
                <CardContent className="p-4 space-y-3">
                     {/* Use existing render functions */}
                     <div className="max-w-full">
                       {renderEditableField(displayRecord, 'title')}
                     </div>
                     {renderEditableField(displayRecord, 'event_timestamp')}
                     <div className="pt-2 border-t">
                        <Label className='text-xs text-muted-foreground'>Text Content</Label>
                        {renderTextDisplay(displayRecord.text_content)}
                     </div>
                </CardContent>
            </Card>
        )}

        {/* --- Original Two-Column Layout --- */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* --- Left Column: URL Editor --- */}
            <div className="space-y-3">
                <h4 className="text-md font-semibold flex items-center justify-between">
                    Source URLs ({editableUrls.length})
                    <Button onClick={handleRefetch} variant="outline" size="sm" disabled={isRefetching || isSavingUrls}>
                        {isRefetching ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                        Re-fetch All
                    </Button>
                </h4>
                <ScrollArea className="h-[250px] w-full border rounded-md p-3">
                    <div className="space-y-2 ">
                        {editableUrls.map((url, index) => (
                            <div key={index} className="flex items-center justify-between gap-2 text-sm bg-background p-1.5 rounded">
                                <a href={url} target="_blank" rel="noopener noreferrer" className="truncate hover:underline text-blue-600 flex-1" title={url}>
                                    {url}
                                </a>
                                <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive shrink-0" onClick={() => handleRemoveUrl(url)} disabled={isSavingUrls}>
                                    <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                            </div>
                        ))}
                        {editableUrls.length === 0 && (
                            <p className="text-sm text-muted-foreground italic text-center py-2">No URLs added yet.</p>
                        )}
                    </div>
                </ScrollArea>
                <div className="flex items-center gap-2">
                    <Input
                        type="url"
                        placeholder="Add new URL (e.g., https://...)"
                        value={newUrlInput}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => setNewUrlInput(e.target.value)}
                        className="h-9 text-sm"
                        onKeyDown={(e) => e.key === 'Enter' && handleAddUrl()}
                        disabled={isSavingUrls}
                    />
                    <Button onClick={handleAddUrl} size="sm" disabled={isSavingUrls || !newUrlInput.trim()}>
                        <PlusCircle className="h-4 w-4 mr-1" /> Add
                    </Button>
                </div>
                <Button onClick={handleSaveUrls} size="sm" disabled={isSavingUrls || !hasUrlListChanged}>
                    {isSavingUrls ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                    Save URL List Changes
                </Button>
                {renderScheduledIngestionCard()} {/* Move Schedule card here */}
            </div>

            {/* --- Right Column: Scraped Records --- */}
            <div className="space-y-3">
                <div className="flex items-center justify-between"> {/* Make heading row flex */}
                    <h4 className="text-md font-semibold">Scraped Content ({urlListTotalRecords} records)</h4>
                    <div className="flex items-center space-x-2"> {/* Container for buttons */}
                      <Button
                        variant={scrapedContentViewMode === 'flat' ? 'secondary' : 'outline'}
                        size="sm"
                        onClick={() => setScrapedContentViewMode('flat')}
                        className="h-7 px-2 text-xs"
                      >
                        Flat List (Time)
                      </Button>
                      <Button
                        variant={scrapedContentViewMode === 'grouped' ? 'secondary' : 'outline'}
                        size="sm"
                        onClick={() => setScrapedContentViewMode('grouped')}
                        className="h-7 px-2 text-xs"
                      >
                        Grouped by URL
                      </Button>
                    </div>
                </div> {/* End heading row flex */}

                {isLoadingUrlList ? (
                     <div className="text-center py-4 text-muted-foreground flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading scraped content...</div>
                ) : urlListError ? (
                     <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Error Loading Records</AlertTitle><AlertDescription>{urlListError}</AlertDescription></Alert>
                ) : (urlListDataRecords.length > 0 || sortedFlatList.length > 0) ? ( // Check sortedFlatList too
                    <>
                        <ScrollArea className="h-[400px] w-full border rounded-md p-3">
                            <div className="space-y-3">
                                {scrapedContentViewMode === 'flat' ? (
                                    sortedFlatList.map((record) => {
                                        const originalUrl = (record.source_metadata as any)?.original_url;
                                        const isHighlighted = highlightedRecordId === record.id;
                                        return (
                                            <div
                                              key={record.id}
                                              className={cn(
                                                "p-2 rounded bg-background space-y-1 border cursor-pointer transition-colors",
                                                isHighlighted ? "bg-primary/10 border-primary/30 ring-1 ring-primary/30" : "hover:bg-muted/50"
                                              )}
                                              onClick={() => setHighlightedRecordId(isHighlighted ? null : record.id)}
                                            >
                                                <div className="text-xs font-medium text-muted-foreground flex items-center justify-between gap-2 flex-wrap">
                                                    <span>Record ID: {record.id}</span>
                                                    {originalUrl &&
                                                        <a href={originalUrl} target="_blank" rel="noopener noreferrer" className="ml-1 text-primary hover:underline inline-flex items-center text-xs" title={originalUrl}>
                                                            <span className="truncate max-w-[200px]">{originalUrl}</span>
                                                            <ExternalLink className="h-3 w-3 ml-1 shrink-0" />
                                                        </a>
                                                    }
                                                    <span className="text-xs text-muted-foreground ml-auto whitespace-nowrap">
                                                       {record.event_timestamp ? formatDistanceToNow(new Date(record.event_timestamp), { addSuffix: true }) : 'No timestamp'}
                                                    </span>
                                                </div>
                                                 {/* --- Inline Edit Fields for URL List Record --- */}
                                                 {/* NOTE: Removed inline fields, now shown in the dedicated view above */}
                                                 {/* <div className="max-w-full">
                                                   {renderEditableField(record, 'title')}
                                                 </div>
                                                 {renderEditableField(record, 'event_timestamp')} */}
                                                 {/* --- --- */}
                                                 {/* Only show trigger, content is shown in the dedicated view */}
                                            </div>
                                        );
                                    })
                                ) : (
                                    Object.entries(groupedRecords).map(([url, recordsInGroup]) => (
                                        <div key={url} className="mb-4 border rounded-md">
                                            <div className="bg-muted/50 px-3 py-1.5 border-b">
                                                <a href={url !== 'Unknown URL' ? url : undefined} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-primary hover:underline flex items-center" title={url}>
                                                    {url}
                                                    {url !== 'Unknown URL' && <ExternalLink className="h-3.5 w-3.5 ml-1.5 shrink-0" />}
                                                </a>
                                            </div>
                                            <div className="p-2 space-y-2">
                                                {recordsInGroup.map((record) => {
                                                    const isHighlighted = highlightedRecordId === record.id;
                                                    return (
                                                        <div
                                                          key={record.id}
                                                          className={cn(
                                                            "p-1.5 rounded bg-background space-y-0.5 border cursor-pointer transition-colors",
                                                            isHighlighted ? "bg-primary/10 border-primary/30 ring-1 ring-primary/30" : "hover:bg-muted/50"
                                                          )}
                                                          onClick={() => setHighlightedRecordId(isHighlighted ? null : record.id)}
                                                        >
                                                            <div className="text-xs font-medium text-muted-foreground flex items-center justify-between gap-2 flex-wrap">
                                                                <span>Record ID: {record.id}</span>
                                                                <span className="text-xs text-muted-foreground ml-auto whitespace-nowrap">
                                                                   {record.event_timestamp ? formatDistanceToNow(new Date(record.event_timestamp), { addSuffix: true }) : 'No timestamp'}
                                                                </span>
                                                            </div>
                                                            {/* --- Inline Edit Fields for URL List Record (Grouped) --- */}
                                                            {/* NOTE: Removed inline fields, now shown in the dedicated view above */}
                                                            {/* <div className="max-w-full">
                                                              {renderEditableField(record, 'title')}
                                                            </div>
                                                            {renderEditableField(record, 'event_timestamp')} */}
                                                            {/* --- --- */}
                                                            {/* Only show trigger, content is shown in the dedicated view */}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </ScrollArea>
                        {urlListTotalPages > 0 && (
                            <div className="flex justify-center items-center pt-1 flex-none">
                                <Pagination>
                                    <PaginationContent>
                                        <PaginationItem><PaginationPrevious href="#" onClick={(e) => { e.preventDefault(); handleUrlListPageChange(urlListCurrentPage - 1); }} className={cn(urlListCurrentPage === 1 ? "pointer-events-none opacity-50" : "", "h-8 px-2")} /></PaginationItem>
                                        <PaginationItem><span className="px-3 text-sm">Page {urlListCurrentPage} of {urlListTotalPages}</span></PaginationItem>
                                        <PaginationItem><PaginationNext href="#" onClick={(e) => { e.preventDefault(); handleUrlListPageChange(urlListCurrentPage + 1); }} className={cn(urlListCurrentPage === urlListTotalPages ? "pointer-events-none opacity-50" : "", "h-8 px-2")} /></PaginationItem>
                                    </PaginationContent>
                                </Pagination>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="text-center py-4 text-muted-foreground italic">No scraped content records found for this URL list source.</div>
                )}
            </div>
        </div>
    </div>
  );
};

export default DocumentDetailViewUrlList;
