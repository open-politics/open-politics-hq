'use client';

import React, { useState, useMemo, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { 
  Calendar, 
  Clock, 
  User, 
  Database, 
  Star, 
  BookmarkIcon,
  History,
  Search,
  SortAsc,
  SortDesc,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Settings,
  Settings2,
  MoreHorizontal,
  Eye,
  Trash2,
  Share2,
  Download,
  Play,
  Filter,
  X,
  Sparkles,
  Zap,
  Repeat,
  FileText,
  Microscope,
  Loader2,
  Upload,
  Terminal
} from 'lucide-react';
import { cn } from "@/lib/utils";
import { AnnotationRunRead, ResourceType } from '@/client';
import { Label } from '@/components/ui/label';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ScrollArea } from "@/components/ui/scroll-area";
import { format, parseISO } from 'date-fns';
import { useFavoriteRunsStore } from '@/zustand_stores/storeFavoriteRuns';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { Badge } from '@/components/ui/badge';
import { shallow } from 'zustand/shallow';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useShareableStore } from '@/zustand_stores/storeShareables';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuLabel, 
  DropdownMenuSeparator,
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import ShareAnnotationRunDialog from './ShareAnnotationRunDialog';
import { useAnnotationRunStore } from '@/zustand_stores/useAnnotationRunStore';

const FavoriteRunCard: React.FC<{
  run: AnnotationRunRead & { timestamp: string; documentCount: number; schemeCount: number };
  activeRunId?: number | null;
  onSelectRun: (runId: number) => void;
  onToggleFavorite: (run: AnnotationRunRead) => void;
  onShare: (runId: number) => void;
  onExport: (runId: number) => void;
}> = ({ run, activeRunId, onSelectRun, onToggleFavorite, onShare, onExport }) => {
  const config = run.configuration as any;
  const recurringTaskIdValue: unknown = config?.recurring_task_id;
  const isRecurring = typeof recurringTaskIdValue === 'number';
  const recurringTaskIdNumber = isRecurring ? recurringTaskIdValue : null;

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'completed': return 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
      case 'running': return 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800';
      case 'pending': return 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800';
      case 'failed': return 'bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800';
      case 'completed_with_errors': return 'bg-orange-50 dark:bg-orange-950/50 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800';
      default: return 'bg-muted text-muted-foreground border-border';
    }
  };

  return (
    <div 
      className={cn(
        "group relative p-4 sm:p-5 rounded-lg cursor-pointer transition-all duration-200 flex-shrink-0 w-[300px] sm:w-[340px]",
        "border bg-background/80 hover:bg-accent/50 hover:shadow-md",
        activeRunId === run.id 
          ? "border-primary ring-2 ring-primary/20 shadow-lg" 
          : "border-border hover:border-border/80"
      )}
      onClick={() => onSelectRun(run.id)}
    >
      {/* Header Row - Status + Actions */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <Badge 
          className={cn(
            "capitalize font-medium text-xs px-2.5 py-1 rounded-md border",
            getStatusColor(run.status ?? '')
          )}
        >
          {(run.status ?? '').replace(/_/g, ' ')}
        </Badge>
        
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button 
              variant="ghost" 
              size="icon"
              className="h-8 w-8 -mr-2 -mt-1 opacity-70 group-hover:opacity-100 transition-opacity"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onShare(run.id); }}>
              <Share2 className="mr-2 h-4 w-4" /> Share
            </DropdownMenuItem>
            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onExport(run.id); }}>
              <Download className="mr-2 h-4 w-4" /> Export
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onToggleFavorite(run); }}>
              <Star className="mr-2 h-4 w-4 fill-amber-500" /> Remove from Favorites
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Title + Recurring Badge */}
      <div className="mb-2">
        <div className="flex items-center gap-2 mb-1.5">
          <h3 className="font-semibold text-base text-foreground line-clamp-1" title={run.name}>
            {run.name}
          </h3>
          {isRecurring && (
            <TooltipProvider delayDuration={100}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="p-1 rounded-full bg-purple-100 dark:bg-purple-900/50 border border-purple-200 dark:border-purple-700">
                    <Repeat className="h-3 w-3 text-purple-600 dark:text-purple-400" />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Recurring Run (Task ID: {recurringTaskIdNumber})</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        
        {run.description && (
          <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
            {run.description}
          </p>
        )}
      </div>

      {/* Stats + Date Row */}
      <div className="flex items-center justify-between pt-3 mt-3 border-t border-border/50">
        <div className="flex items-center gap-3 text-sm">
          <div className="flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
            <span className="font-medium text-foreground">{run.documentCount}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Microscope className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
            <span className="font-medium text-foreground">{run.schemeCount}</span>
          </div>
        </div>
        
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Calendar className="h-3 w-3" />
          <span>{format(parseISO(run.created_at), 'MMM d, yyyy')}</span>
        </div>
      </div>
    </div>
  );
};

const RunTableRow: React.FC<{
  run: AnnotationRunRead & { timestamp: string; documentCount: number; schemeCount: number };
  activeRunId?: number | null;
  onSelectRun: (runId: number) => void;
  onToggleFavorite: (run: AnnotationRunRead) => void;
  onShare: (runId: number) => void;
  onExport: (runId: number) => void;
}> = ({ run, activeRunId, onSelectRun, onToggleFavorite, onShare, onExport }) => {
  const config = run.configuration as any;
  const recurringTaskIdValue: unknown = config?.recurring_task_id;
  const isRecurring = typeof recurringTaskIdValue === 'number';
  const recurringTaskIdNumber = isRecurring ? recurringTaskIdValue : null;

  const getStatusVariant = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'completed': return 'default';
      case 'running': return 'secondary';
      case 'pending': return 'secondary';
      case 'failed': return 'destructive';
      case 'completed_with_errors': return 'outline';
      default: return 'outline';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'completed': return 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800 shadow-emerald-100 dark:shadow-emerald-900/20';
      case 'running': return 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800 shadow-blue-100 dark:shadow-blue-900/20';
      case 'pending': return 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800 shadow-amber-100 dark:shadow-amber-900/20';
      case 'failed': return 'bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800 shadow-red-100 dark:shadow-red-900/20';
      case 'completed_with_errors': return 'bg-orange-50 dark:bg-orange-950/50 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800 shadow-orange-100 dark:shadow-orange-900/20';
      default: return 'bg-muted text-muted-foreground border-border shadow-muted/20';
    }
  };

  return (
    <TableRow 
      className={cn(
        "group cursor-pointer transition-all duration-300 border-0 bg-background hover:bg-gradient-to-r hover:from-muted/50 hover:via-background hover:to-muted/50",
        "hover:-translate-y-0.5",
        "border-b border-border/60",
        activeRunId === run.id && "bg-gradient-to-r from-primary/5 via-primary/2 to-primary/5 shadow-lg shadow-primary/10 border-l-4 border-l-primary"
      )}
      onClick={() => onSelectRun(run.id)}
    >
      <TableCell className="w-16 pl-6 py-6">
        <div className="flex items-center justify-center">
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite(run);
            }}
            className={cn(
              "h-9 w-9 rounded-full transition-all duration-200",
              "hover:bg-amber-50 dark:hover:bg-amber-900/50",
              "border border-transparent hover:border-amber-200 dark:hover:border-amber-700"
            )}
          >
            <Star className="h-4 w-4 text-muted-foreground hover:text-amber-500 transition-colors duration-200" />
          </Button>
        </div>
      </TableCell>
      <TableCell className="py-6 pl-2">
        <div className="flex items-center gap-2">
          <Play className="h-4 w-4 text-blue-700 dark:text-blue-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-semibold text-foreground truncate group-hover:text-foreground/80 transition-colors" title={run.name}>
                {run.name}
              </span>
              {isRecurring && (
                <TooltipProvider delayDuration={100}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="p-1 rounded-full bg-purple-100 dark:bg-purple-900/50 border border-purple-200 dark:border-purple-700">
                        <Repeat className="h-3 w-3 text-purple-600 dark:text-purple-400" />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Recurring Run (Task ID: {recurringTaskIdNumber})</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
            {run.description && (
              <p className="text-sm text-muted-foreground mt-1 line-clamp-2 leading-relaxed">{run.description}</p>
            )}
          </div>
        </div>
      </TableCell>
      <TableCell className="w-32 py-6 text-center">
        <div className="flex items-center justify-center">
          <Badge 
            className={cn(
              "capitalize font-medium text-xs px-3 py-1.5 rounded-lg border shadow-sm pointer-events-none",
              getStatusColor(run.status ?? '')
            )}
          >
            {(run.status ?? '').replace(/_/g, ' ')}
          </Badge>
        </div>
      </TableCell>
      <TableCell className="w-20 text-center py-6">
        <div className="flex items-center justify-center gap-1.5">
          <div className="p-1.5 rounded-md">
            <FileText className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
          </div>
          <span className="font-semibold text-foreground">{run.documentCount}</span>
        </div>
      </TableCell>
      <TableCell className="w-20 text-center py-6">
        <div className="flex items-center justify-center gap-1.5">
          <div className="p-1.5 rounded-md">
            <Microscope className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
          </div>
          <span className="font-semibold text-foreground">{run.schemeCount}</span>
        </div>
      </TableCell>
      <TableCell className="w-40 text-right text-sm text-muted-foreground py-6 pr-6">
        <div className="flex items-center gap-1.5 justify-end">
          <Calendar className="h-3.5 w-3.5 text-muted-foreground/70" />
          <span className="font-medium">{format(parseISO(run.created_at), 'MMM d, yyyy')}</span>
        </div>
      </TableCell>
      <TableCell className="w-20 text-right py-6 pr-6">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 w-8 p-0">
              <span className="sr-only">Open menu</span>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Actions</DropdownMenuLabel>
            <DropdownMenuItem onClick={(e) => {e.stopPropagation(); onShare(run.id);}}>
              <Share2 className="mr-2 h-4 w-4" /> Share Dashboard
            </DropdownMenuItem>
            <DropdownMenuItem onClick={(e) => {e.stopPropagation(); onExport(run.id);}}>
              <Download className="mr-2 h-4 w-4" /> Export Run
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
};

const RunHistoryPanel: React.FC<{
  runs: AnnotationRunRead[];
  activeRunId?: number | null;
  onSelectRun: (runId: number) => void;
}> = ({ runs, activeRunId, onSelectRun }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'date' | 'name'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [isFavoritesExpanded, setIsFavoritesExpanded] = useState(true);
  const [sharingRun, setSharingRun] = useState<AnnotationRunRead | null>(null);
  
  const { addFavoriteRun, removeFavoriteRun, isFavorite } = useFavoriteRunsStore();
  const favoriteRuns = useFavoriteRunsStore(state => state.favoriteRuns);
  const favoriteRunIds = useMemo(() => favoriteRuns.map(r => r.id), [favoriteRuns]);
  const { activeInfospace } = useInfospaceStore();
  const { exportAnnotationRun, fetchRuns } = useAnnotationRunStore();
  const { importResource } = useShareableStore();

  const handleToggleFavoriteRun = useCallback((run: AnnotationRunRead) => {
    const infospaceId = activeInfospace?.id || '';
    if (isFavorite(run.id)) {
      removeFavoriteRun(run.id);
    } else {
      const config = run.configuration as any;
      const schemaIds = run.schema_ids || config?.schema_ids || [];
      const assetIds = config?.target_asset_ids || [];

      addFavoriteRun({
        id: run.id,
        name: run.name,
        timestamp: format(parseISO(run.created_at), 'PPp'),
        documentCount: assetIds.length,
        schemeCount: schemaIds.length,
        InfospaceId: String(infospaceId),
        description: run.description ?? undefined
      });
    }
  }, [activeInfospace?.id, isFavorite, addFavoriteRun, removeFavoriteRun]);

  const handleShareRun = useCallback((runId: number) => {
    const run = runs.find(r => r.id === runId);
    if (!run) {
      toast.error('Run not found');
      return;
    }
    
    setSharingRun(run);
  }, [runs]);

  const handleExportRun = useCallback(async (runId: number) => {
    if (!activeInfospace?.id) {
      toast.error('No active infospace');
      return;
    }
    
    const run = runs.find(r => r.id === runId);
    if (!run) {
      toast.error('Run not found');
      return;
    }

    try {
      await exportAnnotationRun(activeInfospace.id, runId);
    } catch (error) {
      console.error('Error exporting run:', error);
    }
  }, [runs, activeInfospace?.id, exportAnnotationRun]);

  // Add import functionality
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !activeInfospace?.id) {
      return;
    }

    setIsImporting(true);
    try {
      const result = await importResource(file, activeInfospace.id);
      if (result) {
        if ('batch_summary' in result) {
          // Batch import result
          const summary = result.batch_summary;
          toast.success(`Import completed: ${summary.successful_imports.length} runs imported, ${summary.failed_imports.length} failed`);
        } else {
          // Single import result
          toast.success(`Successfully imported: ${result.imported_resource_name}`);
        }
        // Refresh the runs list after successful import
        await fetchRuns(activeInfospace.id);
      }
    } catch (error) {
      console.error('Import error:', error);
      // Error toast already handled by the store
    } finally {
      setIsImporting(false);
      // Clear the file input
      if (event.target) {
        event.target.value = '';
      }
    }
  }, [activeInfospace?.id, importResource, fetchRuns]);

  const displayRuns = useMemo(() => {
    return runs.map(run => {
        const config = run.configuration as any;
        const schemaIds = run.schema_ids || config?.schema_ids || [];
        const assetIds = config?.target_asset_ids || [];

        return {
            ...run,
            timestamp: format(parseISO(run.created_at), 'PPp'),
            documentCount: assetIds.length,
            schemeCount: schemaIds.length,
        };
    });
  }, [runs]);

  const filteredRuns = useMemo(() => {
    return displayRuns.filter(run =>
      run.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [displayRuns, searchTerm]);

  const sortedRuns = useMemo(() => {
    return [...filteredRuns].sort((a, b) => {
      if (sortBy === 'date') {
        const timeA = parseISO(a.created_at).getTime();
        const timeB = parseISO(b.created_at).getTime();
        return sortOrder === 'asc' ? timeA - timeB : timeB - timeA;
      } else {
        return sortOrder === 'asc'
          ? a.name.localeCompare(b.name)
          : b.name.localeCompare(a.name);
      }
    });
  }, [filteredRuns, sortBy, sortOrder]);

  const favoriteRunsFromList = useMemo(() => {
    return sortedRuns.filter(run => favoriteRunIds.includes(run.id));
  }, [sortedRuns, favoriteRunIds]);

  const nonFavoriteRuns = useMemo(() => {
    return sortedRuns.filter(run => !favoriteRunIds.includes(run.id));
  }, [sortedRuns, favoriteRunIds]);

  return (
    <div className="flex flex-col h-full">
      {/* Fixed Header Section */}
      <div className="flex-shrink-0">
        <div className="p-4 pb-0">
          {/* Main Header Row */}
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
            {/* Left Side - Title and Icon */}
            <div className="flex items-center gap-4 pl-0">
              <div className="p-3 flex items-center gap-2">
                <Terminal className="h-6 w-6 text-blue-700 dark:text-blue-400" />
                <Play className="h-6 w-6 text-blue-700 dark:text-blue-400" />
                <History className="h-6 w-6 text-blue-700 dark:text-blue-400" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Run History</h1>
                <p className="text-gray-600 dark:text-gray-400 text-sm">
                  {runs.length} total runs • {favoriteRunsFromList.length} favorited
                </p>
              </div>
            </div>

            {/* Right Side - Search and Settings */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <div className="relative flex-1 sm:flex-initial">
                <Input
                  placeholder="Search runs..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full sm:w-80 lg:w-96 h-10 bg-background/50 border-primary/50 focus:border-primary/50 focus:bg-background transition-colors"
                />
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleImportClick}
                  disabled={isImporting}
                  className="bg-background/50 border-border/60 hover:bg-muted/80 hover:border-border transition-colors flex-1 sm:flex-initial max-w-32"
                >
                  {isImporting ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4 mr-2" />
                  )}
                  <span className="hidden sm:inline">{isImporting ? 'Importing...' : 'Import Run'}</span>
                  <span className="sm:hidden">{isImporting ? 'Importing...' : 'Import'}</span>
                </Button>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button 
                      variant="outline" 
                      size="icon"
                      className="bg-background/50 border-border/60 hover:bg-muted/80 hover:border-border transition-colors"
                    >
                      <Settings className="h-4 w-4" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-56 p-3">
                    <div className="space-y-3">
                      <h4 className="font-medium text-sm">Sort Options</h4>
                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">Sort by</Label>
                        <div className="flex gap-2">
                          <Button size="sm" variant={sortBy === 'date' ? 'default' : 'outline'} onClick={() => setSortBy('date')} className="flex-1">Date</Button>
                          <Button size="sm" variant={sortBy === 'name' ? 'default' : 'outline'} onClick={() => setSortBy('name')} className="flex-1">Name</Button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">Order</Label>
                        <div className="flex gap-2">
                          <Button size="sm" variant={sortOrder === 'asc' ? 'default' : 'outline'} onClick={() => setSortOrder('asc')} className="flex-1">↑</Button>
                          <Button size="sm" variant={sortOrder === 'desc' ? 'default' : 'outline'} onClick={() => setSortOrder('desc')} className="flex-1">↓</Button>
                        </div>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </div>

          

          {/* Favorites Section */}
          {favoriteRunsFromList.length > 0 && (
            <div className="space-y-3 mb-6">
              <button
                className="flex items-center gap-2.5 px-2 py-1.5 hover:bg-muted/30 rounded-lg transition-colors group w-full"
                onClick={() => setIsFavoritesExpanded(!isFavoritesExpanded)}
              >
                <Star className="h-5 w-5 text-amber-500 fill-amber-400 flex-shrink-0" />
                <h2 className="text-lg font-semibold text-foreground">Favorite Runs</h2>
                <Badge variant="secondary" className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-700">
                  {favoriteRunsFromList.length}
                </Badge>
                <div className="ml-auto">
                  {isFavoritesExpanded ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                  )}
                </div>
              </button>
              
              <Collapsible open={isFavoritesExpanded}>
                <CollapsibleContent>
                  <div className="relative rounded-lg border border-border/60 bg-accent/60 overflow-hidden">
                    <div className="w-full overflow-x-auto">
                      <div className="flex gap-3 sm:gap-4 p-4">
                        {favoriteRunsFromList.map((run) => (
                          <FavoriteRunCard
                            key={`favorite-${run.id}`}
                            run={run}
                            activeRunId={activeRunId}
                            onSelectRun={onSelectRun}
                            onToggleFavorite={handleToggleFavoriteRun}
                            onShare={handleShareRun}
                            onExport={handleExportRun}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          )}
        </div>
      </div>

      {/* All Runs Section - Fixed Header with Scrollable Content */}
      <div className="flex-1 flex flex-col min-h-0">

        {/* All Runs Table - Scrollable Content */}
        <div className="flex-1 overflow-hidden p-2 sm:p-4 backdrop-blur-sm scrollbar-hide ">
          {nonFavoriteRuns.length > 0 ? (
            <div className="bg-background/60 rounded border border-border/60 overflow-hidden h-full flex flex-col">
              {/* Mobile Card Layout */}
              <div className="sm:hidden flex-1 overflow-y-auto p-2 space-y-2 pb-20">
                {nonFavoriteRuns.map((run) => {
                  const getStatusColor = (status: string) => {
                    switch (status?.toLowerCase()) {
                      case 'completed': return 'bg-emerald-100 text-emerald-800 border-emerald-300';
                      case 'running': return 'bg-blue-100 text-blue-800 border-blue-300';
                      case 'pending': return 'bg-amber-100 text-amber-600 border-amber-300';
                      case 'failed': return 'bg-red-100 text-red-800 border-red-300';
                      case 'completed_with_errors': return 'bg-orange-100 text-orange-800 border-orange-300';
                      default: return 'bg-slate-100 text-slate-800 border-slate-300';
                    }
                  };

                  return (
                    <div
                      key={run.id}
                      className={cn(
                        "p-3 rounded-lg border cursor-pointer transition-all duration-200",
                        "bg-card hover:bg-muted/50",
                        activeRunId === run.id 
                          ? "border-primary ring-2 ring-primary/20 bg-primary/5" 
                          : "border-border/60 hover:border-border"
                      )}
                      onClick={() => onSelectRun(run.id)}
                    >
                    <div className="flex items-start justify-between mb-2 gap-2">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 p-0 flex-shrink-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleFavoriteRun(run);
                          }}
                        >
                          <Star className={cn(
                            "h-3 w-3",
                            favoriteRunIds.includes(run.id) 
                              ? "fill-amber-500 text-amber-600 dark:text-amber-400" 
                              : "text-muted-foreground/50 hover:text-amber-500"
                          )} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 p-0 flex-shrink-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectRun(run.id);
                          }}
                        >
                          <Play className="h-3 w-3 text-blue-600 dark:text-blue-400" />
                        </Button>
                        <h3 className="font-medium text-sm truncate min-w-0">{run.name}</h3>
                      </div>
                      <Badge 
                        variant="outline" 
                        className={cn("text-xs flex-shrink-0", getStatusColor(run.status ?? ''))}
                      >
                        {(run.status ?? '').replace(/_/g, ' ')}
                      </Badge>
                    </div>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <div className="flex items-center gap-3">
                          <span className="flex items-center gap-1">
                            <FileText className="h-3 w-3" />
                            {run.documentCount}
                          </span>
                          <span className="flex items-center gap-1">
                            <Microscope className="h-3 w-3" />
                            {run.schemeCount}
                          </span>
                        </div>
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {format(parseISO(run.created_at), 'MMM d')}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop Table Layout */}
              <div className="hidden sm:block flex-1 overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-accent/40">
                    <TableRow>
                      <TableHead className="w-16 pl-6 py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider text-center">
                        Fav
                      </TableHead>
                      <TableHead className="py-4 pl-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Name
                      </TableHead>
                      <TableHead className="w-32 py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider text-center">
                        Status
                      </TableHead>
                      <TableHead className="w-20 text-center py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Assets
                      </TableHead>
                      <TableHead className="w-20 text-center py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Schemas
                      </TableHead>
                      <TableHead className="w-40 text-right py-4 pr-6 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Created
                      </TableHead>
                      <TableHead className="w-20 text-right py-4 pr-6 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Actions
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="divide-y divide-border/60">
                    {nonFavoriteRuns.map((run) => (
                      <RunTableRow
                        key={run.id}
                        run={run}
                        activeRunId={activeRunId}
                        onSelectRun={onSelectRun}
                        onToggleFavorite={handleToggleFavoriteRun}
                        onShare={handleShareRun}
                        onExport={handleExportRun}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center backdrop-blur-sm bg-background/20">
              <div className="text-center text-muted-foreground border rounded-lg p-16">
                <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
                  <History className="h-6 w-6 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-medium mb-2">
                  {favoriteRunsFromList.length > 0 ? 'No other runs' : 'No run history available'}
                </h3>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  {favoriteRunsFromList.length > 0 
                    ? 'All your runs are favorited! Create new runs to see them here.' 
                    : 'Create your first annotation run to get started with analyzing your data.'
                  }
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
      
      {/* Share Dialog */}
      {sharingRun && (
        <ShareAnnotationRunDialog
          run={sharingRun}
          onClose={() => setSharingRun(null)}
        />
      )}
      
      {/* Hidden file input for import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".zip,.json"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />
    </div>
  );
};

export interface RunHistoryViewProps {
    runs: AnnotationRunRead[];
    activeRunId: number | null;
    onSelectRun: (runId: number) => void;
    isLoading: boolean;
}

export default function RunHistoryView({ runs, activeRunId, onSelectRun, isLoading }: RunHistoryViewProps) {
    if (isLoading && runs.length === 0) {
        return (
            <div className="flex-grow flex items-center justify-center">
                <div className="text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-12 w-12 animate-spin" />
                    <h3 className="mt-4 text-lg font-medium">Loading Run History</h3>
                    <p className="mt-1 text-sm">Please wait...</p>
                </div>
            </div>
        );
    }
    
    return (
        <div className="flex-grow bg-primary-950">
          <div className="h-[calc(100vh-8rem)]">
            <RunHistoryPanel 
                runs={runs}
                activeRunId={activeRunId}
                onSelectRun={onSelectRun}
            />
          </div>
        </div>
    );
} 