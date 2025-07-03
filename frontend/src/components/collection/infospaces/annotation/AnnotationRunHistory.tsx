'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Settings2, Repeat, Star, Loader2, ChevronDown, ChevronRight, History, Calendar, Clock, Play, Files, Microscope } from 'lucide-react';
import { cn } from "@/lib/utils";
import { AnnotationRunRead } from '@/client/models';
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

const FavoriteRunCard: React.FC<{
  run: AnnotationRunRead & { timestamp: string; documentCount: number; schemeCount: number };
  activeRunId?: number | null;
  onSelectRun: (runId: number) => void;
  onToggleFavorite: (run: AnnotationRunRead) => void;
}> = ({ run, activeRunId, onSelectRun, onToggleFavorite }) => {
  const config = run.configuration as any;
  const recurringTaskIdValue: unknown = config?.recurring_task_id;
  const isRecurring = typeof recurringTaskIdValue === 'number';
  const recurringTaskIdNumber = isRecurring ? recurringTaskIdValue : null;

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
      className={cn(
        "group relative p-2 rounded-xl cursor-pointer transition-all duration-200 border-2",
        "bg-gradient-to-br from-amber-50 via-yellow-50 to-amber-50",
        "hover:from-amber-100 hover:via-yellow-100 hover:to-amber-100",
        "hover:shadow-md hover:scale-[1.02]",
        activeRunId === run.id 
          ? "border-amber-400 shadow-lg ring-2 ring-amber-200" 
          : "border-amber-200 hover:border-amber-300"
      )}
      onClick={() => onSelectRun(run.id)}
    >
      {/* Favorite Star - Positioned absolutely */}
      <Button
        variant="ghost"
        size="icon"
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite(run);
        }}
        className="absolute top-3 right-3 h-8 w-8 hover:bg-amber-200/50"
      >
        <Star className="h-4 w-4 fill-amber-500 text-amber-600" />
      </Button>

      {/* Content */}
      <div className="flex flex-col h-32 pr-12">
        <div className="flex items-start gap-3 mb-3">
          <div className="p-2 rounded-lg bg-amber-200/50 border border-amber-300">
            <Play className="h-4 w-4 text-amber-700" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-amber-900 truncate" title={run.name}>
                {run.name}
              </h3>
              {isRecurring && (
                <TooltipProvider delayDuration={100}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Repeat className="h-4 w-4 text-amber-600 flex-shrink-0" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Recurring Run (Task ID: {recurringTaskIdNumber})</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
            {/* Fixed height container for description to maintain consistent layout */}
            <div className="h-10 mb-2">
              {run.description && (
                <p className="text-sm text-amber-700 line-clamp-2">{run.description}</p>
              )}
            </div>
          </div>
        </div>

        {/* Bottom row - always positioned at the bottom */}
        <div className="flex items-center justify-between mt-auto">
          <div className="flex items-center gap-4">
            <Badge 
              variant="outline" 
              className={cn("text-xs font-medium", getStatusColor(run.status ?? ''))}
            >
              {(run.status ?? '').replace(/_/g, ' ')}
            </Badge>
            <div className="flex items-center gap-3 text-xs text-amber-700">
              <span className="flex items-center gap-1.5">
                <Files className="h-3.5 w-3.5" />
                {run.documentCount} assets
              </span>
              <span className="flex items-center gap-1.5">
                <Microscope className="h-3.5 w-3.5" />
                {run.schemeCount} schemes
              </span>
            </div>
          </div>
          <div className="text-right text-xs text-amber-600 flex-shrink-0">
            <div className="flex items-center gap-1 justify-end">
              <Calendar className="h-3 w-3" />
              {format(parseISO(run.created_at), 'MMM d, yyyy')}
            </div>
          </div>
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
}> = ({ run, activeRunId, onSelectRun, onToggleFavorite }) => {
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
        "hover:shadow-lg hover:shadow-foreground/5 hover:-translate-y-0.5",
        activeRunId === run.id && "bg-gradient-to-r from-primary/5 via-primary/2 to-primary/5 shadow-lg shadow-primary/10 border-l-4 border-l-primary"
      )}
      onClick={() => onSelectRun(run.id)}
    >
      <TableCell className="w-16 pl-6">
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
              "hover:bg-gradient-to-br hover:from-amber-100 hover:to-yellow-100 dark:hover:from-amber-900/50 dark:hover:to-yellow-900/50",
              "hover:shadow-md hover:shadow-amber-200/50 dark:hover:shadow-amber-800/30 hover:scale-110",
              "border border-transparent hover:border-amber-200 dark:hover:border-amber-700"
            )}
          >
            <Star className="h-4 w-4 text-muted-foreground hover:text-amber-500 transition-colors duration-200" />
          </Button>
        </div>
      </TableCell>
      <TableCell className="font-medium py-6">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20 shadow-sm">
            <Play className="h-4 w-4 text-primary" />
          </div>
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
      <TableCell className="py-6">
        <div className="flex items-center justify-center">
          <Badge 
            className={cn(
              "capitalize font-medium text-xs px-3 py-1.5 rounded-full border shadow-sm pointer-events-none",
              getStatusColor(run.status ?? '')
            )}
          >
            {(run.status ?? '').replace(/_/g, ' ')}
          </Badge>
        </div>
      </TableCell>
      <TableCell className="text-center py-6">
        <div className="flex items-center justify-center gap-1.5">
          <div className="p-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/50 border border-blue-100 dark:border-blue-800">
            <Files className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
          </div>
          <span className="font-semibold text-foreground">{run.documentCount}</span>
        </div>
      </TableCell>
      <TableCell className="text-center py-6">
        <div className="flex items-center justify-center gap-1.5">
          <div className="p-1.5 rounded-lg bg-purple-50 dark:bg-purple-900/50 border border-purple-100 dark:border-purple-800">
            <Microscope className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />
          </div>
          <span className="font-semibold text-foreground">{run.schemeCount}</span>
        </div>
      </TableCell>
      <TableCell className="text-right text-sm text-muted-foreground py-6 pr-6">
        <div className="flex items-center gap-1.5 justify-end">
          <Calendar className="h-3.5 w-3.5 text-muted-foreground/70" />
          <span className="font-medium">{format(parseISO(run.created_at), 'MMM d, yyyy')}</span>
        </div>
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
  
  const { addFavoriteRun, removeFavoriteRun, isFavorite } = useFavoriteRunsStore();
  const favoriteRuns = useFavoriteRunsStore(state => state.favoriteRuns);
  const favoriteRunIds = useMemo(() => favoriteRuns.map(r => r.id), [favoriteRuns]);
  const { activeInfospace } = useInfospaceStore();

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
      <div className="flex-shrink-0 bg-background/95 backdrop-blur-sm border-b border-border/20">
        <div className="p-4 pb-0">
          {/* Main Header Row */}
          <div className="flex items-center justify-between mb-6">
            {/* Left Side - Title and Icon */}
            <div className="flex items-center gap-4 pl-2">
              <div className="p-3 rounded-xl bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20 shadow-sm">
                <History className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-foreground">Run History</h1>
                <p className="text-muted-foreground text-sm">
                  {runs.length} total runs • {favoriteRunsFromList.length} favorited
                </p>
              </div>
            </div>

            {/* Right Side - Search and Settings */}
            <div className="flex items-center gap-3">
              <div className="relative">
                <Input
                  placeholder="Search runs..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-96 h-10 bg-background/50 border-primary/50 focus:border-primary/50 focus:bg-background transition-colors"
                />
              </div>
              <Popover>
                <PopoverTrigger asChild>
                  <Button 
                    variant="outline" 
                    size="icon"
                    className="bg-background/50 border-border/60 hover:bg-muted/80 hover:border-border transition-colors"
                  >
                    <Settings2 className="h-4 w-4" />
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

          

          {/* Favorites Section */}
          {favoriteRunsFromList.length > 0 && (
            <div className="space-y-4 mb-2">
              <div 
                className="flex items-center justify-between cursor-pointer hover:bg-muted/30 rounded-lg transition-colors"
                onClick={() => setIsFavoritesExpanded(!isFavoritesExpanded)}
              >
                <div className="flex items-center gap-2 px-2">
                  <Star className="h-5 w-5 text-amber-500 fill-amber-400" />
                  <h2 className="text-lg font-semibold text-amber-600">Favorite Runs</h2>
                  <Badge variant="secondary" className="bg-amber-100 text-amber-600">
                    {favoriteRunsFromList.length}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-amber-700 hover:text-amber-600 hover:bg-amber-50"
                  >
                    {isFavoritesExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              
              <Collapsible open={isFavoritesExpanded}>
                <CollapsibleContent>
                  <div className="max-h-64 overflow-y-auto scrollbar-thin p-4">
                    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 pb-2">
                      {favoriteRunsFromList.map((run) => (
                        <FavoriteRunCard
                          key={`favorite-${run.id}`}
                          run={run}
                          activeRunId={activeRunId}
                          onSelectRun={onSelectRun}
                          onToggleFavorite={handleToggleFavoriteRun}
                        />
                      ))}
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
        {/* All Runs Header - Fixed */}
        <div className="flex-shrink-0 bg-background/95 backdrop-blur-sm border-b border-border/20 p-2 pb-0 px-6">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <History className="h-5 w-5 text-muted-foreground" />
            All Runs
            <Badge variant="outline">{nonFavoriteRuns.length}</Badge>
          </h2>
        </div>

        {/* All Runs Table - Scrollable Content */}
        <div className="flex-1 overflow-hidden p-8 scrollbar-hide">
          {nonFavoriteRuns.length > 0 ? (
            <div className="bg-gradient-to-br from-background via-muted/50 to-background rounded-2xl border border-border/60 overflow-hidden backdrop-blur-sm h-full flex flex-col">
              {/* Table Header - Fixed within table */}
              <div className="flex-shrink-0">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gradient-to-r from-muted/80 via-muted/60 to-muted/80">
                      <TableHead className="w-16 pl-6 py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        <div className="flex items-center justify-center">
                          <Star className="h-4 w-4 text-muted-foreground/50" />
                        </div>
                      </TableHead>
                      <TableHead className="py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 rounded-xl bg-primary/10 border border-primary/20">
                            <Play className="h-4 w-4 text-primary" />
                          </div>
                          Run Details
                        </div>
                      </TableHead>
                      <TableHead className="w-32 py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        <div className="flex items-center justify-center gap-1.5">
                          <div className="p-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/50 border border-emerald-100 dark:border-emerald-800">
                            <div className="w-3.5 h-3.5 rounded-full bg-emerald-500"></div>
                          </div>
                          Status
                        </div>
                      </TableHead>
                      <TableHead className="w-20 text-center py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        <div className="flex items-center justify-center gap-1.5">
                          <div className="p-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/50 border border-blue-100 dark:border-blue-800">
                            <Files className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                          </div>
                          Assets
                        </div>
                      </TableHead>
                      <TableHead className="w-20 text-center py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        <div className="flex items-center justify-center gap-1.5">
                          <div className="p-1.5 rounded-lg bg-purple-50 dark:bg-purple-900/50 border border-purple-100 dark:border-purple-800">
                            <Microscope className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />
                          </div>
                          Schemes
                        </div>
                      </TableHead>
                      <TableHead className="w-40 text-right py-4 pr-6 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        <div className="flex items-center justify-end gap-1.5">
                          <Calendar className="h-3.5 w-3.5 text-muted-foreground/70" />
                          Created
                        </div>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                </Table>
              </div>
              
              {/* Table Body - Scrollable */}
              <div className="flex-1 overflow-y-auto">
                <Table>
                  <TableBody className="divide-y divide-border/60 ">
                    {nonFavoriteRuns.map((run, index) => (
                      <RunTableRow
                        key={run.id}
                        run={run}
                        activeRunId={activeRunId}
                        onSelectRun={onSelectRun}
                        onToggleFavorite={handleToggleFavoriteRun}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="text-center text-muted-foreground border rounded-lg bg-muted/20 p-16">
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