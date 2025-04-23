'use client';

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FileText, History, Play, Loader2, ListChecks, Star, ChevronUp, ChevronDown, Plus, Settings2, BookOpen, Eye, Search, XCircle, Repeat } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { format } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from '@/components/ui/use-toast';
import { cn } from "@/lib/utils";
import { useRunHistoryStore, RunHistoryItem } from '@/zustand_stores/storeRunHistory';
import { useFavoriteRunsStore, FavoriteRun } from '@/zustand_stores/storeFavoriteRuns';
import { ClassificationSchemeRead, DataRecordRead, DataSourceRead, ClassificationJobRead, EnhancedClassificationResultRead } from '@/client/models';
import { Label } from '@/components/ui/label';
import { useWorkspaceStore } from '@/zustand_stores/storeWorkspace';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from "@/components/ui/progress";
import { useClassificationSystem } from '@/hooks/useClassificationSystem';
import { FormattedClassificationResult } from '@/lib/classification/types';
import { SchemePreview } from '@/components/collection/workspaces/classifications/schemaCreation/SchemePreview';
import { transformApiToFormData } from '@/lib/classification/service';
import ClassificationSchemeEditor from './ClassificationSchemeEditor';

// --- Sub-components ---

const FavoriteRunsDisplay: React.FC<{
  runs: FavoriteRun[];
  activeRunId: number | null;
  onSelectRun: (runId: number, runName: string, runDescription?: string) => void;
}> = ({ runs, activeRunId, onSelectRun }) => {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="whitespace-nowrap">
          <Star className="h-4 w-4 mr-2 fill-yellow-400 text-yellow-400" />
          <span className="hidden sm:inline">Favorites</span> ({runs.length})
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="center" className="w-80 p-0">
        <div className="p-3">
          <h4 className="font-medium text-center mb-2">Favorite Runs</h4>
          <ScrollArea className="max-h-60">
            <div className="space-y-2">
              {runs.length > 0 ? (
                runs.map(run => (
                  <div
                    key={run.id}
                    className={cn(
                      "p-2 rounded border cursor-pointer hover:bg-muted/50 transition-colors",
                      activeRunId === run.id && "bg-muted border-primary"
                    )}
                    onClick={() => onSelectRun(run.id, run.name, run.description)}
                  >
                    <div className="font-medium text-sm">{run.name}</div>
                    <div className="flex gap-2 mt-1 text-xs text-muted-foreground">
                      <div>{run.timestamp}</div>
                      <div>•</div>
                      <div>{run.documentCount} docs</div>
                      <div>•</div>
                      <div>{run.schemeCount} schemes</div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-4 text-muted-foreground text-sm">
                  No favorite runs yet
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </PopoverContent>
    </Popover>
  );
};

const RunHistoryPanel: React.FC<{
  runs: RunHistoryItem[];
  activeRunId?: number | null;
  onSelectRun: (runId: number, runName: string, runDescription?: string) => void;
  onToggleFavorite?: (run: RunHistoryItem) => void;
  favoriteRunIds?: number[];
}> = ({ runs, activeRunId, onSelectRun, onToggleFavorite, favoriteRunIds = [] }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'date' | 'name'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Filter runs based on search term
  const filteredRuns = useMemo(() => {
    return runs.filter(run =>
      run.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [runs, searchTerm]);

  // Sort runs based on criteria
  const sortedRuns = useMemo(() => {
    return [...filteredRuns].sort((a, b) => {
      if (sortBy === 'date') {
        // Attempt to parse potentially varied date formats
        const parseDate = (ts: string): number => {
          try {
            // Handle "Month Day, Year at HH:MM:SS AM/PM" format from date-fns 'PPp'
            const date = new Date(ts.replace(' at ', ' '));
            if (!isNaN(date.getTime())) return date.getTime();
          } catch (e) { /* ignore parsing errors */ }
          // Fallback for ISO strings or other formats Date can parse
          try {
            const date = new Date(ts);
            if (!isNaN(date.getTime())) return date.getTime();
          } catch (e) { /* ignore parsing errors */ }
          return 0; // Fallback if parsing fails completely
        };
        const timeA = parseDate(a.timestamp);
        const timeB = parseDate(b.timestamp);
        if (timeA === 0 || timeB === 0) return 0; // Don't sort if parsing failed

        return sortOrder === 'asc'
          ? timeA - timeB
          : timeB - timeA;
      } else {
        return sortOrder === 'asc'
          ? a.name.localeCompare(b.name)
          : b.name.localeCompare(a.name);
      }
    });
  }, [filteredRuns, sortBy, sortOrder]);

  // Find the active run
  const activeRun = useMemo(() => {
    return runs.find(run => run.id === activeRunId);
  }, [runs, activeRunId]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 mb-4">
        <Input
          placeholder="Search runs..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="flex-1"
        />
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="icon">
              <Settings2 className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-3">
            <div className="space-y-2">
              <h4 className="font-medium text-sm">Sort Options</h4>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Sort by</Label>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={sortBy === 'date' ? 'default' : 'outline'}
                    onClick={() => setSortBy('date')}
                    className="flex-1 h-8"
                  >
                    Date
                  </Button>
                  <Button
                    size="sm"
                    variant={sortBy === 'name' ? 'default' : 'outline'}
                    onClick={() => setSortBy('name')}
                    className="flex-1 h-8"
                  >
                    Name
                  </Button>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Order</Label>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={sortOrder === 'asc' ? 'default' : 'outline'}
                    onClick={() => setSortOrder('asc')}
                    className="flex-1 h-8"
                  >
                    Ascending
                  </Button>
                  <Button
                    size="sm"
                    variant={sortOrder === 'desc' ? 'default' : 'outline'}
                    onClick={() => setSortOrder('desc')}
                    className="flex-1 h-8"
                  >
                    Descending
                  </Button>
                </div>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <ScrollArea className="flex-1">
        {sortedRuns.length > 0 ? (
          <div className="space-y-2">
            {sortedRuns.map((run) => {
               // Check for recurring task ID - be more explicit about type check
               const config = run.configuration as any; // Keep casting if type isn't precise
               const recurringTaskIdValue: unknown = config?.recurring_task_id; // Use unknown first

               // Explicitly check if it's a number
               const isRecurring = typeof recurringTaskIdValue === 'number';
               const recurringTaskIdNumber = isRecurring ? recurringTaskIdValue : null; // Store the number or null

               return (
                 <div
                   key={run.id}
                   className={cn(
                     "p-3 rounded-md border cursor-pointer hover:bg-muted/50 transition-colors",
                     activeRunId === run.id && "bg-muted border-primary"
                   )}
                   onClick={() => onSelectRun(run.id, run.name, run.description)}
                 >
                   <div className="flex items-center justify-between">
                     {/* Wrap name and potential icon in a div for alignment */}
                     <div className="flex items-center gap-1.5">
                       <span className="font-medium truncate" title={run.name}>{run.name}</span>
                       {/* Add Icon and Tooltip if recurring */}
                       {isRecurring && ( // Use the boolean flag derived from the type check
                         <TooltipProvider delayDuration={100}>
                           <Tooltip>
                             <TooltipTrigger asChild>
                               {/* Icon acts as the trigger */}
                               <Repeat className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                             </TooltipTrigger>
                             <TooltipContent>
                               {/* Render only if it's confirmed to be a number */}
                               <p>Recurring Run (Task ID: {recurringTaskIdNumber})</p>
                             </TooltipContent>
                           </Tooltip>
                         </TooltipProvider>
                       )}
                     </div>
                     {/* Favorite Button */}
                     {onToggleFavorite && (
                       <Button
                         variant="ghost"
                         size="icon"
                         onClick={(e) => {
                           e.stopPropagation();
                           onToggleFavorite(run);
                         }}
                         className="h-6 w-6"
                       >
                         {(favoriteRunIds ?? []).includes(run.id) ? (
                           <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                         ) : (
                           <Star className="h-4 w-4" />
                         )}
                       </Button>
                     )}
                   </div>
                   <div className="text-sm text-muted-foreground mt-1">
                     {run.timestamp}
                   </div>
                   <div className="flex gap-3 mt-2 text-xs text-muted-foreground">
                     <div>{run.documentCount} documents</div>
                     <div>{run.schemeCount} schemes</div>
                   </div>
                 </div>
               );
             })}
          </div>
        ) : runs.length === 0 && !searchTerm ? ( // Adjusted condition for clarity
          <div className="text-center py-8 text-muted-foreground">
            No run history available
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            No runs match your search
          </div>
        )}
      </ScrollArea>
    </div>
  );
};

function RunHistoryDialog({
  isOpen,
  onClose,
  activeRunId,
  onSelectRun
}: {
  isOpen: boolean;
  onClose: () => void;
  activeRunId: number | null;
  onSelectRun: (runId: number, runName: string, runDescription?: string) => void
}) {
  const { runs, isLoading, fetchRunHistory } = useRunHistoryStore();
  const { favoriteRuns, addFavoriteRun, removeFavoriteRun, isFavorite } = useFavoriteRunsStore();
  const { activeWorkspace } = useWorkspaceStore();
  const intervalRef = useRef<NodeJS.Timeout | null>(null); // Ref for the fetch interval

  // Get favorite run IDs
  const favoriteRunIds = useMemo(() => {
    return favoriteRuns.map(run => run.id);
  }, [favoriteRuns]);

  // Memoized toggle handler
  const handleToggleFavoriteRun = useCallback((run: RunHistoryItem) => {
    const workspaceId = activeWorkspace?.id || '';
    if (isFavorite(run.id)) {
      removeFavoriteRun(run.id);
    } else {
      addFavoriteRun({
        id: run.id,
        name: run.name,
        timestamp: run.timestamp,
        documentCount: run.documentCount || 0,
        schemeCount: run.schemeCount || 0,
        workspaceId: String(workspaceId),
        description: run.description
      });
    }
  }, [activeWorkspace?.id, isFavorite, addFavoriteRun, removeFavoriteRun]);

  // Manual refresh handler
  const handleManualRefresh = useCallback(() => {
      if (activeWorkspace?.id) {
        const workspaceId = activeWorkspace.id;
        if (!isNaN(workspaceId)) {
          fetchRunHistory(workspaceId);
        }
      }
  }, [activeWorkspace?.id, fetchRunHistory]);

  // Simplified handleOpenChange
  const handleOpenChange = (open: boolean) => {
    if (!open) {
       onClose();
    }
    // Fetching logic is handled by the useEffect hook.
  };

  // useEffect for initial and periodic history fetching
  useEffect(() => {
    const currentWorkspaceId = activeWorkspace?.id;

    const fetchData = async () => {
      // Re-check conditions inside the fetch function/interval callback
      // Use Zustand's getState to get the latest values non-reactively
      const latestWorkspaceId = useWorkspaceStore.getState().activeWorkspace?.id;
      const latestIsLoading = useRunHistoryStore.getState().isLoading;
      const workspaceIdNum = typeof latestWorkspaceId === 'number' ? latestWorkspaceId : parseInt(latestWorkspaceId || '', 10);

      // Ensure the dialog is still open, workspace hasn't changed, it's a valid ID, and not already loading
      if (useRunHistoryStore.getState().runs && // Check if dialog state is still open via proxy (runs exist)
          latestWorkspaceId === currentWorkspaceId &&
          !isNaN(workspaceIdNum) &&
          !latestIsLoading) {
        try {
          await fetchRunHistory(workspaceIdNum);
        } catch (error) {
          // Handle fetch errors silently or log to a proper service
        }
      }
    };

    if (isOpen && currentWorkspaceId && !isNaN(currentWorkspaceId)) {
      // Initial fetch when dialog opens
      fetchData();

      // Clear any existing interval before setting a new one
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }

      // Set up interval for periodic fetching
      intervalRef.current = setInterval(fetchData, 5000); // Fetch every 5 seconds
    } else {
      // If dialog is closed or workspace is invalid, clear interval
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    // Cleanup function: Clears interval when the component unmounts or dependencies change
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
    // Dependencies: Effect runs when dialog opens/closes or workspace changes
  }, [isOpen, activeWorkspace?.id, fetchRunHistory]);

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[600px] h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Run History</DialogTitle>
          <DialogDescription>
            Select a previous run to load its results into the runner
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden py-4">
          {isLoading && runs.length === 0 ? ( // Show loading only on initial load or if runs are empty
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="ml-2">Loading run history...</span>
            </div>
          ) : (
            <RunHistoryPanel
              runs={runs}
              activeRunId={activeRunId}
              onSelectRun={onSelectRun}
              favoriteRunIds={favoriteRunIds}
              onToggleFavorite={handleToggleFavoriteRun}
            />
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button
            variant="default"
            onClick={handleManualRefresh}
            disabled={isLoading}
            className="mr-auto"
          >
            <History className="h-4 w-4 mr-2" />
            Refresh History
            {isLoading && <Loader2 className="h-4 w-4 ml-2 animate-spin" />}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- NEW: Document Selector Component ---
interface DocumentSelectorForRunProps {
  allDataSources: DataSourceRead[];
  selectedDocIds: number[];
  onToggleDoc: (docId: number) => void;
  onSelectAll: (selectAll: boolean) => void;
}

const DocumentSelectorForRun: React.FC<DocumentSelectorForRunProps> = ({
  allDataSources,
  selectedDocIds,
  onToggleDoc,
  onSelectAll,
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredDocuments = useMemo(() => {
    return allDataSources.filter(source =>
      source.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [allDataSources, searchTerm]);

  const handleSelectAllClick = (checked: boolean | string) => {
    onSelectAll(checked === true);
  };

  return (
    <div className="flex flex-col space-y-3">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Filter Data Sources..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-8 h-9"
        />
      </div>
      <div className="flex items-center">
        <Checkbox
          id="select-all-docs"
          checked={selectedDocIds.length === filteredDocuments.length && filteredDocuments.length > 0}
          onCheckedChange={(checked) => onSelectAll(checked === true)}
        />
        <Label htmlFor="select-all-docs" className="ml-2 text-sm font-medium">
          Select All ({filteredDocuments.length})
        </Label>
      </div>
      <ScrollArea className="h-[200px] border rounded-md p-2">
        <div className="space-y-1">
          {filteredDocuments.map((doc) => (
            <div key={doc.id} className="flex items-center justify-between text-sm p-1.5 hover:bg-muted/50 rounded">
              <div className="flex items-center space-x-2 overflow-hidden">
                <Checkbox
                  id={`doc-${doc.id}`}
                  checked={selectedDocIds.includes(doc.id)}
                  onCheckedChange={() => onToggleDoc(doc.id)}
                  className="shrink-0"
                />
                <Label htmlFor={`doc-${doc.id}`} className="truncate cursor-pointer" title={doc.name}>
                  {doc.name}
                </Label>
              </div>
            </div>
          ))}
          {filteredDocuments.length === 0 && (
            <p className="text-sm text-muted-foreground text-center italic py-4">No data sources found.</p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

// --- NEW: Scheme Selector Component ---
interface SchemeSelectorForRunProps {
  allSchemes: ClassificationSchemeRead[];
  selectedSchemeIds: number[];
  onToggleScheme: (schemeId: number) => void;
  onSelectAll: (selectAll: boolean) => void;
  onPreviewScheme: (scheme: ClassificationSchemeRead) => void;
}

const SchemeSelectorForRun: React.FC<SchemeSelectorForRunProps> = ({
  allSchemes,
  selectedSchemeIds,
  onToggleScheme,
  onSelectAll,
  onPreviewScheme,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const areAllSelected = allSchemes.length > 0 && selectedSchemeIds.length === allSchemes.length;

  const filteredSchemes = useMemo(() => {
    return allSchemes.filter(scheme =>
      scheme.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [allSchemes, searchTerm]);

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Select Schemes for Run</h4>
         <TooltipProvider delayDuration={100}>
           <Tooltip>
             <TooltipTrigger asChild>
               <Checkbox
                 id="select-all-schemes-run"
                 checked={areAllSelected}
                 onCheckedChange={(checked) => onSelectAll(!!checked)}
                 aria-label="Select all schemes for run"
               />
             </TooltipTrigger>
             <TooltipContent><p>Select/Deselect All</p></TooltipContent>
           </Tooltip>
         </TooltipProvider>
      </div>
      <Input
        placeholder="Search schemes..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        className="h-8"
      />
      <ScrollArea className="h-72 border rounded-md p-2">
        {filteredSchemes.length > 0 ? (
          <div className="space-y-2">
            {filteredSchemes.map(scheme => (
              <div key={scheme.id} className="flex items-center space-x-2 group">
                <Checkbox
                  id={`run-scheme-${scheme.id}`}
                  checked={selectedSchemeIds.includes(scheme.id)}
                  onCheckedChange={() => onToggleScheme(scheme.id)}
                />
                <label
                  htmlFor={`run-scheme-${scheme.id}`}
                  className="text-sm font-medium leading-none flex-1 truncate cursor-pointer"
                  title={scheme.name}
                >
                  {scheme.name}
                </label>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => onPreviewScheme(scheme)}
                >
                  <Eye className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center text-muted-foreground text-sm py-4">No schemes match search.</div>
        )}
      </ScrollArea>
      <div className="text-xs text-muted-foreground pt-1">{selectedSchemeIds.length} of {allSchemes.length} selected</div>
    </div>
  );
};

// --- MODIFIED: Props interface ---
interface ClassificationRunnerDockProps {
  allDataSources: DataSourceRead[];
  allSchemes: ClassificationSchemeRead[];
  onCreateJob: (dataSourceIds: number[], schemeIds: number[], name?: string, description?: string) => Promise<void>;
  onLoadJob: (jobId: number, jobName: string, jobDescription?: string) => void;
  activeJobId: number | null;
  isCreatingJob: boolean;
  onClearJob: () => void;
}

export default function ClassificationRunnerDock({
  allDataSources,
  allSchemes,
  onCreateJob,
  onLoadJob,
  activeJobId,
  isCreatingJob,
  onClearJob,
}: ClassificationRunnerDockProps) {
  const { activeWorkspace } = useWorkspaceStore();
  const { favoriteRuns } = useFavoriteRunsStore();
  const { runs: runHistoryStore } = useRunHistoryStore();

  // --- Local State for Dock ---
  const [selectedDataSourceIds, setSelectedDataSourceIds] = useState<number[]>([]);
  const [selectedSchemeIds, setSelectedSchemeIds] = useState<number[]>([]);
  const [newJobName, setNewJobName] = useState<string>('');
  const [newJobDescription, setNewJobDescription] = useState<string>('');
  const [isHistoryDialogOpen, setIsHistoryDialogOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isPreviewDialogOpen, setIsPreviewDialogOpen] = useState(false);
  const [previewScheme, setPreviewScheme] = useState<ClassificationSchemeRead | null>(null);
  const { toast } = useToast();

  // Auto-load logic refs (similar to old dock)
  const initialLoadAttemptedRef = useRef(false);
  const attemptedWorkspaceIdRef = useRef<number | null>(null); // Use number for ID

  // Memoized Favorite Runs for current workspace
  const currentFavoriteRuns = useMemo(() => {
    const workspaceIdNum = activeWorkspace?.id;
    if (workspaceIdNum === undefined || workspaceIdNum === null) return [];
    return favoriteRuns.filter(run => Number(run.workspaceId) === workspaceIdNum); // Ensure comparison is number vs number
  }, [favoriteRuns, activeWorkspace?.id]);

  // --- Auto-loading last favorite run effect (similar to old dock) ---
  const handleLoadJobInternal = useCallback((jobId: number, name: string, desc?: string) => {
      onLoadJob(jobId, name, desc);
      setIsHistoryDialogOpen(false); // Close dialog if open
      // Optionally expand the dock or give feedback
  }, [onLoadJob]);

  useEffect(() => {
      const currentWorkspaceIdNum = activeWorkspace?.id;

      if (currentWorkspaceIdNum !== attemptedWorkspaceIdRef.current) {
          // Workspace changed, reset auto-load flag.
          initialLoadAttemptedRef.current = false;
          attemptedWorkspaceIdRef.current = currentWorkspaceIdNum ?? null;
      }

      if (currentWorkspaceIdNum === undefined || currentWorkspaceIdNum === null) {
          return;
      }

      if (!initialLoadAttemptedRef.current) {
          if (activeJobId === null) {
              // Initial check: No job active. Mark auto-load attempted.
              initialLoadAttemptedRef.current = true;

              if (favoriteRuns.length > 0) {
                  const workspaceFavorites = favoriteRuns.filter(run => Number(run.workspaceId) === currentWorkspaceIdNum);
                  if (workspaceFavorites.length > 0) {
                      const parseDate = (ts: string): number => {
                         try { const date = new Date(ts.replace(' at ', ' ')); if (!isNaN(date.getTime())) return date.getTime(); } catch (e) {}
                         try { const date = new Date(ts); if (!isNaN(date.getTime())) return date.getTime(); } catch (e) {}
                         return 0;
                      };
                      const sortedFavorites = [...workspaceFavorites].sort((a, b) => parseDate(b.timestamp) - parseDate(a.timestamp));
                      const lastFavorite = sortedFavorites[0];
                      // Use timeout to ensure it runs after initial render settles
                      const timer = setTimeout(() => {
                          // Re-check activeJobId inside timeout
                          if (useWorkspaceStore.getState().activeWorkspace?.id === currentWorkspaceIdNum && activeJobId === null) {
                              handleLoadJobInternal(lastFavorite.id, lastFavorite.name, lastFavorite.description);
                          }
                      }, 150);
                      return () => clearTimeout(timer);
                  }
              }
          } else {
              // Initial check: Job active. Mark auto-load bypassed.
              initialLoadAttemptedRef.current = true;
          }
      }
  }, [activeWorkspace?.id, favoriteRuns, activeJobId, handleLoadJobInternal]); // Added activeJobId dependency

  // --- Click handler for starting a job ---
  const handleRunClick = async () => {
    if (selectedDataSourceIds.length === 0 || selectedSchemeIds.length === 0) {
      toast({
        title: "Missing Selection",
        description: "Please select data sources and schemes for the job.",
        variant: "default"
      });
      return;
    }
    await onCreateJob(selectedDataSourceIds, selectedSchemeIds, newJobName || undefined, newJobDescription || undefined);
    // Optionally clear inputs after starting
    setNewJobName('');
    setNewJobDescription('');
    // Decide whether to clear selections
    // setSelectedDataSourceIds([]);
    // setSelectedSchemeIds([]);
  };

  // --- Handlers for the selectors ---
  const handleDataSourceToggle = (id: number) => {
    setSelectedDataSourceIds(prev =>
      prev.includes(id) ? prev.filter(dsId => dsId !== id) : [...prev, id]
    );
  };

  const handleSchemeToggle = (id: number) => {
    setSelectedSchemeIds(prev =>
      prev.includes(id) ? prev.filter(sId => sId !== id) : [...prev, id]
    );
  };

  const handleSelectAllDataSources = (selectAll: boolean) => {
    setSelectedDataSourceIds(selectAll ? allDataSources.map(d => d.id) : []);
  };

  const handleSelectAllSchemes = (selectAll: boolean) => {
    setSelectedSchemeIds(selectAll ? allSchemes.map(s => s.id) : []);
  };

  const handlePreviewSchemeClick = (scheme: ClassificationSchemeRead) => {
    setPreviewScheme(scheme);
    setIsPreviewDialogOpen(true);
  };

  const [isSchemeEditorOpen, setIsSchemeEditorOpen] = useState(false);
  const [schemeEditorMode, setSchemeEditorMode] = useState<'create' | 'edit' | 'watch'>('create');
  const [schemeToEdit, setSchemeToEdit] = useState<ClassificationSchemeRead | null>(null);

  // Hook to load schemes if needed by the editor or selectors
  const { loadSchemes: refreshSchemesFromHook } = useClassificationSystem();

  // --- Handler to open the scheme editor ---
  const handleOpenSchemeEditor = (mode: 'create' | 'edit' | 'watch', scheme?: ClassificationSchemeRead) => {
    setSchemeEditorMode(mode);
    setSchemeToEdit(scheme || null);
    setIsSchemeEditorOpen(true);
  };

  // --- Handler after scheme editor closes (e.g., refresh list) ---
  const handleCloseSchemeEditor = async () => {
    setIsSchemeEditorOpen(false);
    setSchemeToEdit(null);
    // Refresh schemes list after potential creation/edit
    await refreshSchemesFromHook(true); // Force refresh
  };

  return (
    <TooltipProvider>
      {/* Floating Dock container */}
      <div className={cn(
        "fixed bottom-4 left-1/2 transform -translate-x-1/2",
        "flex flex-col",
        "w-auto max-w-[95vw] lg:max-w-[1000px]",
        "border bg-card text-card-foreground rounded-lg shadow-lg",
        "z-40 transition-all duration-200" // Increased z-index
      )}>
        {/* Dock Header - Make clickable */}
        <div
          className="flex items-center justify-between px-4 py-2 border-b cursor-pointer hover:bg-muted/50" // Added cursor-pointer and hover
          onClick={() => setIsExpanded(!isExpanded)} // Toggle on header click
        >
          <div className="flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-medium">Classification Job Runner</h3>
            {activeJobId && (
              <Badge variant="outline" className="ml-2 text-xs">
                Job #{activeJobId} Loaded
              </Badge>
            )}
          </div>
          {/* Keep the button for explicit toggle indication, but header is also clickable */}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }} // Prevent header click from double-toggling
          >
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </Button>
        </div>

        {/* Dock Content - Expandable */}
        <div className={cn(
          "grid grid-cols-1 gap-4 p-4",
           isExpanded ? "max-h-[80vh] overflow-y-auto opacity-100" : "max-h-0 opacity-0 overflow-hidden p-0"
        )}>
          {/* Row 1: History & Favorites */}
          <div className="flex items-center gap-2 justify-end">
              {/* <Label className="text-sm font-medium whitespace-nowrap">Model:</Label> */}
              {/* <ProviderSelector className="flex-1" /> */} {/* Re-add if needed */}
              <Button
                variant="outline"
                onClick={() => setIsHistoryDialogOpen(true)}
                size="sm"
                className="whitespace-nowrap"
              >
                <History className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Load Job</span> {/* Updated text */}
              </Button>

              {currentFavoriteRuns.length > 0 && (
                <FavoriteRunsDisplay
                  runs={currentFavoriteRuns}
                  activeRunId={activeJobId} // Pass activeJobId
                  onSelectRun={handleLoadJobInternal} // Use internal handler
                />
              )}
          </div>

          {/* Row 2: Job Configuration */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Left side: Job metadata */}
            <div className="space-y-3">
              <div className="w-full">
                <Label htmlFor="new-job-name-dock" className="text-xs font-medium">Job Name (Optional)</Label>
                <Input
                  id="new-job-name-dock"
                  placeholder={`Job - ${format(new Date(), 'yyyy-MM-dd HH:mm')}`}
                  value={newJobName}
                  onChange={(e) => setNewJobName(e.target.value)}
                  className="h-9 text-sm"
                />
              </div>

              <div className="w-full">
                <Label htmlFor="new-job-description-dock" className="text-xs font-medium">Description (Optional)</Label>
                <Textarea
                  id="new-job-description-dock"
                  placeholder="Purpose of this classification job..."
                  value={newJobDescription}
                  onChange={(e) => setNewJobDescription(e.target.value)}
                  className="h-20 text-sm resize-none"
                />
              </div>
            </div>

            {/* Right side: Start Button */}
            <div className="flex flex-col justify-end gap-3">
              <div className="flex flex-col items-end">
                <Button
                  variant="default"
                  onClick={handleRunClick}
                  disabled={isCreatingJob || selectedDataSourceIds.length === 0 || selectedSchemeIds.length === 0}
                  className="w-full md:w-auto"
                  size="default"
                >
                  {isCreatingJob ? (
                    <div className="flex items-center justify-center">
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      <span>Creating Job...</span>
                    </div>
                  ) : (
                    <>
                      <Play className="h-4 w-4 mr-2" />
                      Create & Start Job
                    </>
                  )}
                </Button>
                 {/* Re-add Progress Bar if needed */}
                 {/* {isCreatingJob && classificationProgress && classificationProgress.total > 0 && (
                   <Progress value={(classificationProgress.current / classificationProgress.total) * 100} className="mt-2 h-2 w-full md:w-[200px]" />
                 )} */}
              </div>
            </div>
          </div>

          {/* Row 3: Document and Scheme Selection */}
           <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t pt-4">
                <div className="flex flex-col overflow-hidden">
                  {/* TODO: Replace with card-based selector */}
                  <DocumentSelectorForRun
                      allDataSources={allDataSources}
                      selectedDocIds={selectedDataSourceIds}
                      onToggleDoc={handleDataSourceToggle}
                      onSelectAll={handleSelectAllDataSources}
                  />
                </div>
                <div className="flex flex-col overflow-hidden">
                  {/* Add "Create Scheme" button here */}
                  <div className="flex justify-between items-center mb-1">
                     <h4 className="text-sm font-medium">Select Schemes</h4>
                     <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleOpenSchemeEditor('create')}
                        className="h-7 px-2 text-xs"
                     >
                        <Plus className="h-3.5 w-3.5 mr-1"/> Create New
                     </Button>
                  </div>
                  {/* TODO: Replace with card-based selector */}
                  <SchemeSelectorForRun
                      allSchemes={allSchemes}
                      selectedSchemeIds={selectedSchemeIds}
                      onToggleScheme={handleSchemeToggle}
                      onSelectAll={handleSelectAllSchemes}
                      onPreviewScheme={handlePreviewSchemeClick} // Keep preview
                  />
                </div>
           </div>
        </div>

        {/* Compact View - When collapsed */}
        <div className={cn(
          "flex items-center justify-between px-4 py-2",
           isExpanded ? "max-h-0 opacity-0 overflow-hidden p-0" : "max-h-[50px] opacity-100" // Corrected visibility logic
        )}>
          <div className="flex items-center gap-3">
             {/* Clear Button - Fix onClick */}
            {activeJobId !== null && (
                 <Tooltip>
                   <TooltipTrigger asChild>
                      <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-muted-foreground hover:text-destructive"
                          onClick={(e) => { e.stopPropagation(); onClearJob(); }} // Call onClearJob directly
                      >
                          <XCircle className="h-3.5 w-3.5" />
                      </Button>
                   </TooltipTrigger>
                   <TooltipContent>
                       <p>Clear Loaded Job</p>
                   </TooltipContent>
                 </Tooltip>
             )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => { e.stopPropagation(); setIsHistoryDialogOpen(true); }} // Stop propagation
                  className="h-8"
                >
                  <History className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent><p>Load previous job</p></TooltipContent>
            </Tooltip>
             <Button
              variant="default"
              onClick={(e) => { e.stopPropagation(); handleRunClick(); }} // Stop propagation
              disabled={isCreatingJob || selectedDataSourceIds.length === 0 || selectedSchemeIds.length === 0}
              size="sm"
              className="h-8"
            >
              {isCreatingJob ? (<Loader2 className="h-3.5 w-3.5 animate-spin" />) : (<Play className="h-3.5 w-3.5" />)}
              {!isCreatingJob && <span className="ml-1.5">Create Job</span>}
            </Button>
          </div>
          {/* Make sure the expand button in compact view also stops propagation */}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }}
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Dialogs (remain outside the dock) */}
      <RunHistoryDialog
        isOpen={isHistoryDialogOpen}
        onClose={() => setIsHistoryDialogOpen(false)}
        activeRunId={activeJobId} // Pass activeJobId
        onSelectRun={handleLoadJobInternal} // Pass internal handler
      />

      {/* Scheme Preview Dialog */}
      <Dialog open={isPreviewDialogOpen} onOpenChange={setIsPreviewDialogOpen}>
         <DialogContent className="max-w-2xl">
           <DialogHeader>
             <DialogTitle>Scheme Preview: {previewScheme?.name}</DialogTitle>
           </DialogHeader>
           <ScrollArea className="max-h-[70vh] p-1">
              {/* Use SchemePreview component */}
             {previewScheme && <SchemePreview scheme={transformApiToFormData(previewScheme)} />}
           </ScrollArea>
           <DialogFooter>
             <Button variant="outline" onClick={() => setIsPreviewDialogOpen(false)}>Close</Button>
           </DialogFooter>
         </DialogContent>
      </Dialog>

      {/* Scheme Editor Dialog */}
       <ClassificationSchemeEditor
           key={schemeToEdit?.id || 'create-scheme'} // Use key for re-rendering
           show={isSchemeEditorOpen}
           mode={schemeEditorMode}
           defaultValues={schemeToEdit}
           onClose={handleCloseSchemeEditor}
       />

    </TooltipProvider>
  );
}