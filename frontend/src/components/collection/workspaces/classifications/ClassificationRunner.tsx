'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FileText, Microscope, Loader2, X, AlertCircle, Info, History, Clock, RefreshCw, Search, CheckCircle, ChevronUp, ChevronDown, Star, StarOff, ArrowUp, ArrowDown, Pencil, Play, BarChart3, Table as TableIcon, MapPin, SlidersHorizontal, ListChecks, List, Plus } from 'lucide-react';
import {
  ClassificationSchemeRead,
  ClassificationResultRead,
  DocumentRead,
  ClassificationResultCreate,
  ClassificationRunRead,
  ClassificationRunUpdate
} from '@/client/models';
import { Textarea } from '@/components/ui/textarea';
import { FormattedClassificationResult, ClassificationScheme } from '@/lib/classification/types';
import ClassificationResultsChart from '@/components/collection/workspaces/classifications/ClassificationResultsChart';
import { useDocumentStore } from '@/zustand_stores/storeDocuments';
import { useWorkspaceStore } from '@/zustand_stores/storeWorkspace';
import { format, formatDate } from 'date-fns';
import { getTargetFieldDefinition, ResultFilters, getTargetKeysForScheme } from './ClassificationResultFilters';
import { ClassificationService } from '@/lib/classification/service';
import { schemesToSchemeReads, resultsToResultReads, resultReadToResult, resultToResultRead, schemeToSchemeRead, documentToDocumentRead } from '@/lib/classification/adapters';
import ClassificationResultDisplay from '@/components/collection/workspaces/classifications/ClassificationResultDisplay';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import DocumentManagerOverlay from '../documents/DocumentManagerOverlay';
import SchemeManagerOverlay from './ClassificationSchemeManagerOverlay';
import { useApiKeysStore } from '@/zustand_stores/storeApiKeys';
import { ClassificationService as ApiClassificationService } from '@/client/services';
import { useClassificationSystem } from '@/hooks/useClassificationSystem';
import ProviderSelector from '@/components/collection/workspaces/management/ProviderSelector';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { Toaster } from '@/components/ui/toaster';
import { useToast } from '@/components/ui/use-toast';
import { Badge } from "@/components/ui/badge"
import { useFavoriteRunsStore, FavoriteRun } from '@/zustand_stores/storeFavoriteRuns';
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import DocumentDetailProvider from '../documents/DocumentDetailProvider';
import DocumentDetailWrapper from '../documents/DocumentDetailWrapper';
import DocumentLink from '../documents/DocumentLink';
import { useRunHistoryStore, RunHistoryItem } from '@/zustand_stores/storeRunHistory';
import { useTutorialStore } from '../../../../zustand_stores/storeTutorial';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { HelpCircle } from 'lucide-react';
import useGeocode, { GeocodeResult } from '@/hooks/useGeocder'; // Import hook and its result type
import type { GeocodeResult as GeocodeResultType } from '@/hooks/useGeocder'; // Explicit type import & Corrected path
import ClassificationResultsMap, { MapPoint } from './ClassificationResultsMap'; // Renamed from LocationMap
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useClassificationSettingsStore } from '@/zustand_stores/storeClassificationSettings';
import { XCircle } from 'lucide-react'; // Import XCircle for the clear button
import ClassificationSchemeEditor from './ClassificationSchemeEditor'; // Import the new component
import { useGeocodingCacheStore } from '@/zustand_stores/storeGeocodingCache'; // Import the new store
import { checkFilterMatch, extractLocationString, formatDisplayValue } from '@/lib/classification/utils';
import { ResultFilter } from './ClassificationResultFilters';
import ClassificationResultsTable from './ClassificationResultsTable';
import { Switch } from '@/components/ui/switch';
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';


// Custom hook for persistent state using localStorage
function usePersistentState<T>(
  key: string,
  initialValue: T
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    try {
      const storedValue = localStorage.getItem(key);
      return storedValue ? JSON.parse(storedValue) : initialValue;
    } catch (error) {
      console.error(`Error reading localStorage key "${key}":`, error);
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch (error) {
      console.error(`Error setting localStorage key "${key}":`, error);
    }
  }, [key, state]);

  return [state, setState];
}

// Extend TableMeta type to include our custom onRowClick property
declare module '@tanstack/react-table' {
  interface TableMeta<TData extends unknown> {
    onRowClick?: (row: any) => void;
  }
}

interface SchemeData {
  scheme: ClassificationSchemeRead;
  values: number[];
  counts: Map<string, number>;
}

// New interface for result grouping
interface ResultGroup {
  date: string;
  schemes: Record<number, SchemeData>;
}

// Run History Panel Component
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
      {/* Current Run Header */}
      {activeRun && (
        <div className="mb-4 p-3 bg-muted/30 border rounded-md">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium">Current Run</h3>
              <div className="text-sm text-muted-foreground">{activeRun.name}</div>
            </div>
            <Badge variant="outline" className="ml-2">
              Active
            </Badge>
          </div>
          <div className="flex gap-3 mt-2 text-xs text-muted-foreground">
            <div>{activeRun.timestamp}</div>
            <div>•</div>
            <div>{activeRun.documentCount} documents</div>
            <div>•</div>
            <div>{activeRun.schemeCount} schemes</div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 mb-4">
        <Input
          placeholder="Search runs..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="flex-1"
        />
        <Select
          value={`${sortBy}-${sortOrder}`}
          onValueChange={(value) => {
            const [newSortBy, newSortOrder] = value.split('-') as ['date' | 'name', 'asc' | 'desc'];
            setSortBy(newSortBy);
            setSortOrder(newSortOrder);
          }}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="date-desc">Newest first</SelectItem>
            <SelectItem value="date-asc">Oldest first</SelectItem>
            <SelectItem value="name-asc">Name (A-Z)</SelectItem>
            <SelectItem value="name-desc">Name (Z-A)</SelectItem>
          </SelectContent>
        </Select>
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

// Update the RunHistoryDialog component to use the runHistory from the store
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


  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
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
              runs={runs} // Pass the raw runs from the store
              activeRunId={activeRunId}
              onSelectRun={onSelectRun}
              favoriteRunIds={favoriteRunIds}
              onToggleFavorite={handleToggleFavoriteRun} // Pass memoized handler
            />
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button
            variant="default"
            onClick={() => {
              if (activeWorkspace?.uid) {
                const workspaceId = typeof activeWorkspace.uid === 'string'
                  ? parseInt(activeWorkspace.uid, 10)
                  : activeWorkspace.uid;

                if (!isNaN(workspaceId)) {
                   fetchRunHistory(workspaceId);
                }
              }
            }}
            disabled={isLoading}
            className="mr-auto" // Push to the left
          >
            {isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Refreshing...</> : <><RefreshCw className="mr-2 h-4 w-4" />Refresh Runs</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Add a new component for the circular timeline visualization of run history
const RunHistoryTimeline: React.FC<{
  runs: RunHistoryItem[];
  activeRunId: number | null;
  onSelectRun: (runId: number, runName: string, runDescription?: string) => void;
  maxItems?: number;
}> = ({ runs, activeRunId, onSelectRun, maxItems = 5 }) => {
  const displayRuns = runs.slice(0, maxItems);

  if (runs.length === 0) return null; // Don't render if no runs

  return (
    // Use margin from parent, remove positioning/height here
    <div className="mb-6">
      {/* Title */}
      <p className="text-sm text-muted-foreground mb-3 text-center"> Timeline (latest {maxItems} runs) </p>

      {/* Container for bar and markers */}
      <div className="relative w-full h-12"> {/* Adjusted height */}
        {/* Timeline track (positioned relative to this container) */}
        <div className="absolute top-1/2 left-4 right-4 h-1 bg-muted rounded-full transform -translate-y-1/2 z-0"></div>

        {/* Run markers container (also relative to this container) */}
        {/* Note: Removed the extra wrapping div, markers directly positioned */}
        {displayRuns.map((run, index) => {
          // Calculate position along the timeline
          const positionPercent = maxItems > 1 ? (index / (maxItems - 1)) * 100 : 50;
          // Clamp position slightly to avoid markers going off edge
          const clampedPercent = Math.max(2, Math.min(98, positionPercent)); // Adjust padding % based on marker size/padding
          const position = `${clampedPercent}%`;
          const isActive = run.id === activeRunId;

          return (
            <div
              key={run.id}
              className="absolute top-1/2 transform -translate-y-1/2 -translate-x-1/2 transition-all duration-300 z-10" // Added z-10
              style={{ left: position }}
            >
              <TooltipProvider delayDuration={100}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    {/* Removed outer flex div, directly style the trigger area */}
                    <div
                      className={cn(
                        "w-6 h-6 rounded-full flex items-center justify-center cursor-pointer transition-all duration-300", // Smaller dot
                        isActive
                          ? "bg-primary text-primary-foreground shadow-md scale-110 ring-2 ring-primary/50" // Enhanced active state
                          : "bg-muted hover:bg-primary/20 hover:scale-105" // Hover effect
                      )}
                      onClick={() => onSelectRun(run.id, run.name, run.description)}
                    >
                      {/* Keep index for identification */}
                       <span className={cn(
                          "text-xs font-medium",
                          isActive ? "text-primary-foreground" : "text-muted-foreground group-hover:text-primary" // Adjust text color
                       )}>{runs.length - runs.findIndex(r => r.id === run.id)}</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <div className="font-medium truncate max-w-[150px]">{run.name}</div>
                    <div className="text-muted-foreground text-[10px] mt-1">{run.timestamp}</div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// Add a compact favorite runs display component
const FavoriteRunsDisplay: React.FC<{
  runs: FavoriteRun[];
  activeRunId: number | null;
  onSelectRun: (runId: number, runName: string, runDescription?: string) => void;
}> = ({ runs, activeRunId, onSelectRun }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (runs.length === 0) return null;

  return (
    <div className="mb-4 bg-muted/20 rounded-lg border p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium flex items-center">
          <Star className="h-4 w-4 text-yellow-500 fill-yellow-500 mr-2" />
          Favorite Runs
        </h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsExpanded(!isExpanded)}
          className="h-6 w-6 p-0"
        >
          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </div>

      {isExpanded ? (
        <div className="space-y-2 mt-2">
          {runs.map(run => (
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
          ))}
        </div>
      ) : (
        <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
          {runs.slice(0, 3).map(run => (
            <div
              key={run.id}
              className={cn(
                "p-2 rounded border cursor-pointer hover:bg-muted/50 transition-colors flex-shrink-0",
                activeRunId === run.id && "bg-muted border-primary"
              )}
              onClick={() => onSelectRun(run.id, run.name, run.description)}
            >
              <div className="font-medium text-sm truncate max-w-[120px]">{run.name}</div>
            </div>
          ))}
          {runs.length > 3 && (
            <Button
              variant="outline"
              size="sm"
              className="flex-shrink-0 h-auto"
              onClick={() => setIsExpanded(true)}
            >
              +{runs.length - 3} more
            </Button>
          )}
        </div>
      )}
    </div>
  );
};

export default function ClassificationRunner() {
  const { activeWorkspace } = useWorkspaceStore();
  const { fetchDocuments } = useDocumentStore();
  const {
    schemes: allSchemesHook,
    documents: allDocumentsHook,
    isLoadingSchemes,
    isLoadingDocuments,
    isCreatingRun,
    error: classificationHookError,
    loadSchemes,
    loadDocuments,
    loadRun,
    createRun: createRunHook,
    setActiveRun: setActiveRunHook,
    updateRun,
    deleteRun,
    // Results for the active run (use this instead of local state)
    results: activeRunResultsFromHook, // Rename results from hook
    isLoadingResults,
    loadResults,
    // Classification
    isClassifying,
    classifyContent,
    batchClassify,
    // Error
    error: classificationError,
  } = useClassificationSystem({ autoLoadSchemes: true, autoLoadDocuments: true, autoLoadRuns: true });

  // Use consistent naming for schemes/documents from the hook
  const allSchemes = allSchemesHook;
  const allDocuments = allDocumentsHook;

  // --- Moved Geocode State Declaration to the TOP ---
  const [selectedGeocodeSchemeId, setSelectedGeocodeSchemeId] = useState<string | null>(null);
  const [selectedGeocodeField, setSelectedGeocodeField] = useState<string | null>(null);
  // --- End Move ---

  const [selectedDocs, setSelectedDocs] = useState<number[]>([]);
  const [selectedSchemes, setSelectedSchemes] = useState<number[]>([]);
  const [runName, setRunName] = useState<string>('');
  const [runDescription, setRunDescription] = useState<string>('');
  const [activeFilters, setActiveFilters] = useState<ResultFilter[]>([]);
  const [isResultDialogOpen, setIsResultDialogOpen] = useState(false);
  const [isDocumentManagerOpen, setIsDocumentManagerOpen] = useState(false);
  const [isSchemeManagerOpen, setIsSchemeManagerOpen] = useState(false);
  const [isLoadingRunDetails, setIsLoadingRunDetails] = useState(false);
  const [isHistoryDialogOpen, setIsHistoryDialogOpen] = useState(false);
  const [selectedDocumentId, setSelectedDocumentId] = useState<number | null>(null);
  const [isCreateSchemeEditorOpen, setIsCreateSchemeEditorOpen] = useState(false);

  // Local state for the currently loaded run's details
  const [currentRunId, setCurrentRunId] = useState<number | null>(null);
  const [currentRunName, setCurrentRunName] = useState<string>('');
  const [currentRunDescription, setCurrentRunDescription] = useState<string>('');
  const [runSchemes, setRunSchemes] = useState<ClassificationSchemeRead[]>([]);
  const [currentRunResults, setCurrentRunResults] = useState<FormattedClassificationResult[]>([]);
  const [currentRunDocuments, setCurrentRunDocuments] = useState<DocumentRead[]>([]);

  // Favorite runs state
  const { favoriteRuns, addFavoriteRun, removeFavoriteRun, isFavorite } = useFavoriteRunsStore();
  const favoriteRunIds = useMemo(() => favoriteRuns.map(fr => fr.id), [favoriteRuns]);

  // --- State Definitions ---
  const [geocodedPoints, setGeocodedPoints] = useState<MapPoint[]>([]);
  const [filteredGeocodedPoints, setFilteredGeocodedPoints] = useState<MapPoint[]>([]);
  const [isLoadingGeocoding, setIsLoadingGeocoding] = useState(false);
  const [geocodingError, setGeocodingError] = useState<string | null>(null);

  // --- Calculate options for geocode selectors (Now uses state declared above) ---
  const geocodeSchemeOptions = useMemo(() => {
    return runSchemes.map(scheme => ({
      value: scheme.id.toString(),
      label: scheme.name
    }));
  }, [runSchemes]);

  const geocodeFieldOptions = useMemo(() => {
    if (!selectedGeocodeSchemeId) return [];
    const scheme = runSchemes.find(s => s.id === parseInt(selectedGeocodeSchemeId, 10));
    if (!scheme) return [];
    return scheme.fields.map(field => ({
      value: field.name,
      label: `${field.name} (${field.type})`
    }));
  }, [selectedGeocodeSchemeId, runSchemes]); // Depends on state declared above

  // --- State for Geocoding Hook ---
  const { geocodeLocation, loading: isGeocodingSingle, error: geocodeSingleError } = useGeocode();

  // Zustand stores
  const { showClassificationRunnerTutorial, toggleClassificationRunnerTutorial } = useTutorialStore();
  const { toast } = useToast();
  const { runs: runHistoryStore, isLoading: isLoadingRunHistory, fetchRunHistory } = useRunHistoryStore();

  // --- Memoized Data for Views ---
  // Schemes/Documents relevant to the *currently loaded run*
  const selectedSchemesData = useMemo(() => runSchemes, [runSchemes]);
  const selectedDocumentsData = useMemo(() => currentRunDocuments, [currentRunDocuments]);

  // Memoized Run History (Sorted)
  const runHistory = useMemo(() => {
    return (runHistoryStore || [])
       .sort((a, b) => {
            const parseDate = (ts: string): number => {
                try { const date = new Date(ts.replace(' at ', ' ')); if (!isNaN(date.getTime())) return date.getTime(); } catch (e) {}
                try { const date = new Date(ts); if (!isNaN(date.getTime())) return date.getTime(); } catch (e) {}
                return 0;
            };
            const timeA = parseDate(a.timestamp);
            const timeB = parseDate(b.timestamp);
            return timeB - timeA; // Descending order
       });
 }, [runHistoryStore]);

 // Memoized Favorite Runs (Filtered for current workspace)
 const currentFavoriteRuns = useMemo(() => {
    const workspaceIdStr = String(activeWorkspace?.uid || '');
    return favoriteRuns.filter(run => String(run.workspaceId) === workspaceIdStr);
 }, [favoriteRuns, activeWorkspace?.uid]);

  // --- Initial data loading effects ---
  useEffect(() => {
    if (activeWorkspace?.uid) {
      console.log("Workspace active, loading initial data...");
      loadSchemes();
      loadDocuments();
      const workspaceIdNum = typeof activeWorkspace.uid === 'string' ? parseInt(activeWorkspace.uid) : activeWorkspace.uid;
      if (!isNaN(workspaceIdNum)) {
          fetchRunHistory(workspaceIdNum); // Load run history via store
      }
    }
  }, [activeWorkspace?.uid, loadSchemes, loadDocuments, fetchRunHistory]);

  // Effect to load the latest run by default
  useEffect(() => {
    // --- TEMPORARILY DISABLED AUTO-LOAD ---
    /*
    if (!currentRunId && !isLoadingRunHistory && runHistoryStore && runHistoryStore.length > 0) {
       const latestRun = runHistoryStore[0];
       console.log("No run loaded, auto-loading latest run:", latestRun.id);
       requestAnimationFrame(() => {
           handleLoadFromRun(latestRun.id, latestRun.name || `Run ${latestRun.id}`, latestRun.description || '');
       });
    }
    */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runHistoryStore, currentRunId, isLoadingRunHistory]); // Dependencies are correct

  // --- Handlers for Editable Run Name/Description ---
  const [isEditingName, setIsEditingName] = useState(false);
  const [isEditingDescription, setIsEditingDescription] = useState(false);

  const handleEditClick = (field: 'name' | 'description') => {
      const elementId = field === 'name' ? 'run-name-editable' : 'run-description-editable';
      if (field === 'name') setIsEditingName(true);
      else setIsEditingDescription(true);

      setTimeout(() => {
          const el = document.getElementById(elementId);
          if (el) {
              el.contentEditable = 'true';
              el.focus();
              const range = document.createRange();
              range.selectNodeContents(el);
              const sel = window.getSelection();
              sel?.removeAllRanges();
              sel?.addRange(range);
          }
      }, 0);
  };

  const handleBlur = (e: React.FocusEvent<HTMLSpanElement>, field: 'name' | 'description') => {
    const newValue = e.target.innerText.trim();
    e.target.contentEditable = 'false'; // Always disable editing on blur

    if (field === 'name') {
        setIsEditingName(false);
        if (newValue !== currentRunName) {
            handleRunNameChange(newValue);
        }
    } else {
        setIsEditingDescription(false);
        const placeholder = "Add a description...";
        if (newValue !== currentRunDescription && newValue !== placeholder) {
            handleRunDescriptionChange(newValue);
        } else if (newValue === placeholder && currentRunDescription !== '') {
            handleRunDescriptionChange(''); // Clear description if set back to placeholder
        }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLSpanElement>, field: 'name' | 'description') => {
      if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
      } else if (e.key === 'Escape') {
          e.currentTarget.innerText = field === 'name' ? currentRunName : (currentRunDescription || "Add a description...");
          e.currentTarget.blur();
      }
  };

  const handleRunNameChange = (newName: string) => {
    setCurrentRunName(newName);
    // TODO: API call to patch run name
    console.log("TODO: Update run name in backend:", newName);
    toast({ title: "Run Name Updated (Local)", description: `Run name set to "${newName}". Backend update pending.` });
    // Consider updating run history store if changes should reflect immediately
  };

  const handleRunDescriptionChange = (newDescription: string) => {
    setCurrentRunDescription(newDescription);
    // TODO: API call to patch run description
    console.log("TODO: Update run description in backend:", newDescription);
    toast({ title: "Run Description Updated (Local)", description: `Description updated. Backend update pending.` });
  };
  // --- End Editable Handlers ---

  // --- Geocoding Logic ---
  const { getCache, setCache } = useGeocodingCacheStore();

  const generateGeocodingCacheKey = useCallback(() => {
    if (!activeWorkspace?.uid || !currentRunId) return null;
    return `${activeWorkspace.uid}-run-${currentRunId}`;
  }, [activeWorkspace?.uid, currentRunId]);

  const handleGeocodeRunLocations = useCallback(async () => {
    if (!currentRunId || !selectedGeocodeSchemeId || !selectedGeocodeField) {
      console.log("Geocoding prerequisites not met. Clearing points.");
      setGeocodedPoints([]);
      setFilteredGeocodedPoints([]); // Ensure filtered points are also cleared
      return;
    }

    const cacheKey = generateGeocodingCacheKey();
    if (cacheKey) {
        const cachedPoints = getCache(cacheKey);
        if (cachedPoints) {
            console.log("Using cached geocoded points.");
            setGeocodedPoints(cachedPoints);
            // Initial filtering happens in useEffect, no need to set filtered here
            return;
        }
    }

    console.log(`Geocoding run ${currentRunId}, scheme ${selectedGeocodeSchemeId}, field ${selectedGeocodeField}`);
    setIsLoadingGeocoding(true);
    setGeocodingError(null);
    setGeocodedPoints([]);
    setFilteredGeocodedPoints([]);

    const schemeIdNum = parseInt(selectedGeocodeSchemeId, 10);
    const locationStrings = new Set<string>();
    currentRunResults.forEach(result => {
      if (result.scheme_id === schemeIdNum) {
        const loc = extractLocationString(result.value, selectedGeocodeField);
        if (loc) locationStrings.add(loc);
      }
    });

    if (locationStrings.size === 0) {
        console.log("No location strings found to geocode.");
        setIsLoadingGeocoding(false);
        return;
    }

    const geocodedData = new Map<string, GeocodeResultType | null>();
    let errorsEncountered = false;
    for (const locStr of locationStrings) {
      try {
        const result = await geocodeLocation(locStr);
        geocodedData.set(locStr, result);
      } catch (error: any) {
        console.error(`Error geocoding "${locStr}":`, error);
        geocodedData.set(locStr, null);
        errorsEncountered = true;
      }
      await new Promise(resolve => setTimeout(resolve, 50)); // Rate limiting
    }

    if (errorsEncountered) {
        setGeocodingError("Some locations failed to geocode. See console for details.");
    }

    const pointsMap = new Map<string, MapPoint>();
    currentRunResults.forEach(result => {
      if (result.scheme_id === schemeIdNum) {
        const locStr = extractLocationString(result.value, selectedGeocodeField);
        if (locStr) {
          const geoResult = geocodedData.get(locStr);
          if (geoResult?.latitude && geoResult?.longitude) {
            const pointId = locStr;
            let mapPoint = pointsMap.get(pointId);
            if (!mapPoint) {
              mapPoint = {
                id: pointId,
                locationString: locStr,
                coordinates: { latitude: geoResult.latitude, longitude: geoResult.longitude },
                documentIds: [],
                bbox: geoResult.bbox,
                type: geoResult.type
              };
              pointsMap.set(pointId, mapPoint);
            }
            if (!mapPoint.documentIds.includes(result.document_id)) {
              mapPoint.documentIds.push(result.document_id);
            }
          }
        }
      }
    });

    const newPoints = Array.from(pointsMap.values());
    console.log(`Generated ${newPoints.length} geocoded points.`);
    setGeocodedPoints(newPoints);
    // Initial filtering is done in the useEffect below, no need to setFiltered here

    if (cacheKey) {
        setCache(cacheKey, newPoints); // Cache the newly fetched points
    }

    setIsLoadingGeocoding(false);
    console.log("Finished geocoding.");
  }, [
    currentRunId,
    selectedGeocodeSchemeId,
    selectedGeocodeField,
    currentRunResults,
    extractLocationString,
    geocodeLocation,
    setIsLoadingGeocoding,
    setGeocodedPoints,
    setFilteredGeocodedPoints,
    setGeocodingError,
    generateGeocodingCacheKey,
    getCache,
    setCache,
  ]);

  // Function to fetch results for a specific run
  const fetchResults = useCallback(async (runIdToLoad: number) => {
    if (!activeWorkspace?.uid) return;
    // Modified log to indicate if called with runId
    console.log(`[DEBUG] fetchResults called ${runIdToLoad ? 'for run ID: ' + runIdToLoad : 'WITHOUT specific run ID'}`); 
    setIsLoadingRunDetails(true); // Start loading state
    try {
      const runData = await loadRun(runIdToLoad); // Use hook's loadRun

      if (runData) {
        console.log("[DEBUG] Run data loaded:", runData); // <<< ADDED LOG
        const { run, results, schemes: loadedSchemes } = runData;
        console.log(`[DEBUG] loadRun returned ${results.length} results for run ${runIdToLoad}.`); // <<< ADDED LOG

        setCurrentRunId(run.id);
        setCurrentRunName(run.name || `Run ${run.id}`);
        setCurrentRunDescription(run.description || '');
        setCurrentRunResults(results);
        setRunSchemes(schemesToSchemeReads(loadedSchemes));
        console.log(`[DEBUG] Set currentRunResults state with ${results.length} items.`); // <<< ADDED LOG

        const docIds = [...new Set(results.map(r => r.document_id))];
        const documentsForRun = allDocumentsHook
          .filter(doc => docIds.includes(doc.id))
          .map(doc => documentToDocumentRead(doc));
        setCurrentRunDocuments(documentsForRun);

        setActiveRunHook(run); // Update hook state

        // Trigger geocoding after data is loaded
        await handleGeocodeRunLocations(); // Await geocoding

      } else {
        toast({
          title: "Error Loading Run",
          description: `Could not load details for run ${runIdToLoad}.`,
          variant: "destructive",
        });
        handleClearRun(); // Clear state if run load fails
      }
    } catch (err: any) {
      console.error('Error fetching run details:', err);
      toast({
        title: "Error loading run",
        description: err.message || "An unexpected error occurred.",
        variant: "destructive",
      });
      handleClearRun(); // Clear state on error
    } finally {
      setIsLoadingRunDetails(false);
      console.log("Finished fetching run details.");
    }
  }, [currentRunId, activeWorkspace?.uid, loadRun, allDocumentsHook, setActiveRunHook, toast, handleGeocodeRunLocations]); 

  // Handler for running a new classification
  const handleRunClassification = async () => {
    if (!activeWorkspace?.uid) {
      toast({ title: "No Workspace", description: "Please select a workspace.", variant: "destructive" });
      return;
    }
    const documentsToClassify = allDocumentsHook.filter(doc => selectedDocs.includes(doc.id));
    const schemesToUse = selectedSchemes;

    if (documentsToClassify.length === 0 || schemesToUse.length === 0) {
      toast({ title: "Missing Selection", description: "Please select documents and schemes.", variant: "default" });
      return;
    }

    console.log("[DEBUG] handleRunClassification started."); // <<< ADDED LOG
    try {
      const newRun = await createRunHook(
        documentsToClassify,
        schemesToUse,
        { name: runName || undefined, description: runDescription || undefined }
      );

      if (newRun) {
        toast({ title: "Run Started", description: `Classification run "${newRun.name}" created.` });
        handleLoadFromRun(newRun.id, newRun.name || `Run ${newRun.id}`, newRun.description || ''); // <<< ADD LOG INSIDE handleLoadFromRun
        const workspaceIdNum = typeof activeWorkspace.uid === 'string' ? parseInt(activeWorkspace.uid) : activeWorkspace.uid;
        if (!isNaN(workspaceIdNum)) fetchRunHistory(workspaceIdNum);
        setSelectedDocs([]);
        setSelectedSchemes([]);
        setRunName('');
        setRunDescription('');
      }
    } catch (err: any) {
      toast({ title: "Run Failed", description: err.message || "Could not start run.", variant: "destructive" });
    } finally { // <<< ADDED FINALLY BLOCK
        console.log("[DEBUG] handleRunClassification finished."); // <<< ADDED LOG
    }
  };

  // Handler to clear the currently loaded run state
  const handleClearRun = useCallback(() => { // Wrap in useCallback
       setCurrentRunId(null);
       setCurrentRunName('');
       setCurrentRunDescription('');
       setCurrentRunResults([]);
       setRunSchemes([]);
       setCurrentRunDocuments([]);
       setActiveRunHook(null);
       setGeocodedPoints([]);
       setFilteredGeocodedPoints([]);
       setActiveFilters([]);
       setSelectedGeocodeSchemeId(null);
       setSelectedGeocodeField(null);
       toast({ title: "Run Cleared", description: "Current run data unloaded." });
  }, [setActiveRunHook, toast]); // Added dependencies

  // Handler to load data from a selected run history item
  const handleLoadFromRun = useCallback(async (runId: number, runName: string, runDescription?: string) => {
    console.log(`[DEBUG] handleLoadFromRun called for run: ${runId} (${runName})`); // <<< ADDED LOG
    setCurrentRunId(runId); // Set current run ID first
    // Fetch results will update name/desc based on actual loaded data
    setIsHistoryDialogOpen(false);
    await fetchResults(runId); // Fetch results using the new ID
  }, [fetchResults]); // Depends on fetchResults

  // --- Selection Handlers ---
  const handleDocSelect = useCallback((docId: number, isSelected: boolean) => {
    setSelectedDocs(prev =>
      isSelected ? [...prev, docId] : prev.filter(id => id !== docId)
    );
  }, []);

  const handleSchemeSelect = useCallback((schemeId: number, isSelected: boolean) => {
    setSelectedSchemes(prev =>
      isSelected ? [...prev, schemeId] : prev.filter(id => id !== schemeId)
    );
  }, []);

  const handleSelectAllDocs = useCallback((selectAll: boolean) => {
    if (selectAll) setSelectedDocs(allDocuments.map(doc => doc.id));
    else setSelectedDocs([]);
  }, [allDocuments]);

  const handleSelectAllSchemes = useCallback((selectAll: boolean) => {
    if (selectAll) setSelectedSchemes(allSchemes.map(scheme => scheme.id));
    else setSelectedSchemes([]);
  }, [allSchemes]);
  // --- End Selection Handlers ---

  // --- Filtered Results Logic ---
  const filteredResults = useMemo(() => {
    if (activeFilters.length === 0) return currentRunResults;

    const resultsByDocId = currentRunResults.reduce<Record<number, FormattedClassificationResult[]>>((acc, result) => {
      const docId = result.document_id;
      if (!acc[docId]) acc[docId] = [];
      acc[docId].push(result);
      return acc;
    }, {});

    const filteredDocIds = Object.keys(resultsByDocId)
      .map(Number)
      .filter(docId => {
        const docResults = resultsByDocId[docId];
        return activeFilters.every(filter => checkFilterMatch(filter, docResults, runSchemes));
      });

    return currentRunResults.filter(result => filteredDocIds.includes(result.document_id));
  }, [currentRunResults, activeFilters, runSchemes]);

  // --- useEffect for filtering points ---
  useEffect(() => {
    console.log(`[DEBUG] Geocoding filter useEffect triggered. Filters: ${activeFilters.length}, Current Results: ${currentRunResults.length}, Geocoded Points: ${geocodedPoints.length}`); // <<< ADDED LOG
    const sourcePoints = geocodedPoints;
    if (activeFilters.length === 0) {
      setFilteredGeocodedPoints(sourcePoints);
      return;
    }
    if (!sourcePoints || sourcePoints.length === 0 || !currentRunResults || currentRunResults.length === 0) {
      setFilteredGeocodedPoints([]);
      return;
    }
    const resultsByDocId = currentRunResults.reduce<Record<number, FormattedClassificationResult[]>>((acc, result) => {
      const docId = result.document_id;
      if (!acc[docId]) acc[docId] = [];
      acc[docId].push(result);
      return acc;
    }, {});

    const newlyFilteredPoints = sourcePoints.filter(point =>
      point.documentIds.some(docId => {
        const docResults = resultsByDocId[docId];
        if (!docResults) return false;
        return activeFilters.every(filter => checkFilterMatch(filter, docResults, runSchemes));
      })
    );
    setFilteredGeocodedPoints(newlyFilteredPoints);
  }, [geocodedPoints, activeFilters, currentRunResults, runSchemes]); // Dependencies are correct

  // --- UPDATE: Handler for Table Row Click --- (moved from old table meta)
  const handleTableRowClick = (docId: number) => {
    setSelectedDocumentId(docId);
    setIsResultDialogOpen(true);
  };
  // --- END UPDATE ---

  // --- ADDED STATE for Map Labels ---
  const [showMapLabels, setShowMapLabels] = useState<boolean>(false);
  const [mapLabelSchemeId, setMapLabelSchemeId] = useState<number | null>(null);
  const [mapLabelFieldKey, setMapLabelFieldKey] = useState<string | null>(null);
  // --- END ADDED STATE ---

  // --- ADDED: Effect to initialize and update map label field key ---
  useEffect(() => {
    // Initialize scheme ID if not set and schemes are available
    if (mapLabelSchemeId === null && runSchemes.length > 0) {
      setMapLabelSchemeId(runSchemes[0].id);
    }

    // Update field key when scheme ID changes or initially
    if (mapLabelSchemeId !== null) {
      const keys = getTargetKeysForScheme(mapLabelSchemeId, runSchemes);
      const currentKeyIsValid = keys.some(k => k.key === mapLabelFieldKey);
      // Reset to the first key if the current one is invalid or null for the new scheme
      if (!currentKeyIsValid || mapLabelFieldKey === null) {
        setMapLabelFieldKey(keys.length > 0 ? keys[0].key : null);
      }
    } else {
      setMapLabelFieldKey(null); // No scheme selected
    }
  // Ensure filteredSchemes is stable or memoized if needed
  }, [mapLabelSchemeId, runSchemes, mapLabelFieldKey]);
  // --- END ADDED Effect ---

  // --- ADDED: Prepare map points ---
  // --- MODIFIED: Removed redundant mapPoints calculation ---
  /*
  const mapPoints = useMemo((): MapPoint[] => {
    // ... (removed calculation logic) ...
  }, [currentRunResults, runSchemes]);
  */
  // --- END Prepare map points ---

  // --- ADDED: Prepare label config ---
  const mapLabelConfig = useMemo(() => {
    if (!showMapLabels || mapLabelSchemeId === null || mapLabelFieldKey === null) {
      return undefined;
    }
    return {
      schemeId: mapLabelSchemeId,
      fieldKey: mapLabelFieldKey,
      // colorField: undefined // Add logic for colorField later if needed
    };
  }, [showMapLabels, mapLabelSchemeId, mapLabelFieldKey]);
  // --- END Prepare label config ---

  // --- ADDED: Get target keys for map label field selector ---
  const currentMapLabelKeys = useMemo(() => {
    // --- MODIFIED: Use runSchemes ---
    if (mapLabelSchemeId !== null && runSchemes.length > 0) {
        // Find the actual scheme object to pass
        const scheme = runSchemes.find(s => s.id === mapLabelSchemeId);
        return scheme ? getTargetKeysForScheme(mapLabelSchemeId, [scheme]) : [];
    }
    return [];
  // --- MODIFIED: Depend on runSchemes ---
  }, [mapLabelSchemeId, runSchemes]);
  // --- END Get target keys ---

  // --- Define renderResultsTabs function BEFORE the main return ---
  const renderResultsTabs = () => {
    if (isLoadingRunDetails) {
      return <div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin" /></div>;
    }
    if (!currentRunResults || currentRunResults.length === 0) {
      return <div className="flex items-center justify-center h-64 text-muted-foreground">No results found for this run.</div>;
    }

    return (
       <Tabs defaultValue="chart" className="w-full">
         <TabsList className="grid w-full grid-cols-3 mb-2 sticky top-0 bg-background z-10">
           <TabsTrigger value="chart">Chart</TabsTrigger>
           <TabsTrigger value="table">Table</TabsTrigger>
           <TabsTrigger value="map">Map</TabsTrigger>
         </TabsList>
         <TabsContent value="chart">
           <div className="p-1 border rounded-lg bg-muted/10">
             <ClassificationResultsChart results={currentRunResults} schemes={runSchemes} documents={currentRunDocuments} filters={activeFilters} />
           </div>
         </TabsContent>
         <TabsContent value="table">
           <div className="p-1 border rounded-lg bg-muted/10">
             <ClassificationResultsTable results={currentRunResults} schemes={runSchemes} documents={currentRunDocuments} filters={activeFilters} onRowClick={handleTableRowClick} />
           </div>
         </TabsContent>
         <TabsContent value="map">
            {/* --- MOVED: Map Display Controls --- */}
            <div className="mb-4 p-3 border rounded-md bg-muted/10 space-y-4">
               {/* Geocoding Source Controls */}
               <div className="space-y-2">
                   <h4 className="text-sm font-medium text-muted-foreground">Map Point Source</h4>
                   <div className="flex flex-wrap items-end gap-4">
                       <div className="flex items-center gap-2">
                           <Label htmlFor="geocode-scheme-select" className="text-sm">Scheme:</Label>
                           <Select value={selectedGeocodeSchemeId ?? ""} onValueChange={(v) => {setSelectedGeocodeSchemeId(v); setSelectedGeocodeField(null); /* Reset field on scheme change */}}>
                               <SelectTrigger id="geocode-scheme-select" className="w-[220px]">
                                   <SelectValue placeholder="Select scheme for locations..." />
                               </SelectTrigger>
                               <SelectContent>
                                   {geocodeSchemeOptions.map(option => (
                                       <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                   ))}
                                   {geocodeSchemeOptions.length === 0 && <div className="p-2 text-xs text-center italic text-muted-foreground">No schemes in run</div>}
                               </SelectContent>
                           </Select>
                       </div>
                       {selectedGeocodeSchemeId && (
                           <div className="flex items-center gap-2">
                               <Label htmlFor="geocode-field-select" className="text-sm">Field:</Label>
                               <Select value={selectedGeocodeField ?? ""} onValueChange={setSelectedGeocodeField}>
                                   <SelectTrigger id="geocode-field-select" className="w-[200px]">
                                       <SelectValue placeholder="Select location field..." />
                                   </SelectTrigger>
                                   <SelectContent>
                                       {geocodeFieldOptions.map(option => (
                                           <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                       ))}
                                       {geocodeFieldOptions.length === 0 && <div className="p-2 text-xs text-center italic text-muted-foreground">No fields in scheme</div>}
                                   </SelectContent>
                               </Select>
                           </div>
                       )}
                       <Button
                           onClick={handleGeocodeRunLocations}
                           disabled={!selectedGeocodeSchemeId || !selectedGeocodeField || isLoadingGeocoding}
                           size="sm"
                       >
                           {isLoadingGeocoding ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <MapPin className="h-4 w-4 mr-2" />}
                           Geocode Locations
                       </Button>
                   </div>
                   {isLoadingGeocoding && (<div className="text-sm text-muted-foreground mt-2">Geocoding...</div>)}
                   {geocodingError && (
                      <p className="text-sm text-red-500 mt-2 flex items-center">
                           <AlertCircle className="h-4 w-4 mr-1" /> {geocodingError}
                       </p>
                    )}
               </div>

               {/* Map Label Controls */}
               <div className="space-y-2 pt-4 border-t">
                   <div className="flex items-center justify-between">
                       <h4 className="text-sm font-medium text-muted-foreground">Map Label Display</h4>
                       <div className="flex items-center gap-2">
                           <Switch id="map-label-switch" checked={showMapLabels} onCheckedChange={setShowMapLabels} />
                           <Label htmlFor="map-label-switch">Show Labels</Label>
                       </div>
                   </div>
                   {showMapLabels && (
                       <div className="flex flex-wrap items-center gap-4">
                           <div className="flex items-center gap-2">
                               <Label htmlFor="map-label-scheme-select" className="text-sm">Scheme:</Label>
                               <Select value={mapLabelSchemeId?.toString() ?? ""} onValueChange={(v) => setMapLabelSchemeId(v ? parseInt(v) : null)}>
                                   <SelectTrigger id="map-label-scheme-select" className="w-[220px]">
                                       <SelectValue placeholder="Select scheme for labels" />
                                   </SelectTrigger>
                                   <SelectContent>
                                       {runSchemes.map(s => (<SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>))}
                                   </SelectContent>
                               </Select>
                           </div>
                           {mapLabelSchemeId !== null && currentMapLabelKeys.length > 0 && (
                               <div className="flex items-center gap-2">
                                   <Label htmlFor="map-label-key-select" className="text-sm">Field/Key:</Label>
                                   <Select value={mapLabelFieldKey ?? ""} onValueChange={(v) => setMapLabelFieldKey(v || null)}>
                                       <SelectTrigger id="map-label-key-select" className="w-[200px]">
                                           <SelectValue placeholder="Select field/key" />
                                       </SelectTrigger>
                                       <SelectContent>
                                           {currentMapLabelKeys.map(tk => (<SelectItem key={tk.key} value={tk.key}>{tk.name} ({tk.type})</SelectItem>))}
                                       </SelectContent>
                                   </Select>
                               </div>
                           )}
                           {mapLabelSchemeId !== null && currentMapLabelKeys.length === 1 && (
                               <div className="flex items-center gap-2">
                                   <Label className="text-sm">Field:</Label>
                                   <span className="text-sm px-3 py-1.5 bg-muted rounded">{currentMapLabelKeys[0].name}</span>
                               </div>
                           )}
                       </div>
                   )}
               </div>
            </div>

            {/* Map Component - Use filteredGeocodedPoints */}
            <div className="p-1 border rounded-lg bg-muted/10 overflow-hidden h-[600px] relative">
              {isLoadingGeocoding ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10"><Loader2 className="h-8 w-8 animate-spin text-primary"/></div>
              ) : filteredGeocodedPoints.length > 0 ? (
                  <ClassificationResultsMap
                      points={filteredGeocodedPoints} // Use filtered points
                      documents={currentRunDocuments}
                      results={currentRunResults}
                      schemes={runSchemes}
                      labelConfig={mapLabelConfig}
                      onPointClick={(point) => { // Pass inline function reusing handleTableRowClick
                          if (point.documentIds.length > 0) {
                            handleTableRowClick(point.documentIds[0]);
                          }
                      }} 
                  />
              ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-muted-foreground p-4 text-center">
                      {geocodedPoints.length > 0 ? 'No map points match the current filters.' : 'Geocode locations using the controls above to see the map.'}
                  </div>
              )}
            </div>
         </TabsContent>
       </Tabs>
    );
  };

  // --- Main Component Return ---
  if (!activeWorkspace) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Please select a workspace to start classification.
      </div>
    );
  }

  const areAllDocsSelected = allDocuments.length > 0 && selectedDocs.length === allDocuments.length;
  const areAllSchemesSelected = allSchemes.length > 0 && selectedSchemes.length === allSchemes.length;

  return (
    <DocumentDetailProvider>
      <DocumentDetailWrapper onLoadIntoRunner={handleLoadFromRun}>
        <div className="flex flex-col h-full">
          <div className="p-4 flex-1 overflow-auto">
            <div className="mb-4 flex items-center justify-between">
              <h1 className="text-xl font-semibold">Classification Runner</h1>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={toggleClassificationRunnerTutorial}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <HelpCircle className="h-5 w-5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="left"><p>Show/Hide Tutorial</p></TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <FavoriteRunsDisplay runs={currentFavoriteRuns} activeRunId={currentRunId} onSelectRun={handleLoadFromRun}/>
            <RunHistoryTimeline runs={runHistory} activeRunId={currentRunId} onSelectRun={handleLoadFromRun} maxItems={7} />

            {/* === NEW: Setup Card === */}
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>Setup</CardTitle>
                <CardDescription>Configure the model provider, documents, schemes, and run actions.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Row 1: Provider and Actions */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
                  <div className="space-y-2 md:col-span-1">
                    <h3 className="text-sm font-medium">Model Provider</h3>
                    <ProviderSelector className="w-full" />
                  </div>
                  {/* <<< REMOVED Run History/Button Section from here >>> */}
                  <div className="space-y-2 md:col-span-1">
                    {/* Placeholder or shift Load Previous Run button here if desired */}
                    {/* Example: Keep Load button, remove Run button */}
                     <h3 className="text-sm font-medium">Load Previous Run</h3>
                     <Button variant="outline" onClick={() => setIsHistoryDialogOpen(true)} className="w-full"><History className="h-4 w-4 mr-2" /> Load Previous Run</Button>
                  </div>
                  <div className="space-y-2 md:col-span-1">
                    {/* Placeholder if Load button was moved */}
                  </div>
                </div>

                {/* --- ADDED: New Run Name/Description Inputs --- */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                   <div className="space-y-2">
                       <label htmlFor="new-run-name" className="text-sm font-medium">New Run Name (Optional)</label>
                       <Input
                          id="new-run-name"
                          placeholder={`Run - ${format(new Date(), 'yyyy-MM-dd HH:mm')}`}
                          value={runName} // Bind to the state used by handleRunClassification
                          onChange={(e) => setRunName(e.target.value)}
                       />
                   </div>
                   <div className="space-y-2">
                       <label htmlFor="new-run-description" className="text-sm font-medium">New Run Description (Optional)</label>
                       <Textarea
                          id="new-run-description"
                          placeholder="Describe the purpose or parameters of this run..."
                          value={runDescription} // Bind to the state used by handleRunClassification
                          onChange={(e) => setRunDescription(e.target.value)}
                          rows={1} // Keep it compact initially
                          className="resize-none" // Prevent manual resizing
                       />
                   </div>
                </div>
                {/* --- END ADDED --- */}

                {/* Row 2: Documents and Schemes */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Document Selection */}
                  <Card className="flex flex-col h-full border-none shadow-none p-0"> {/* Adjusted styling */}
                    <CardHeader className="pb-2 px-1">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-lg">Documents ({allDocuments.length})</CardTitle>
                        <div className="flex items-center gap-1">
                          <TooltipProvider delayDuration={100}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Checkbox
                                  id="select-all-docs"
                                  checked={areAllDocsSelected}
                                  onCheckedChange={(checked) => handleSelectAllDocs(!!checked)}
                                  disabled={isLoadingDocuments}
                                />
                              </TooltipTrigger>
                              <TooltipContent><p>Select All</p></TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="sm" onClick={() => setIsDocumentManagerOpen(true)}><List className="h-4 w-4" /></Button>
                              </TooltipTrigger>
                              <TooltipContent><p>Manage Documents</p></TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                      </div>
                      <CardDescription className="px-1">Select documents to include in the run.</CardDescription>
                    </CardHeader>
                    <CardContent className="flex-1 flex flex-col px-1">
                      {isLoadingDocuments ? (
                        <div className="flex-1 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground"/></div>
                      ) : allDocuments.length > 0 ? (
                        <ScrollArea className="max-h-60 flex-1 border rounded-md p-2">
                          <div className="space-y-2">
                            {allDocuments.map(doc => (
                              <div key={doc.id} className="flex items-center space-x-2 p-1 rounded hover:bg-muted/50">
                                <Checkbox
                                  id={`doc-${doc.id}`}
                                  checked={selectedDocs.includes(doc.id)}
                                  onCheckedChange={(checked) => handleDocSelect(doc.id, !!checked)}
                                />
                                <label
                                  htmlFor={`doc-${doc.id}`}
                                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex-1 truncate cursor-pointer"
                                  title={doc.title}
                                >
                                  {doc.title || `Document ${doc.id}`}
                                </label>
                                <div className="text-xs text-muted-foreground">{doc.insertion_date ? format(new Date(doc.insertion_date), 'PP') : '-'}</div>
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                      ) : (
                        <div className="flex-1 flex items-center justify-center text-muted-foreground italic">No documents found.</div>
                      )}
                      <div className="mt-1 text-xs text-muted-foreground pt-1">{selectedDocs.length} selected</div>
                    </CardContent>
                  </Card>

                  {/* Scheme Selection */}
                  <Card className="flex flex-col h-full border-none shadow-none p-0"> {/* Adjusted styling */}
                    <CardHeader className="pb-2 px-1">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-lg">Schemes ({allSchemes.length})</CardTitle>
                        <div className="flex items-center gap-1">
                           <TooltipProvider delayDuration={100}>
                              <Tooltip>
                                 <TooltipTrigger asChild>
                                    <Button variant="ghost" size="sm" onClick={() => setIsCreateSchemeEditorOpen(true)}><Plus className="h-4 w-4" /></Button>
                                 </TooltipTrigger>
                                 <TooltipContent><p>Create New Scheme</p></TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                 <TooltipTrigger asChild>
                                    <Checkbox
                                       id="select-all-schemes"
                                       checked={areAllSchemesSelected}
                                       onCheckedChange={(checked) => handleSelectAllSchemes(!!checked)}
                                       disabled={isLoadingSchemes}
                                    />
                                 </TooltipTrigger>
                                 <TooltipContent><p>Select All</p></TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                   <Button variant="ghost" size="sm" onClick={() => setIsSchemeManagerOpen(true)}><ListChecks className="h-4 w-4" /></Button>
                                </TooltipTrigger>
                                <TooltipContent><p>Manage Schemes</p></TooltipContent>
                              </Tooltip>
                           </TooltipProvider>
                        </div>
                      </div>
                      <CardDescription className="px-1">Select schemes to apply in the run.</CardDescription>
                    </CardHeader>
                    <CardContent className="flex-1 flex flex-col px-1">
                      {isLoadingSchemes ? (
                        <div className="flex-1 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground"/></div>
                      ) : allSchemes.length > 0 ? (
                        <ScrollArea className="max-h-60 flex-1 border rounded-md p-2">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {allSchemes.map(scheme => (
                              <div key={scheme.id} className="flex items-center space-x-2 p-1 rounded hover:bg-muted/50">
                                <Checkbox
                                  id={`scheme-${scheme.id}`}
                                  checked={selectedSchemes.includes(scheme.id)}
                                  onCheckedChange={(checked) => handleSchemeSelect(scheme.id, !!checked)}
                                />
                                <label
                                  htmlFor={`scheme-${scheme.id}`}
                                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex-1 truncate cursor-pointer"
                                  title={scheme.name}
                                >
                                  {scheme.name}
                                </label>
                                <div className="text-xs text-muted-foreground">{scheme.created_at ? format(new Date(scheme.created_at), 'PP') : '-'}</div>
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                      ) : (
                        <div className="flex-1 flex items-center justify-center text-muted-foreground italic">No schemes found.</div>
                      )}
                      <div className="mt-1 text-xs text-muted-foreground pt-1">{selectedSchemes.length} selected</div>
                    </CardContent>
                  </Card>
                </div>

                {/* --- ADDED: Moved Run Button Here --- */}
                <div className="mt-4 pt-4 border-t border-muted">
                   <h3 className="text-sm font-medium mb-2">Execute Run</h3>
                   <Button
                      variant="default"
                      onClick={handleRunClassification}
                      disabled={isCreatingRun || selectedDocs.length === 0 || selectedSchemes.length === 0}
                      className="w-full md:w-auto"
                   >
                      {isCreatingRun ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />} Run New Classification
                   </Button>
                </div>
                {/* --- END ADDED --- */}

              </CardContent>
            </Card>
            {/* === END: Setup Card === */}

            {/* === Results Card (Remains, but filters move inside) === */}
            <Card className="mt-4">
                 <CardHeader>
                      <div className="flex items-center justify-between">
                          <div className="flex flex-col"> {/* Group title and description */}
                              <CardTitle>Run Results</CardTitle>
                              <CardDescription className="flex items-center gap-1 mt-1">
                                 {currentRunId ? (
                                    <>
                                        <span
                                            id="run-description-editable"
                                            className={`px-1 ${isEditingDescription ? 'outline outline-1 outline-primary bg-background w-full' : 'hover:bg-muted/50 cursor-text italic text-muted-foreground'}`}
                                            contentEditable={isEditingDescription ? 'true' : 'false'}
                                            suppressContentEditableWarning={true}
                                            onBlur={(e) => handleBlur(e, 'description')}
                                            onKeyDown={(e) => handleKeyDown(e, 'description')}
                                            onClick={() => !isEditingDescription && handleEditClick('description')}
                                        >
                                            {currentRunDescription || 'Add a description...'}
                                        </span>
                                        <TooltipProvider delayDuration={100}>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={() => handleEditClick('description')}><Pencil className="h-3 w-3" /></Button>
                                                </TooltipTrigger>
                                                <TooltipContent><p>Edit Description</p></TooltipContent>
                                            </Tooltip>
                                        </TooltipProvider>
                                    </>
                                 ) : "Load a run from history or create a new one to see results."
                                 }
                              </CardDescription>
                          </div>
                          {currentRunId && (
                              <div className="flex items-center gap-2"> {/* Group name edit and clear button */}
                                  <div className="flex items-center gap-1">
                                      <span
                                          id="run-name-editable"
                                          className={`font-medium text-lg px-1 ${isEditingName ? 'outline outline-1 outline-primary bg-background' : 'hover:bg-muted/50 cursor-text'}`}
                                          contentEditable={isEditingName ? 'true' : 'false'}
                                          suppressContentEditableWarning={true}
                                          onBlur={(e) => handleBlur(e, 'name')}
                                          onKeyDown={(e) => handleKeyDown(e, 'name')}
                                          onClick={() => !isEditingName && handleEditClick('name')}
                                      >
                                          {currentRunName || 'Unnamed Run'}
                                      </span>
                                      <TooltipProvider delayDuration={100}>
                                         <Tooltip>
                                             <TooltipTrigger asChild>
                                                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleEditClick('name')}><Pencil className="h-3 w-3" /></Button>
                                             </TooltipTrigger>
                                             <TooltipContent><p>Edit Run Name</p></TooltipContent>
                                         </Tooltip>
                                     </TooltipProvider>
                                  </div>
                                  {/* Moved Clear Run Button Here */}
                                  <Button variant="outline" size="sm" onClick={handleClearRun} disabled={!currentRunId}>
                                      <XCircle className="h-4 w-4 mr-1" /> Clear
                                  </Button>
                              </div>
                          )}
                      </div>
                      {/* REMOVED Description from here, moved above */}
                 </CardHeader>
                 <CardContent>
                     {/* Check if we should show filters and results */}
                     {(currentRunId && !isLoadingRunDetails) || isLoadingRunDetails ? (
                        <>
                            {/* --- MOVED FILTERS HERE --- */}
                            {currentRunId && !isLoadingRunDetails && (
                                <div className="mb-4 p-4 border rounded-md bg-muted/10"> {/* Optional wrapper for filters */}
                                    <ResultFilters
                                        filters={activeFilters}
                                        schemes={runSchemes}
                                        onChange={setActiveFilters}
                                    />
                                </div>
                            )}
                            {/* --- END MOVED FILTERS --- */}

                            {/* Loading state for results */}
                            {isLoadingRunDetails && (
                                <div className="flex justify-center items-center h-60">
                                    <Loader2 className="h-8 w-8 animate-spin text-primary"/>
                                    <span className="ml-2">Loading results...</span>
                                </div>
                            )}

                            {/* Render tabs only when not loading and run is selected */}
                            {/* --- MODIFIED: Call defined function --- */}
                            {currentRunId && !isLoadingRunDetails && renderResultsTabs()}
                        </>
                     ) : (
                         // Message when no run is loaded and not loading
                         <div className="text-center p-8 text-muted-foreground border rounded-lg">
                            Load a run from history or create a new one to view results.
                         </div>
                     )}
                 </CardContent>
              </Card>
          </div>

          {/* Dialogs */}
          <RunHistoryDialog isOpen={isHistoryDialogOpen} onClose={() => setIsHistoryDialogOpen(false)} activeRunId={currentRunId} onSelectRun={handleLoadFromRun} />
          <Dialog open={isDocumentManagerOpen} onOpenChange={setIsDocumentManagerOpen}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Document Manager</DialogTitle>
                <DialogDescription>Manage documents for the current workspace.</DialogDescription>
              </DialogHeader>
              <div className="flex flex-col space-y-4">
                {isLoadingDocuments ? (
                  <div className="flex justify-center items-center h-20"><Loader2 className="h-8 w-8 animate-spin text-primary"/></div>
                ) : allDocuments.length > 0 ? (
                  <ScrollArea className="max-h-[400px]">
                    <div className="space-y-2">
                      {allDocuments.map(doc => (
                        <div key={doc.id} className="flex items-center space-x-2 p-2 rounded hover:bg-muted/50">
                          <Checkbox
                            id={`doc-${doc.id}`}
                            checked={selectedDocs.includes(doc.id)}
                            onCheckedChange={(checked) => handleDocSelect(doc.id, !!checked)}
                          />
                          <label
                            htmlFor={`doc-${doc.id}`}
                            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex-1 truncate cursor-pointer"
                            title={doc.title}
                          >
                            {doc.title || `Document ${doc.id}`}
                          </label>
                          <div className="text-xs text-muted-foreground">{doc.insertion_date ? format(new Date(doc.insertion_date), 'PP') : '-'}</div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                ) : (
                  <div className="text-center text-muted-foreground italic">No documents found.</div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDocumentManagerOpen(false)}>
                  <X className="h-4 w-4 mr-2" /> Close
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={isSchemeManagerOpen} onOpenChange={setIsSchemeManagerOpen}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Scheme Manager</DialogTitle>
                <DialogDescription>Manage classification schemes for the current workspace.</DialogDescription>
              </DialogHeader>
              <div className="flex flex-col space-y-4">
                {isLoadingSchemes ? (
                  <div className="flex justify-center items-center h-20"><Loader2 className="h-8 w-8 animate-spin text-primary"/></div>
                ) : allSchemes.length > 0 ? (
                  <ScrollArea className="max-h-[400px]">
                    <div className="space-y-2">
                      {allSchemes.map(scheme => (
                        <div key={scheme.id} className="flex items-center space-x-2 p-2 rounded hover:bg-muted/50">
                          <Checkbox
                            id={`scheme-${scheme.id}`}
                            checked={selectedSchemes.includes(scheme.id)}
                            onCheckedChange={(checked) => handleSchemeSelect(scheme.id, !!checked)}
                          />
                          <label
                            htmlFor={`scheme-${scheme.id}`}
                            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex-1 truncate cursor-pointer"
                            title={scheme.name}
                          >
                            {scheme.name}
                          </label>
                          <div className="text-xs text-muted-foreground">{scheme.created_at ? format(new Date(scheme.created_at), 'PP') : '-'}</div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                ) : (
                  <div className="text-center text-muted-foreground italic">No schemes found.</div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsSchemeManagerOpen(false)}>
                  <X className="h-4 w-4 mr-2" /> Close
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={isCreateSchemeEditorOpen} onOpenChange={setIsCreateSchemeEditorOpen}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Create New Scheme</DialogTitle>
                <DialogDescription>Define a new classification scheme for the current workspace.</DialogDescription>
              </DialogHeader>
              <div className="flex flex-col space-y-4">
                {/* Scheme Editor Component */}
                <ClassificationSchemeEditor
                  show={isCreateSchemeEditorOpen}
                  onClose={() => {
                    setIsCreateSchemeEditorOpen(false);
                    loadSchemes(); // Reload schemes after potentially creating one
                  }}
                  mode="create"
                />
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={isResultDialogOpen} onOpenChange={setIsResultDialogOpen}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Result Details</DialogTitle>
                <DialogDescription>
                   Detailed view of classification results for the selected document.
                </DialogDescription>
              </DialogHeader>
              <ScrollArea className="max-h-[60vh] p-4">
                  {selectedDocumentId && (() => {
                     // This logic correctly renders the details without a separate ResultDetails component
                     const doc = currentRunDocuments.find(d => d.id === selectedDocumentId);
                     const resultsForDoc = currentRunResults.filter(r => r.document_id === selectedDocumentId);
                     const schemesForDoc = resultsForDoc
                         .map(r => runSchemes.find(s => s.id === r.scheme_id))
                         .filter((s): s is ClassificationSchemeRead => !!s);

                     if (!doc) return <p>Document details not found.</p>;

                     return (
                       <div className="space-y-4">
                          <h3 className="font-semibold text-lg">{doc.title}</h3>
                          {resultsForDoc.length > 0 ? (
                              <ClassificationResultDisplay
                                 result={resultsToResultReads(resultsForDoc)}
                                 scheme={schemesForDoc}
                                 useTabs={schemesForDoc.length > 1}
                                 renderContext="dialog"
                              />
                          ) : (
                             <p className="text-muted-foreground italic">No results for this document in run.</p>
                          )}
                       </div>
                     );
                  })()}
              </ScrollArea>
              <DialogFooter>
                  <Button variant="outline" onClick={() => setIsResultDialogOpen(false)}>Close</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          {isDocumentManagerOpen && <DocumentManagerOverlay isOpen={isDocumentManagerOpen} onClose={() => setIsDocumentManagerOpen(false)} onLoadIntoRunner={handleLoadFromRun} />}
          {isSchemeManagerOpen && <SchemeManagerOverlay isOpen={isSchemeManagerOpen} onClose={() => setIsSchemeManagerOpen(false)} />}
          <ClassificationSchemeEditor
            show={isCreateSchemeEditorOpen}
            onClose={() => {
              setIsCreateSchemeEditorOpen(false);
              loadSchemes(); // Reload schemes after potentially creating one
            }}
            mode="create"
          />

          <Toaster />
        </div>
      </DocumentDetailWrapper>
    </DocumentDetailProvider>
  );
}