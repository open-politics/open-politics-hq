'use client';

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FileText, History, Play, Loader2, ListChecks, Star, ChevronUp, ChevronDown, Plus, Settings2, BookOpen } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { format } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import ProviderSelector from '@/components/collection/workspaces/management/ProviderSelector';
import { useToast } from '@/components/ui/use-toast';
import { cn } from "@/lib/utils";
import { useRunHistoryStore, RunHistoryItem } from '@/zustand_stores/storeRunHistory';
import { useFavoriteRunsStore, FavoriteRun } from '@/zustand_stores/storeFavoriteRuns';
import { ClassificationSchemeRead, DocumentRead } from '@/client/models';
import { Label } from '@/components/ui/label';
import { useClassificationSystem } from '@/hooks/useClassificationSystem';
import { useWorkspaceStore } from '@/zustand_stores/storeWorkspace';
import DocumentManagerOverlay from '../documents/DocumentManagerOverlay';
import SchemeManagerOverlay from './ClassificationSchemeManagerOverlay';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { Checkbox } from '@/components/ui/checkbox';

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
            {sortedRuns.map((run) => (
              <div
                key={run.id}
                className={cn(
                  "p-3 rounded-md border cursor-pointer hover:bg-muted/50 transition-colors",
                  activeRunId === run.id && "bg-muted border-primary"
                )}
                onClick={() => onSelectRun(run.id, run.name, run.description)}
              >
                <div className="flex items-center justify-between">
                  <div className="font-medium">{run.name}</div>
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
            ))}
          </div>
        ) : searchTerm ? (
          <div className="text-center py-8 text-muted-foreground">
            No runs match your search
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            No run history available
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

  // Get favorite run IDs
  const favoriteRunIds = useMemo(() => {
    return favoriteRuns.map(run => run.id);
  }, [favoriteRuns]);

  // Memoized toggle handler
  const handleToggleFavoriteRun = useCallback((run: RunHistoryItem) => {
    const workspaceId = activeWorkspace?.uid || '';
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
  }, [activeWorkspace?.uid, isFavorite, addFavoriteRun, removeFavoriteRun]);

  // Manual refresh handler (kept)
  const handleManualRefresh = useCallback(() => {
      if (activeWorkspace?.uid) {
        const workspaceId = typeof activeWorkspace.uid === 'string'
          ? parseInt(activeWorkspace.uid, 10)
          : activeWorkspace.uid;

        if (!isNaN(workspaceId)) {
          console.log("[RunHistoryDialog] Manual refresh triggered.");
          fetchRunHistory(workspaceId);
        }
      }
  }, [activeWorkspace?.uid, fetchRunHistory]);

  // --- ADDED: Function to handle fetch when dialog opens ---
  const handleOpenChange = (open: boolean) => {
    if (open && !isLoading && activeWorkspace?.uid) {
       // Fetch only when transitioning to open state
       const workspaceId = typeof activeWorkspace.uid === 'string'
         ? parseInt(activeWorkspace.uid, 10)
         : activeWorkspace.uid;

       if (!isNaN(workspaceId)) {
         console.log("[RunHistoryDialog] Dialog opening, fetching history...");
         fetchRunHistory(workspaceId);
       } else {
         console.warn("[RunHistoryDialog] Workspace ID is invalid, cannot fetch history.");
       }
    } else if (!open) {
       // Call the original onClose handler when closing
       onClose();
    }
  };

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
          {isLoading ? (
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
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- NEW: Document Selector Component ---
interface DocumentSelectorForRunProps {
  allDocuments: DocumentRead[];
  selectedDocIds: number[];
  onToggleDoc: (docId: number) => void;
  onSelectAll: (selectAll: boolean) => void;
}

const DocumentSelectorForRun: React.FC<DocumentSelectorForRunProps> = ({
  allDocuments,
  selectedDocIds,
  onToggleDoc,
  onSelectAll,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const areAllSelected = allDocuments.length > 0 && selectedDocIds.length === allDocuments.length;

  const filteredDocuments = useMemo(() => {
    return allDocuments.filter(doc =>
      doc.title?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [allDocuments, searchTerm]);

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Select Documents for Run</h4>
         <TooltipProvider delayDuration={100}>
           <Tooltip>
             <TooltipTrigger asChild>
               <Checkbox
                 id="select-all-docs-run"
                 checked={areAllSelected}
                 onCheckedChange={(checked) => onSelectAll(!!checked)}
                 aria-label="Select all documents for run"
               />
             </TooltipTrigger>
             <TooltipContent><p>Select/Deselect All</p></TooltipContent>
           </Tooltip>
         </TooltipProvider>
      </div>
      <Input
        placeholder="Search documents..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        className="h-8"
      />
      <ScrollArea className="max-h-48 border rounded-md p-2">
        {filteredDocuments.length > 0 ? (
          <div className="space-y-2">
            {filteredDocuments.map(doc => (
              <div key={doc.id} className="flex items-center space-x-2">
                <Checkbox
                  id={`run-doc-${doc.id}`}
                  checked={selectedDocIds.includes(doc.id)}
                  onCheckedChange={() => onToggleDoc(doc.id)}
                />
                <label
                  htmlFor={`run-doc-${doc.id}`}
                  className="text-sm font-medium leading-none flex-1 truncate cursor-pointer"
                  title={doc.title}
                >
                  {doc.title || `Document ${doc.id}`}
                </label>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center text-muted-foreground text-sm py-4">No documents match search.</div>
        )}
      </ScrollArea>
       <div className="text-xs text-muted-foreground pt-1">{selectedDocIds.length} of {allDocuments.length} selected</div>
    </div>
  );
};

// --- NEW: Scheme Selector Component ---
interface SchemeSelectorForRunProps {
  allSchemes: ClassificationSchemeRead[];
  selectedSchemeIds: number[];
  onToggleScheme: (schemeId: number) => void;
  onSelectAll: (selectAll: boolean) => void;
}

const SchemeSelectorForRun: React.FC<SchemeSelectorForRunProps> = ({
  allSchemes,
  selectedSchemeIds,
  onToggleScheme,
  onSelectAll,
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
      <ScrollArea className="max-h-48 border rounded-md p-2">
        {filteredSchemes.length > 0 ? (
          <div className="space-y-2">
            {filteredSchemes.map(scheme => (
              <div key={scheme.id} className="flex items-center space-x-2">
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
  allDocuments: DocumentRead[];
  allSchemes: ClassificationSchemeRead[];
  onRunClassification: (runName: string | undefined, runDescription: string | undefined, docIds: number[], schemeIds: number[]) => Promise<void>;
  onLoadFromRun: (runId: number, runName: string, runDescription?: string) => Promise<void>;
  currentRunId: number | null;
}

// Renamed Component
export default function ClassificationRunnerDock({
  allDocuments,
  allSchemes,
  onRunClassification,
  onLoadFromRun,
  currentRunId,
}: ClassificationRunnerDockProps) {
  const { activeWorkspace } = useWorkspaceStore();
  const { isCreatingRun } = useClassificationSystem();
  const { favoriteRuns } = useFavoriteRunsStore();
  const { runs: runHistoryStore } = useRunHistoryStore();

  // --- Use the run configuration store ---
  const {
    selectedDocIdsForRun,
    selectedSchemeIdsForRun,
    toggleDocInRun,
    toggleSchemeInRun,
    setDocsForRun,
    setSchemesForRun,
    clearRunSelection,
  } = useRunConfigurationStore();

  const [runName, setRunName] = useState<string>('');
  const [runDescription, setRunDescription] = useState<string>('');
  const [isHistoryDialogOpen, setIsHistoryDialogOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  // Ref to track if initial auto-load was attempted for the current workspace
  const initialLoadAttemptedRef = useRef(false);
  // Ref to store the workspace ID for which the attempt was made
  const attemptedWorkspaceIdRef = useRef<string | null>(null);

  const { toast } = useToast();

  // Memoized Favorite Runs
  const currentFavoriteRuns = useMemo(() => {
    const workspaceIdStr = String(activeWorkspace?.uid || '');
    return favoriteRuns.filter(run => String(run.workspaceId) === workspaceIdStr);
  }, [favoriteRuns, activeWorkspace?.uid]);

  // --- MOVED: Ensure handleLoadRun is memoized BEFORE useEffect ---
  const handleLoadRun = useCallback(async (runId: number, name: string, desc?: string) => {
    await onLoadFromRun(runId, name, desc);
    setIsHistoryDialogOpen(false);
    // Existing logic...
  }, [onLoadFromRun]); // Add dependencies for useCallback

  // --- ADDED: useEffect for auto-loading last favorite run ---
  useEffect(() => {
    const currentWorkspaceIdStr = activeWorkspace?.uid ? String(activeWorkspace.uid) : null;

    // 1. Reset attempt flag if workspace changes
    if (currentWorkspaceIdStr !== attemptedWorkspaceIdRef.current) {
      console.log(`[Dock] Workspace changed (${attemptedWorkspaceIdRef.current} -> ${currentWorkspaceIdStr}). Resetting auto-load flag.`);
      initialLoadAttemptedRef.current = false;
      attemptedWorkspaceIdRef.current = currentWorkspaceIdStr;
    }

    // Ensure we have a workspace ID before proceeding
    if (!currentWorkspaceIdStr) {
      // console.log('[Dock] No workspace ID, skipping auto-load logic.'); // Can be noisy
      return; // Exit early if no workspace
    }

    // 2. Auto-Load Check Logic
    if (!initialLoadAttemptedRef.current) {
      if (currentRunId === null) {
        // Mark as attempted *now* for this workspace session
        console.log('[Dock] Initial check for workspace: No run active. Marking auto-load as attempted.');
        initialLoadAttemptedRef.current = true; // Mark attempt happened

        if (favoriteRuns.length > 0) {
          console.log('[Dock] Favorites found. Proceeding with auto-load attempt.');
          const workspaceFavorites = favoriteRuns.filter(run => String(run.workspaceId) === currentWorkspaceIdStr);

          if (workspaceFavorites.length > 0) {
            // Find the most recent favorite run based on timestamp
            const parseDate = (ts: string): number => {
              try {
                  // Handle "Month Day, Year at HH:MM:SS AM/PM" format
                  const date = new Date(ts.replace(' at ', ' '));
                  if (!isNaN(date.getTime())) return date.getTime();
              } catch (e) { /* ignore */ }
              try { // Fallback for ISO or other formats
                  const date = new Date(ts);
                  if (!isNaN(date.getTime())) return date.getTime();
              } catch (e) { /* ignore */ }
              return 0; // Fallback
            };
            const sortedFavorites = [...workspaceFavorites].sort((a, b) => parseDate(b.timestamp) - parseDate(a.timestamp)); // Sort descending

            const lastFavorite = sortedFavorites[0];
            console.log('[Dock] Found latest favorite run:', { id: lastFavorite.id, name: lastFavorite.name });

            // Use a timeout to ensure this runs after the initial render cycle settles
            const timer = setTimeout(() => {
               // Double-check currentRunId hasn't changed again before loading
               if (currentRunId === null) {
                  console.log('[Dock] Timeout complete, calling handleLoadRun for run:', lastFavorite.id);
                  handleLoadRun(lastFavorite.id, lastFavorite.name, lastFavorite.description);
               } else {
                  console.log('[Dock] Auto-load aborted: A run became active before timeout completed.');
               }
            }, 100); // Short delay

            // Cleanup function for the timer
            return () => clearTimeout(timer);
          } else {
            console.log('[Dock] No favorites found specifically for this workspace during attempt.');
          }
        } else {
          console.log('[Dock] No favorite runs available to auto-load.');
        }
      } else {
        // A run is *already* active on the first check for this workspace.
        // Mark attempt as done to prevent loading if this active run is later cleared.
        console.log('[Dock] Initial check for workspace: Run active. Marking auto-load as complete/bypassed.');
        initialLoadAttemptedRef.current = true; // Mark attempt happened (or was bypassed)
      }
    } else {
      // Auto-load attempt already made for this workspace session. Do nothing further regarding auto-load.
      // console.log('[Dock] Auto-load already attempted/bypassed for this workspace. Skipping.'); // Can be noisy
    }

  // Dependencies: Run when workspace changes, favorites change, the load function changes, or currentRunId changes.
  }, [activeWorkspace?.uid, favoriteRuns, onLoadFromRun, currentRunId, handleLoadRun]); // handleLoadRun is dependency

  // --- MODIFIED: handleRunClick uses store state ---
  const handleRunClick = async () => {
    // Use selected IDs from the store
    if (selectedDocIdsForRun.length === 0 || selectedSchemeIdsForRun.length === 0) {
      toast({
        title: "Missing Selection",
        description: "Please select documents and schemes for the run.",
        variant: "default"
      });
      return;
    }
    // Pass selected IDs from store to the callback
    await onRunClassification(runName || undefined, runDescription || undefined, selectedDocIdsForRun, selectedSchemeIdsForRun);
    setRunName('');
    setRunDescription('');
    // Optionally clear the selection after starting the run
    // clearRunSelection();
  };

  // --- NEW: Handlers for the new selectors ---
  const handleSelectAllDocsForRun = (selectAll: boolean) => {
    const allIds = allDocuments.map(d => d.id);
    setDocsForRun(selectAll ? allIds : []);
  };

  const handleSelectAllSchemesForRun = (selectAll: boolean) => {
    const allIds = allSchemes.map(s => s.id);
    setSchemesForRun(selectAll ? allIds : []);
  };

  return (
    <TooltipProvider>
      {/* Floating Dock container */}
      <div className={cn(
        "fixed bottom-4 left-1/2 transform -translate-x-1/2",
        "flex flex-col",
        "w-auto max-w-[115vw]",
        "border bg-card text-card-foreground rounded-lg shadow-lg",
        "z-20 transition-all duration-200"
      )}>
        {/* Dock Header - Always visible */}
        <div className="flex items-center justify-between px-4 py-2 border-b">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-medium">Classification Runner</h3>
            {currentRunId && (
              <Badge variant="outline" className="ml-2 text-xs">
                Run #{currentRunId}
              </Badge>
            )}
          </div>
          <Button 
            variant="ghost" 
            size="sm" 
            className="h-6 w-6 p-0" 
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </Button>
        </div>

        {/* Dock Content - Expandable */}
        <div className={cn(
          "grid grid-cols-1 gap-4 p-4",
          "transition-all duration-200 ease-in-out",
          isExpanded ? "max-h-[70vh] overflow-y-auto opacity-100" : "max-h-0 opacity-0 overflow-hidden p-0"
        )}>
          {/* Row 1: Model Selection & Run History */}
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Label className="text-sm font-medium whitespace-nowrap">Model:</Label>
              <ProviderSelector className="w-52" />
            </div>
            
            <Separator orientation="vertical" className="h-8 hidden sm:block" />
            
            <div className="flex items-center gap-2">
              <Button 
                variant="outline" 
                onClick={() => setIsHistoryDialogOpen(true)} 
                size="sm"
                className="whitespace-nowrap"
              >
                <History className="h-4 w-4 mr-2" /> 
                <span className="hidden sm:inline">Load Run</span>
              </Button>
              
              {currentFavoriteRuns.length > 0 && (
                <FavoriteRunsDisplay 
                  runs={currentFavoriteRuns} 
                  activeRunId={currentRunId} 
                  onSelectRun={handleLoadRun} 
                />
              )}
            </div>
          </div>
          
          {/* Row 2: Run Configuration */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Left side: Run metadata */}
            <div className="space-y-3">
              <div>
                <Label htmlFor="new-run-name-dock" className="text-xs font-medium">Run Name (Optional)</Label>
                <Input
                  id="new-run-name-dock"
                  placeholder={`Run - ${format(new Date(), 'yyyy-MM-dd HH:mm')}`}
                  value={runName}
                  onChange={(e) => setRunName(e.target.value)}
                  className="h-9 text-sm"
                />
              </div>
              
              <div>
                <Label htmlFor="new-run-description-dock" className="text-xs font-medium">Description (Optional)</Label>
                <Textarea
                  id="new-run-description-dock"
                  placeholder="Purpose of this classification run..."
                  value={runDescription}
                  onChange={(e) => setRunDescription(e.target.value)}
                  className="h-20 text-sm resize-none"
                />
              </div>
            </div>
            
            {/* Right side: Start Button */}
            <div className="flex flex-col justify-end gap-3"> 
              <Button
                variant="default"
                onClick={handleRunClick}
                disabled={isCreatingRun || selectedDocIdsForRun.length === 0 || selectedSchemeIdsForRun.length === 0}
                className="mt-auto self-end"
                size="default"
              >
                {isCreatingRun ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" /> 
                    Processing...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    Start Classification Run
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* --- NEW: Row 3: Document and Scheme Selection --- */}
           <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t pt-4">
                <DocumentSelectorForRun
                    allDocuments={allDocuments}
                    selectedDocIds={selectedDocIdsForRun}
                    onToggleDoc={toggleDocInRun}
                    onSelectAll={handleSelectAllDocsForRun}
                />
                <SchemeSelectorForRun
                    allSchemes={allSchemes}
                    selectedSchemeIds={selectedSchemeIdsForRun}
                    onToggleScheme={toggleSchemeInRun}
                    onSelectAll={handleSelectAllSchemesForRun}
                />
           </div>
           {/* --- END NEW Row 3 --- */}
        </div>
        
        {/* Compact View - When collapsed */}
        <div className={cn(
          "flex items-center justify-between px-4 py-2",
          "transition-all duration-200 ease-in-out",
          isExpanded ? "max-h-0 opacity-0 overflow-hidden p-0" : "max-h-[50px] opacity-100"
        )}>
          {/* Show selected counts from store */}
          <div className="flex items-center gap-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => setIsExpanded(true)}
                  className="h-8"
                >
                  <FileText className="h-3.5 w-3.5 mr-1.5"/> 
                  {selectedDocIdsForRun.length}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{selectedDocIdsForRun.length} documents selected for run. Click to configure.</p>
              </TooltipContent>
            </Tooltip>
            
            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => setIsExpanded(true)}
                  className="h-8"
                >
                  <ListChecks className="h-3.5 w-3.5 mr-1.5"/> 
                  {selectedSchemeIdsForRun.length}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{selectedSchemeIdsForRun.length} schemes selected for run. Click to configure.</p>
              </TooltipContent>
            </Tooltip>
          </div>
          
          {/* Actions remain similar */}
          <div className="flex items-center gap-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => setIsHistoryDialogOpen(true)}
                  className="h-8"
                >
                  <History className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Load previous run</p>
              </TooltipContent>
            </Tooltip>
            
            <Button
              variant="default"
              onClick={handleRunClick}
              disabled={isCreatingRun || selectedDocIdsForRun.length === 0 || selectedSchemeIdsForRun.length === 0}
              size="sm"
              className="h-8"
            >
              {isCreatingRun ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              <span className="ml-1.5">Run</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Dialogs (remain outside the dock) */}
      <RunHistoryDialog
        isOpen={isHistoryDialogOpen}
        onClose={() => setIsHistoryDialogOpen(false)}
        activeRunId={currentRunId}
        onSelectRun={handleLoadRun}
      />
    </TooltipProvider>
  );
}

interface RunConfigurationState {
  selectedDocIdsForRun: number[];
  selectedSchemeIdsForRun: number[];
  toggleDocInRun: (docId: number) => void;
  toggleSchemeInRun: (schemeId: number) => void;
  setDocsForRun: (docIds: number[]) => void;
  setSchemesForRun: (schemeIds: number[]) => void;
  clearRunSelection: () => void;
  isDocSelectedForRun: (docId: number) => boolean;
  isSchemeSelectedForRun: (schemeId: number) => boolean;
}

export const useRunConfigurationStore = create<RunConfigurationState>()(
  (set, get) => ({
    selectedDocIdsForRun: [],
    selectedSchemeIdsForRun: [],

    toggleDocInRun: (docId: number) => set((state) => {
      const isSelected = state.selectedDocIdsForRun.includes(docId);
      if (isSelected) {
        return { selectedDocIdsForRun: state.selectedDocIdsForRun.filter(id => id !== docId) };
      } else {
        return { selectedDocIdsForRun: [...state.selectedDocIdsForRun, docId] };
      }
    }),

    toggleSchemeInRun: (schemeId: number) => set((state) => {
      const isSelected = state.selectedSchemeIdsForRun.includes(schemeId);
      if (isSelected) {
        return { selectedSchemeIdsForRun: state.selectedSchemeIdsForRun.filter(id => id !== schemeId) };
      } else {
        return { selectedSchemeIdsForRun: [...state.selectedSchemeIdsForRun, schemeId] };
      }
    }),

    setDocsForRun: (docIds: number[]) => set({ selectedDocIdsForRun: docIds }),
    setSchemesForRun: (schemeIds: number[]) => set({ selectedSchemeIdsForRun: schemeIds }),

    clearRunSelection: () => set({ selectedDocIdsForRun: [], selectedSchemeIdsForRun: [] }),

    isDocSelectedForRun: (docId: number) => get().selectedDocIdsForRun.includes(docId),
    isSchemeSelectedForRun: (schemeId: number) => get().selectedSchemeIdsForRun.includes(schemeId),
  }),
);