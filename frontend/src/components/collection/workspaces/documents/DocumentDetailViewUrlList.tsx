// frontend/src/components/collection/workspaces/documents/DocumentDetailViewUrlList.tsx
import React, { ChangeEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Loader2, RefreshCw, Trash2, PlusCircle, Save, ExternalLink, AlertCircle, ChevronDown, X, SettingsIcon, CalendarClockIcon, ChevronLeft, ChevronRight, Rows, Columns } from 'lucide-react';
import { cn } from "@/lib/utils";
import { DataSourceRead as ClientDataSourceRead, DataRecordRead } from '@/client/models';
import { RecurringTask } from '@/zustand_stores/storeRecurringTasks';
import { formatDistanceToNow } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import Image from 'next/image';

interface DocumentDetailViewUrlListProps {
  dataSource: ClientDataSourceRead;
  urlListDataRecords: DataRecordRead[];
  isLoadingUrlList: boolean;
  urlListError: string | null;
  scrapedContentViewMode: 'flat' | 'grouped';
  setScrapedContentViewMode: (mode: 'flat' | 'grouped') => void;
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
  urlListTotalRecords: number;
  groupedRecords: Record<string, DataRecordRead[]>;
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
  isLoadingUrlList,
  urlListError,
  scrapedContentViewMode,
  setScrapedContentViewMode,
  highlightedRecordId,
  setHighlightedRecordId,
  editableUrls,
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
  urlListTotalRecords,
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

  const [isScheduleDialogOpen, setIsScheduleDialogOpen] = useState(false);
  const [selectedSubImage, setSelectedSubImage] = useState<string | null>(null);

  const highlightedRecordOnPage = React.useMemo(() => {
    if (highlightedRecordId === null) return null;
    for (const urlKey in groupedRecords) {
        const foundRecord = groupedRecords[urlKey].find(r => r.id === highlightedRecordId);
        if (foundRecord) return foundRecord;
    }
    return null;
  }, [highlightedRecordId, groupedRecords]);

  const displayRecord = React.useMemo(() => {
    if (highlightedRecordId === null) return null;
    if (highlightedRecordOnPage) return highlightedRecordOnPage;
    if (fetchedHighlightRecord?.id === highlightedRecordId) return fetchedHighlightRecord;
    return null;
  }, [highlightedRecordOnPage, fetchedHighlightRecord, highlightedRecordId]);

  // Reset selectedSubImage when highlightedRecordId changes or displayRecord becomes null
  React.useEffect(() => {
    setSelectedSubImage(null);
  }, [displayRecord]);

  const renderScheduledIngestionContent = () => {
     const hasChanged =
        enableScheduledIngestion !== initialScheduleState.enabled ||
        (enableScheduledIngestion && ingestionSchedule !== initialScheduleState.schedule);

     return (
        <>
            <div className="p-1 space-y-3">
                 <div className="flex items-center justify-between space-x-2 pt-1">
                    <Label htmlFor="scheduled-ingestion-switch-dialog" className="flex flex-col space-y-0.5">
                        <span className="text-xs font-medium">Enable Scheduled Ingestion</span>
                        <span className="font-normal leading-snug text-muted-foreground text-xs">
                            {enableScheduledIngestion ? "Active" : "Paused/Not created."}
                        </span>
                    </Label>
                    <Switch
                        id="scheduled-ingestion-switch-dialog"
                        checked={enableScheduledIngestion}
                        onCheckedChange={setEnableScheduledIngestion}
                        disabled={isUpdatingSchedule}
                        aria-label="Enable Scheduled Ingestion"
                    />
                </div>
                {enableScheduledIngestion && (
                    <div className="space-y-1 pl-2 ml-1 border-l">
                        <Label htmlFor="ingestion-schedule-dialog" className="text-xs">Schedule (Cron)</Label>
                        <Input
                            id="ingestion-schedule-dialog"
                            value={ingestionSchedule}
                            onChange={(e) => setIngestionSchedule(e.target.value)}
                            placeholder="e.g., 0 0 * * *"
                            className="h-8 text-xs font-mono"
                            disabled={isUpdatingSchedule}
                        />
                        <p className="text-xs text-muted-foreground">
                             {cronExplanation || '5-part cron schedule.'} (UTC)
                        </p>
                    </div>
                )}
                 {localIngestTask && (
                     <div className="text-xs text-muted-foreground pt-2 border-t space-y-0.5">
                         <p>Task: <span className='font-medium text-foreground'>{localIngestTask.name}</span></p>
                         <p>Last Run: {localIngestTask.last_run_at ? formatDistanceToNow(new Date(localIngestTask.last_run_at), { addSuffix: true }) : 'Never'}</p>
                         <p>Status: {localIngestTask.last_run_status ?
                             <Badge variant={localIngestTask.last_run_status === 'success' ? 'default' : 'destructive'} className='text-xs px-1.5 py-0.5'>
                                 {localIngestTask.last_run_status}
                             </Badge> : 'N/A'}
                         </p>
                         {localIngestTask.last_run_message && <p className="truncate" title={localIngestTask.last_run_message}>Msg: {localIngestTask.last_run_message}</p>}
                     </div>
                 )}
            </div>
            <DialogFooter className="pt-3 px-1 pb-1">
                 <Button
                    onClick={() => {
                        handleScheduleUpdate();
                    }}
                    disabled={isUpdatingSchedule || !hasChanged}
                    size="sm"
                    className="h-7 px-2 text-xs"
                 >
                     {isUpdatingSchedule && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
                     Save Schedule
                 </Button>
            </DialogFooter>
        </>
     );
  }

  const originalUrls = (dataSource.origin_details as any)?.urls || [];
  const hasUrlListChanged = JSON.stringify([...editableUrls].sort()) !== JSON.stringify([...originalUrls].sort());

  const [openStates, setOpenStates] = React.useState<Record<string, boolean>>({});

  // --- Determine which image to display as the main image ---
  const mainDisplayImageUrl = selectedSubImage || displayRecord?.top_image || null;

  const findLatestRecordForUrl = (url: string): DataRecordRead | null => {
    const records = groupedRecords[url] || [];
    if (records.length === 0) return null;
    // Sort by event_timestamp descending, nulls last
    const sortedRecords = [...records].sort((a, b) => {
      if (a.event_timestamp && b.event_timestamp) {
        return new Date(b.event_timestamp).getTime() - new Date(a.event_timestamp).getTime();
      }
      if (a.event_timestamp) return -1; // a comes first
      if (b.event_timestamp) return 1;  // b comes first
      return 0; // no preference if both are null
    });
    return sortedRecords[0];
  };

  const getCurrentUrlAndIndex = (): { currentUrl: string | null; currentIndex: number } => {
    if (highlightedRecordId && displayRecord) {
      const recordUrl = (displayRecord.source_metadata as any)?.original_url || 
                        Object.keys(groupedRecords).find(url => groupedRecords[url].some(r => r.id === highlightedRecordId));
      if (recordUrl) {
        const index = editableUrls.indexOf(recordUrl);
        if (index !== -1) return { currentUrl: recordUrl, currentIndex: index };
      }
    }
    // Fallback or if no record is highlighted
    if (editableUrls.length > 0) {
        // Try to find the first open collapsible
        const firstOpenUrl = Object.keys(openStates).find(url => openStates[url] && editableUrls.includes(url));
        if (firstOpenUrl) {
            const index = editableUrls.indexOf(firstOpenUrl);
            if (index !== -1) return { currentUrl: firstOpenUrl, currentIndex: index };
        }
        // Default to the first URL in the list
        return { currentUrl: editableUrls[0], currentIndex: 0 };
    }
    return { currentUrl: null, currentIndex: -1 };
  };

  const { currentUrl, currentIndex } = getCurrentUrlAndIndex();

  const navigateToUrl = (urlIndex: number) => {
    if (urlIndex >= 0 && urlIndex < editableUrls.length) {
      const targetUrl = editableUrls[urlIndex];
      const latestRecord = findLatestRecordForUrl(targetUrl);
      if (latestRecord) {
        setHighlightedRecordId(latestRecord.id);
        setOpenStates(prev => ({ ...prev, [targetUrl]: true }));
      } else {
        // If no records, still open the URL and clear highlight
        setHighlightedRecordId(null);
        setOpenStates(prev => ({ ...prev, [targetUrl]: true }));
      }
    }
  };

  const handlePreviousUrl = () => {
    if (currentIndex > 0) {
      navigateToUrl(currentIndex - 1);
    }
  };

  const handleNextUrl = () => {
    if (currentIndex < editableUrls.length - 1) {
      navigateToUrl(currentIndex + 1);
    }
  };

  return (
    <div className='space-y-6'>
      {/* --- Highlighted Record Display (Full Width) --- */}
       {displayRecord && (
            <Card className="w-full border-primary/30 bg-primary/5">
                <CardHeader className="flex flex-row items-center justify-between py-2 px-4 border-b">
                    <CardTitle className="text-base flex items-center gap-2">
                      Selected Record (ID: {displayRecord.id})
                      {(displayRecord.source_metadata as any)?.original_url &&
                          <a 
                            href={(displayRecord.source_metadata as any)?.original_url} 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="text-primary hover:underline inline-flex items-center text-xs font-normal ml-1" 
                            title={(displayRecord.source_metadata as any)?.original_url}
                            onClick={(e) => e.stopPropagation()}
                          >
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
                     <div className="max-w-full">
                       {renderEditableField(displayRecord, 'title')}
                     </div>
                     {renderEditableField(displayRecord, 'event_timestamp')}

                     {/* --- Image Display Section --- */}
                     {mainDisplayImageUrl && (
                       <div className="my-3 border rounded-md overflow-hidden bg-black flex justify-center items-center max-h-[300px]">
                         <Image
                           src={mainDisplayImageUrl}
                           alt={displayRecord.title || 'Display image'}
                           width={500} // Adjust as needed
                           height={300} // Adjust as needed
                           className="object-contain max-h-full max-w-full"
                           onError={(e) => { e.currentTarget.style.display = 'none'; console.warn('Failed to load main image:', mainDisplayImageUrl); }}
                         />
                       </div>
                     )}

                     {/* {displayRecord.images && displayRecord.images.length > 0 && (
                       <div className="mt-2 pt-2 border-t">
                         <p className="text-xs font-medium text-muted-foreground mb-1.5">Other Images:</p>
                         <ScrollArea className="w-full whitespace-nowrap rounded-md">
                           <div className="flex space-x-2 pb-1">
                             {displayRecord.top_image && !displayRecord.images.includes(displayRecord.top_image) && (
                               <button
                                 key={`thumb-top-image`}
                                 className={cn(
                                   "h-16 w-16 rounded border p-0.5 flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 overflow-hidden relative bg-muted",
                                   (!selectedSubImage) && "ring-2 ring-primary"
                                 )}
                                 onClick={() => setSelectedSubImage(null)} // Selects top_image
                                 title="View top image"
                               >
                                 <Image 
                                   src={displayRecord.top_image} 
                                   alt="Top image thumbnail" 
                                   layout="fill" 
                                   objectFit="cover" 
                                   className="hover:opacity-80 transition-opacity"
                                   onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                  />
                               </button>
                             )}
                             {displayRecord.images.map((imgUrl, index) => (
                               <button
                                 key={`thumb-${index}-${imgUrl}`}
                                 className={cn(
                                   "h-16 w-16 rounded border p-0.5 flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 overflow-hidden relative bg-muted",
                                   selectedSubImage === imgUrl && "ring-2 ring-primary",
                                   !selectedSubImage && displayRecord.top_image === imgUrl && "ring-2 ring-primary" // Also highlight if it's the top_image and no sub-image selected
                                 )}
                                 onClick={() => setSelectedSubImage(imgUrl)}
                                 title={`View image ${index + 1}`}
                               >
                                 <Image 
                                   src={imgUrl} 
                                   alt={`Thumbnail ${index + 1}`} 
                                   layout="fill" 
                                   objectFit="cover" 
                                   className="hover:opacity-80 transition-opacity"
                                   onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                  />
                               </button>
                             ))}
                           </div>
                           <ScrollBar orientation="horizontal" />
                         </ScrollArea>
                       </div>
                     )} */}
                     {/* --- End Image Display Section --- */}

                     <div className="pt-2 border-t">
                        <Label className='text-xs text-muted-foreground'>Text Content</Label>
                        <div className="whitespace-pre-wrap text-sm">
                            {renderTextDisplay(displayRecord.text_content)}
                        </div>
                     </div>
                </CardContent>
            </Card>
        )}

        {/* --- Main URL Management and Content Area --- */}
        <Card>
            <CardHeader className="p-3 flex flex-row items-center justify-between gap-2">
                <div className="flex-shrink min-w-0">
                    <CardTitle className="text-md font-semibold">Source URLs & Content</CardTitle>
                    <CardDescription className="text-xs truncate">
                        Manage URLs, view records ({editableUrls.length} URLs, {urlListTotalRecords} total records). Expand a URL to see its records.
                    </CardDescription>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                    <Button 
                        onClick={handlePreviousUrl}
                        variant="outline"
                        size="icon"
                        disabled={currentIndex <= 0 || editableUrls.length <= 1}
                        className="h-8 w-8"
                        title="Previous URL (latest record)"
                    >
                        <ChevronLeft className="h-4 w-4" />
                        <span className="sr-only">Previous URL</span>
                    </Button>
                    <Button 
                        onClick={handleNextUrl}
                        variant="outline"
                        size="icon"
                        disabled={currentIndex >= editableUrls.length - 1 || editableUrls.length <= 1}
                        className="h-8 w-8"
                        title="Next URL (latest record)"
                    >
                        <ChevronRight className="h-4 w-4" />
                        <span className="sr-only">Next URL</span>
                    </Button>

                    <Input
                        type="url"
                        placeholder="Add URL..."
                        value={newUrlInput}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => setNewUrlInput(e.target.value)}
                        className="h-8 text-sm w-40"
                        onKeyDown={(e) => { if (e.key === 'Enter' && newUrlInput.trim()) handleAddUrl(); }}
                        disabled={isSavingUrls}
                    />
                    <Button 
                        onClick={handleAddUrl} 
                        variant="outline"
                        size="icon"
                        disabled={isSavingUrls || !newUrlInput.trim()} 
                        className="h-8 w-8"
                        title="Add URL"
                    >
                        <PlusCircle className="h-4 w-4" />
                        <span className="sr-only">Add URL</span>
                    </Button>

                    <Dialog open={isScheduleDialogOpen} onOpenChange={setIsScheduleDialogOpen}>
                        <DialogTrigger asChild>
                            <Button variant="outline" size="icon" className="h-8 w-8" title="Schedule Settings">
                                <CalendarClockIcon className="h-4 w-4" />
                                <span className="sr-only">Schedule Settings</span>
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-[425px] p-0">
                            <DialogHeader className="p-3 pb-2 border-b">
                                <DialogTitle className="text-md">Scheduled Ingestion</DialogTitle>
                                <DialogDescription className="text-xs">
                                Configure automatic scraping of source URLs on a regular schedule.
                                </DialogDescription>
                            </DialogHeader>
                            {renderScheduledIngestionContent()}
                        </DialogContent>
                    </Dialog>

                    <Button onClick={handleRefetch} variant="outline" size="icon" disabled={isRefetching || isSavingUrls} className="h-8 w-8" title="Re-fetch All Content">
                        {isRefetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        <span className="sr-only">Re-fetch All Content</span>
                    </Button>

                    <Button
                        onClick={() => setScrapedContentViewMode(scrapedContentViewMode === 'flat' ? 'grouped' : 'flat')}
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        title={scrapedContentViewMode === 'flat' ? "Switch to Grouped View" : "Switch to Flat View"}
                    >
                        {scrapedContentViewMode === 'flat' ? <Columns className="h-4 w-4" /> : <Rows className="h-4 w-4" />}
                        <span className="sr-only">Toggle View Mode</span>
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="pt-3 px-3 pb-3 space-y-3">
                {isLoadingUrlList && !isRefetching ? (
                     <div className="text-center py-8 text-muted-foreground flex items-center justify-center gap-2"><Loader2 className="h-5 w-5 animate-spin" /> Loading URL content...</div>
                ) : urlListError ? (
                     <Alert variant="destructive" className="my-4"><AlertCircle className="h-4 w-4" /><AlertTitle>Error Loading URL Content</AlertTitle><AlertDescription>{urlListError}</AlertDescription></Alert>
                ) : editableUrls.length > 0 ? (
                    <ScrollArea className="max-h-[calc(100vh-400px)] min-h-[150px] overflow-y-auto w-full">
                        <div className="space-y-2 pr-1">
                            {editableUrls.map((url) => {
                                const recordsForThisUrl = groupedRecords[url] || [];
                                const isOpen = !!openStates[url];
                                return (
                                    <Collapsible 
                                        key={url} 
                                        open={isOpen} 
                                        onOpenChange={(open) => {
                                            setOpenStates(prev => ({ ...prev, [url]: open }));
                                            if (open) {
                                                const recordsForThisUrl = groupedRecords[url] || [];
                                                if (recordsForThisUrl.length > 0) {
                                                    setHighlightedRecordId(recordsForThisUrl[0].id);
                                                }
                                            }
                                        }}
                                    >
                                        <Card className="bg-background hover:bg-muted/30 transition-colors shadow-sm overflow-hidden">
                                            <CollapsibleTrigger asChild>
                                                <div className="flex items-center justify-between gap-2 text-sm p-2.5 cursor-pointer group">
                                                    <div className="flex items-center gap-2.5 flex-1 min-w-0">
                                                        <ChevronDown className={cn("h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200", isOpen && "rotate-180")} />
                                                        <span 
                                                            className="truncate text-primary font-medium flex-1 text-xs"
                                                            title={url}
                                                        >
                                                            {url}
                                                        </span>
                                                        <a 
                                                            href={url} 
                                                            target="_blank" 
                                                            rel="noopener noreferrer" 
                                                            title={`Open ${url} in new tab`}
                                                            onClick={(e) => e.stopPropagation()} 
                                                            className="ml-1 text-muted-foreground hover:text-primary shrink-0"
                                                        >
                                                            <ExternalLink className="h-3.5 w-3.5" />
                                                        </a>
                                                        <Badge variant="outline" className="text-xs whitespace-nowrap py-0.5 px-1.5">{recordsForThisUrl.length} record{recordsForThisUrl.length !== 1 ? 's' : ''}</Badge>
                                                    </div>
                                                    <Button 
                                                        variant="ghost" 
                                                        size="icon" 
                                                        className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                                                        onClick={(e) => { 
                                                            e.stopPropagation(); 
                                                            handleRemoveUrl(url); 
                                                        }} 
                                                        disabled={isSavingUrls}
                                                        title="Remove URL"
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                        <span className="sr-only">Remove URL</span>
                                                    </Button>
                                                </div>
                                            </CollapsibleTrigger>
                                            <CollapsibleContent className="border-t bg-muted/20">
                                                <div className="p-2 space-y-1.5">
                                                    {recordsForThisUrl.length > 0 ? (
                                                        recordsForThisUrl.slice(0, 10).map((record) => {
                                                            const isHighlighted = highlightedRecordId === record.id;
                                                            return (
                                                                <div
                                                                    key={record.id}
                                                                    className={cn(
                                                                        "p-1.5 rounded bg-background space-y-0.5 border cursor-pointer transition-colors shadow-sm",
                                                                        isHighlighted ? "bg-primary/10 border-primary/30 ring-1 ring-primary/30" : "hover:bg-primary/5"
                                                                    )}
                                                                    onClick={() => setHighlightedRecordId(isHighlighted ? null : record.id)}
                                                                >
                                                                    <div className="text-xs font-medium text-muted-foreground flex items-center justify-between gap-1 flex-wrap">
                                                                        <span className="text-xs">ID: {record.id}</span>
                                                                        <span className="text-xs text-muted-foreground ml-auto whitespace-nowrap">
                                                                            {record.event_timestamp ? formatDistanceToNow(new Date(record.event_timestamp), { addSuffix: true }) : 'No timestamp'}
                                                                        </span>
                                                                    </div>
                                                                    <p className="text-xs font-medium text-foreground line-clamp-1" title={record.title || undefined}>
                                                                      {record.title || <span className="italic text-muted-foreground">No title</span>}
                                                                    </p>
                                                                </div>
                                                            );
                                                        })
                                                    ) : (
                                                        <p className="text-xs text-muted-foreground italic text-center py-2">No scraped records found (current view).</p>
                                                    )}
                                                    {recordsForThisUrl.length > 10 && (
                                                        <p className="text-xs text-muted-foreground text-center pt-1">Showing first 10 records.</p>
                                                    )}
                                                </div>
                                            </CollapsibleContent>
                                        </Card>
                                    </Collapsible>
                                );
                            })}
                        </div>
                    </ScrollArea>
                ) : (
                     <p className="text-sm text-muted-foreground italic text-center py-8">No URLs added yet. Add URLs above to begin scraping content.</p>
                )}

                {editableUrls.length > 0 && (
                    <div className="flex justify-start pt-3 border-t mt-3">
                        <Button onClick={handleSaveUrls} size="sm" disabled={isSavingUrls || !hasUrlListChanged} className="h-8 px-3 text-xs">
                            {isSavingUrls ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
                            Save URL List Changes
                        </Button>
                    </div>
                )}
            </CardContent>
        </Card>

    </div>
  );
};

export default DocumentDetailViewUrlList;
