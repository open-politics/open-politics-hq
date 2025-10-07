'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, X, AlertCircle, Info, Pencil, BarChart3, Table as TableIcon, MapPin, SlidersHorizontal, XCircle, RefreshCw, AlertTriangle, ChevronDown, ChevronUp, PieChartIcon, Download, Share2, Network, LayoutDashboard, FileText, Sparkles, Trash2, Microscope, Image as ImageIcon, Video, Music, Globe, Type, Mail, Eye } from 'lucide-react';
import {
  AnnotationSchemaRead,
  AssetRead,
  AnnotationRunRead,
  AnnotationRead,
  AnnotationRunUpdate,
} from '@/client';
import { FormattedAnnotation, TimeAxisConfig } from '@/lib/annotations/types';
import AnnotationResultsChart from './AnnotationResultsChart';
import AnnotationResultsPieChart from './AnnotationResultsPieChart';
import { format } from 'date-fns';
import { ResultFilter, FilterSet } from './AnnotationFilterControls';
import { getTargetKeysForScheme } from '@/lib/annotations/utils';
import { checkFilterMatch, extractLocationString } from '@/lib/annotations/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast as sonnerToast } from 'sonner';
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils";
import AssetDetailView from '../assets/Views/AssetDetailView';
import AnnotationResultDisplay from './AnnotationResultDisplay';
import EnhancedAnnotationDialog from './EnhancedAnnotationDialog';
import { useTutorialStore } from '../../../zustand_stores/storeTutorial';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { HelpCircle } from 'lucide-react';
import useGeocode, { GeocodeResult } from '@/hooks/useGeocder';
import type { GeocodeResult as GeocodeResultType } from '@/hooks/useGeocder';
import AnnotationResultsMap, { MapPoint } from './AnnotationResultsMap';
import { TextSpanHighlightProvider } from '@/components/collection/contexts/TextSpanHighlightContext';
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useAnnotationSettingsStore } from '@/zustand_stores/storeAnnotationSettings';
import AnnotationSchemaEditor from './AnnotationSchemaEditor';
import { useGeocodingCacheStore } from '@/zustand_stores/storeGeocodingCache';
import AnnotationResultsTable from './AnnotationResultsTable';
import AnnotationResultsGraph from './AnnotationResultsGraph';
import { Switch } from '@/components/ui/switch';
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { useAnnotationRunStore, PanelViewConfig } from '@/zustand_stores/useAnnotationRunStore';
import { DashboardToolbar } from './DashboardToolbar';
import { PanelRenderer } from './PanelRenderer';
import { useShareableStore } from '@/zustand_stores/storeShareables';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { AnnotationMapControls } from './AnnotationMapControls';
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { adaptEnhancedAnnotationToFormattedAnnotation } from '@/lib/annotations/adapters';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import Link from 'next/link';
import { AnnotationTimeAxisControls } from './AnnotationTimeAxisControls';
import { SchemePreview } from './schemaCreation/SchemePreview';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAnnotationSystem } from '@/hooks/useAnnotationSystem';
import { AnnotationResultStatus } from '@/lib/annotations/types';
import { toast } from 'sonner';
import AssetSelector from '../assets/AssetSelector';
import AnnotationSchemaCard from './AnnotationSchemaCard';
import AssetDetailProvider from '../assets/Views/AssetDetailProvider';
import RunHistoryView from './AnnotationRunHistory';
import { nanoid } from 'nanoid';

export type FilterLogicMode = 'and' | 'or';

// Helper function to get asset icon
const getAssetIcon = (kind: string) => {
  switch (kind) {
    case 'pdf':
      return <FileText className="w-4 h-4" />;
    case 'csv':
      return <TableIcon className="w-4 h-4" />;
    case 'image':
      return <ImageIcon className="w-4 h-4" />;
    case 'video':
      return <Video className="w-4 h-4" />;
    case 'audio':
      return <Music className="w-4 h-4" />;
    case 'web':
    case 'article':
      return <Globe className="w-4 h-4" />;
    case 'text':
    case 'text_chunk':
      return <Type className="w-4 h-4" />;
    case 'email':
    case 'mbox':
      return <Mail className="w-4 h-4" />;
    default:
      return <FileText className="w-4 h-4" />;
  }
};

// Simple asset list component for the runner
interface RunAssetListProps {
  assets: AssetRead[];
  onAssetView: (asset: AssetRead) => void;
}

const RunAssetList: React.FC<RunAssetListProps> = ({ assets, onAssetView }) => {
  return (
    <div className="space-y-3">
      {assets.map((asset) => (
        <Card key={asset.id} className="p-4 border border-green-200 dark:border-green-800 bg-green-50/20 dark:bg-green-950/10 hover:bg-green-100/30 dark:hover:bg-green-900/20 transition-colors">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-1.5 rounded-md bg-green-500/20 dark:bg-green-500/20 text-green-700 dark:text-green-400">
                  {getAssetIcon(asset.kind)}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-base truncate text-gray-900 dark:text-gray-100">
                    {asset.title || `Asset ${asset.id}`}
                  </h3>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-950/20 dark:text-green-400 dark:border-green-800 text-xs">
                      {asset.kind.replace('_', ' ').toUpperCase()}
                    </Badge>
                    <span className="text-xs text-gray-500 dark:text-gray-500">
                      ID: {asset.id}
                    </span>
                  </div>
                </div>
              </div>
              
              {asset.text_content && (
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-2 line-clamp-2">
                  {asset.text_content.substring(0, 200)}...
                </p>
              )}
              
              <div className="flex items-center gap-4 mt-3 text-xs text-gray-500 dark:text-gray-500">
                <span>Created: {format(new Date(asset.created_at), 'MMM d, yyyy')}</span>
                {asset.updated_at && asset.updated_at !== asset.created_at && (
                  <span>Updated: {format(new Date(asset.updated_at), 'MMM d, yyyy')}</span>
                )}
                {asset.source_metadata?.filename && typeof asset.source_metadata.filename === 'string' ? (
                  <span>File: {asset.source_metadata.filename}</span>
                ) : null}
              </div>
            </div>
            
            <div className="flex gap-2 ml-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onAssetView(asset)}
                className="border-green-200 dark:border-green-800 bg-green-50/20 dark:bg-green-950/10 text-green-700 dark:text-green-400 hover:bg-green-100/50 dark:hover:bg-green-900/20"
              >
                <Eye className="w-4 h-4 mr-1" />
                View Details
              </Button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
};

interface AnnotationRunnerProps {
  allRuns: AnnotationRunRead[];
  isLoadingRuns: boolean;
  onSelectRun: (runId: number) => void;
  allSchemas: AnnotationSchemaRead[];
  allSources: { id: number; name: string }[];
  activeRun: AnnotationRunRead | null;
  isProcessing: boolean;
  results: FormattedAnnotation[];
  assets: AssetRead[];
  onClearRun: () => void;
  onRunWithNewAssets: (template: { schemaIds: number[], config: any, assetIds: number[] }) => void;
  onRetrySingleResult?: (resultId: number, customPrompt?: string) => Promise<AnnotationRead | null>;
}

// --- Note: PanelRenderer is now imported from separate file ---

export default function AnnotationRunner({
  allRuns,
  isLoadingRuns,
  onSelectRun,
  allSchemas,
  allSources,
  activeRun,
  isProcessing: isProcessingProp,
  results: currentRunResults,
  assets: currentRunAssets,
  onClearRun,
  onRunWithNewAssets,
  onRetrySingleResult: onRetrySingleResultProp,
}: AnnotationRunnerProps) {
  const {
    retryJobFailures,
    isRetryingJob,
    retrySingleResult: hookRetrySingleResult,
    isRetryingResultId,
    updateJob,
    deleteRun,
  } = useAnnotationSystem();
  
  // Use prop version if provided, otherwise use hook version
  const retrySingleResult = onRetrySingleResultProp || hookRetrySingleResult;
  
  const isActuallyProcessing = isProcessingProp || isRetryingJob;

  // State managed by Zustand now
  const {
    dashboardConfig,
    isDashboardDirty,
    setDashboardConfig,
    updateDashboardConfig,
    addPanel,
    updatePanel,
    removePanel,
    compactLayout,
    setDashboardDirty,
    saveDashboardToBackend,
    loadDashboardFromRun,
    setActiveRun,
  } = useAnnotationRunStore();
  
  const { activeInfospace } = useInfospaceStore();

  // Initialize dashboard config when activeRun changes
  useEffect(() => {
    setActiveRun(activeRun); // This handles both activeRun and null cases
  }, [activeRun, setActiveRun]);

  // Auto-add initial table panel when run loads as completed
  useEffect(() => {
    if (activeRun && 
        (activeRun.status === 'completed' || activeRun.status === 'completed_with_errors') &&
        dashboardConfig && 
        (!dashboardConfig.panels || dashboardConfig.panels.length === 0) &&
        currentRunResults.length > 0) {
      
      // Add initial table panel with full width
      const initialTablePanel = {
        id: `table-${Date.now()}`,
        type: 'table' as const,
        name: 'Results Table',
        description: 'Complete annotation results in tabular format',
        gridPos: { x: 0, y: 0, w: 12, h: 4 },
        filters: { logic: 'and' as const, rules: [] },
        settings: {}
      };

      console.log('Auto-adding initial table panel for completed run:', activeRun.id);
      addPanel(initialTablePanel);
    }
  }, [activeRun, dashboardConfig, currentRunResults, addPanel]);

  const [isEditingName, setIsEditingName] = useState(false);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [isSchemesCollapsed, setIsSchemesCollapsed] = useState(false);
  const [isSourceStatsOpen, setIsSourceStatsOpen] = useState(false);
  const [isAssetSelectorOpen, setIsAssetSelectorOpen] = useState(false);
  const [selectedAssetIds, setSelectedAssetIds] = useState<number[]>([]);
  const [viewingSchema, setViewingSchema] = useState<AnnotationSchemaRead | null>(null);

  // Dialog state - changed to support both annotation results and map points
  const [isResultDialogOpen, setIsResultDialogOpen] = useState(false);
  const [selectedAnnotationResult, setSelectedAnnotationResult] = useState<FormattedAnnotation | null>(null);
  const [selectedAssetId, setSelectedAssetId] = useState<number | null>(null);
  const [selectedMapPointForDialog, setSelectedMapPointForDialog] = useState<MapPoint | null>(null);
  const [previousAnnotationResult, setPreviousAnnotationResult] = useState<FormattedAnnotation | null>(null); // Track previous annotation when viewing asset

  // NEW: Enhanced annotation dialog state
  const [isEnhancedDialogOpen, setIsEnhancedDialogOpen] = useState(false);
  const [enhancedSelectedResult, setEnhancedSelectedResult] = useState<FormattedAnnotation | null>(null);
  const [enhancedSelectedSchema, setEnhancedSelectedSchema] = useState<AnnotationSchemaRead | null>(null);

  // Clear all dialog selections
  const closeDetailsDialog = useCallback(() => {
    setIsResultDialogOpen(false);
    setSelectedAnnotationResult(null);
    setSelectedAssetId(null);
    setSelectedMapPointForDialog(null);
    setPreviousAnnotationResult(null);
  }, []);

  // NEW: Close enhanced dialog
  const closeEnhancedDialog = useCallback(() => {
    setIsEnhancedDialogOpen(false);
    setEnhancedSelectedResult(null);
    setEnhancedSelectedSchema(null);
  }, []);

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isSchemasDialogOpen, setIsSchemasDialogOpen] = useState(false);
  const [isAssetsDialogOpen, setIsAssetsDialogOpen] = useState(false);
  
  const runSchemes = useMemo(() => {
    const config = activeRun?.configuration as any;
    const schemeIds = (activeRun as any)?.schema_ids || config?.schema_ids || (activeRun as any)?.target_schema_ids || [];
    if (!schemeIds || schemeIds.length === 0) return [];
    return allSchemas.filter(s => schemeIds.includes(s.id));
  }, [activeRun, allSchemas]);

  // NEW: Handle field interactions from charts/visualizations
  const handleFieldInteraction = useCallback((result: FormattedAnnotation, fieldKey: string) => {
    const schema = runSchemes.find(s => s.id === result.schema_id) || runSchemes[0];
    
    // Add the selected field information to the result for auto-selection in enhanced dialog
    const resultWithSelectedField = {
      ...result,
      _selectedField: fieldKey
    } as FormattedAnnotation & { _selectedField?: string };
    
    setEnhancedSelectedResult(resultWithSelectedField);
    setEnhancedSelectedSchema(schema);
    setIsEnhancedDialogOpen(true);
  }, [runSchemes]);

  const runDataSources = useMemo(() => allSources, [allSources]);

  const sourceStats = useMemo(() => {
    if (!currentRunAssets || currentRunAssets.length === 0 || !runDataSources) {
      return null;
    }

    const totalRecords = currentRunAssets.length;
    const sourceCounts: Record<number, number> = {};
    const sourceMap = new Map(runDataSources.map((ds: any) => [ds.id, ds.name || `Source ${ds.id}`]));
    
    currentRunAssets.forEach((record: any) => {
      const sourceId = record.source_id;
      if (sourceId !== null && sourceId !== undefined) {
        if(sourceMap.has(sourceId)) {
          sourceCounts[sourceId] = (sourceCounts[sourceId] || 0) + 1;
        }
      }
    });

    const detailedStats = Object.entries(sourceCounts)
      .map(([dsIdStr, count]) => {
        const dsId = parseInt(dsIdStr);
        const percentage = totalRecords > 0 ? ((count / totalRecords) * 100).toFixed(1) : '0.0';
        return {
          id: dsId,
          name: sourceMap.get(dsId) || `Source ${dsId}`,
          count: count,
          percentage: `${percentage}%`
        };
      })
      .sort((a, b) => b.count - a.count);

    return {
      totalRecords,
      totalSourcesInRun: runDataSources.length,
      sourcesWithRecordsCount: detailedStats.length,
      detailedStats
    };
  }, [currentRunAssets, runDataSources]);

  const handleEditClick = (field: 'name' | 'description') => {
    if (field === 'name') setIsEditingName(true);
    else setIsEditingDescription(true);
  };

  const handleUpdate = (field: 'name' | 'description', value: string) => {
    if (!activeRun) return;
    const updatePayload: AnnotationRunUpdate = { [field]: value };
    updateJob(activeRun.id, updatePayload);
    if (field === 'name') setIsEditingName(false);
    if (field === 'description') setIsEditingDescription(false);
  };
  
  const handleKeyDown = (e: React.KeyboardEvent<HTMLSpanElement>, field: 'name' | 'description') => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleUpdate(field, e.currentTarget.innerText);
      e.currentTarget.blur();
    }
    if (e.key === 'Escape') {
      e.currentTarget.innerText = field === 'name' ? activeRun?.name ?? '' : activeRun?.description ?? '';
      e.currentTarget.blur();
    }
  };

  const handleDeleteRun = async () => {
    if (!activeRun) return;
    try {
      await deleteRun(activeRun.id);
      setIsDeleteDialogOpen(false);
      onClearRun(); // Clear the active run from parent component
      toast.success(`Run "${activeRun.name}" deleted successfully.`);
    } catch (error) {
      console.error('Error deleting run:', error);
      // Error toast is already handled by deleteRun hook
    }
  };

  if (!activeRun) {
    return (
      <RunHistoryView 
        runs={allRuns}
        activeRunId={null}
        onSelectRun={onSelectRun}
        isLoading={isLoadingRuns}
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-auto">
      <div className="p-4 flex-1 space-y-4">
        <div className="p-3 rounded-md bg-muted/10 flex items-center justify-between sticky top-0 bg-background/95 backdrop-blur z-10 flex-wrap gap-2">
          <div className="flex flex-col flex-1 min-w-0 mr-4">
            <div className="flex items-center gap-1">
              <span
                  id="run-name-editable"
                  className={`font-medium text-base px-1 truncate ${isEditingName ? 'outline outline-1 outline-primary bg-background' : 'hover:bg-muted/50 cursor-text'}`}
                  contentEditable={isEditingName ? 'true' : 'false'}
                  suppressContentEditableWarning={true}
                  onBlur={(e) => handleUpdate('name', e.currentTarget.innerText)}
                  onKeyDown={(e) => handleKeyDown(e, 'name')}
                  onClick={() => !isEditingName && handleEditClick('name')}
                  title={activeRun.name}
              >
                  {activeRun.name}
              </span>
              <TooltipProvider delayDuration={100}>
                <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => handleEditClick('name')}><Pencil className="h-3 w-3" /></Button>
                    </TooltipTrigger>
                    <TooltipContent><p>Edit Run Name</p></TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <div className="flex items-center gap-1 mt-1">
               <span
                  id="run-description-editable"
                  className={`text-sm px-1 truncate ${isEditingDescription ? 'outline outline-1 outline-primary bg-background w-full' : 'hover:bg-muted/50 cursor-text italic text-muted-foreground'}`}
                  contentEditable={isEditingDescription ? 'true' : 'false'}
                  suppressContentEditableWarning={true}
                  onBlur={(e) => handleUpdate('description', e.currentTarget.innerText)}
                  onKeyDown={(e) => handleKeyDown(e, 'description')}
                  onClick={() => !isEditingDescription && handleEditClick('description')}
                  title={activeRun.description || 'Add a description...'}
              >
                  {activeRun.description || 'Add a description...'}
              </span>
               <TooltipProvider delayDuration={100}>
                  <Tooltip>
                      <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={() => handleEditClick('description')}><Pencil className="h-3 w-3" /></Button>
                      </TooltipTrigger>
                      <TooltipContent><p>Edit Description</p></TooltipContent>
                  </Tooltip>
              </TooltipProvider>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Badge variant={
                 activeRun?.status === 'completed' ? 'default'
                 : activeRun?.status === 'failed' ? 'destructive'
                 : activeRun?.status === 'running' ? 'secondary'
                 : activeRun?.status === 'pending' ? 'secondary'
                 : activeRun?.status === 'completed_with_errors' ? 'outline'
                 : 'outline'
              } className="capitalize">
                {(isActuallyProcessing || activeRun?.status === 'running' || activeRun?.status === 'pending') && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                {(activeRun?.status ?? '').replace(/_/g, ' ')}
              </Badge>
              {(activeRun?.status === 'failed' || activeRun?.status === 'completed_with_errors') && (
                <TooltipProvider delayDuration={100}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (activeRun?.id) {
                              retryJobFailures(activeRun.id);
                          }
                        }}
                        disabled={isActuallyProcessing || !activeRun?.id}
                        className="h-6 px-2"
                      >
                        <RefreshCw className={`h-3 w-3 mr-1 ${isRetryingJob ? 'animate-spin' : ''}`} />
                        {activeRun?.status === 'failed' ? 'Retry Run' : 'Retry Failed Items'}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{activeRun?.status === 'failed' ? 'Restart the entire run from the beginning.' : 'Attempt to re-run only the annotations that failed.'}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
            {activeRun?.status === 'failed' && activeRun.error_message && (
               <Alert variant="destructive" className="mt-2 text-xs p-2">
                 <AlertCircle className="h-4 w-4" />
                 <AlertTitle>Run Failed</AlertTitle>
                 <AlertDescription>{activeRun.error_message}</AlertDescription>
               </Alert>
            )}
             {activeRun?.status === 'completed_with_errors' && (
               <Alert variant="default" className="mt-2 text-xs p-2 bg-yellow-100 dark:bg-yellow-900/30 border-yellow-300 dark:border-yellow-700">
                 <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
                 <AlertTitle className="text-yellow-800 dark:text-yellow-200">Completed with Errors</AlertTitle>
                 <AlertDescription className="text-yellow-700 dark:text-yellow-300">
                   Some annotations may have failed. {activeRun.error_message && `Error: ${activeRun.error_message}`}
                 </AlertDescription>
               </Alert>
            )}
          </div>
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setIsSchemasDialogOpen(true)}
              disabled={!activeRun?.id || runSchemes.length === 0}
              className="border-sky-200 dark:border-sky-800 bg-sky-50/20 dark:bg-sky-950/10 text-sky-700 dark:text-sky-400 hover:bg-sky-100/50 dark:hover:bg-sky-900/20"
            >
              <Microscope className="h-4 w-4 mr-1" /> View Schemas ({runSchemes.length})
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setIsAssetsDialogOpen(true)}
              disabled={!activeRun?.id || currentRunAssets.length === 0}
              className="border-green-200 dark:border-green-800 bg-green-50/20 dark:bg-green-950/10 text-green-700 dark:text-green-400 hover:bg-green-100/50 dark:hover:bg-green-900/20"
            >
              <FileText className="h-4 w-4 mr-1" /> View Assets ({currentRunAssets.length})
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setIsDeleteDialogOpen(true)}
              disabled={!activeRun?.id || isActuallyProcessing}
            >
              <Trash2 className="h-4 w-4 mr-1" /> Delete Run
            </Button>
            <Button variant="outline" size="sm" onClick={onClearRun} disabled={!activeRun?.id}>
              <XCircle className="h-4 w-4 mr-1" /> Clear Loaded Run
            </Button>
          </div>
        </div>

        <DashboardToolbar
          dashboardConfig={dashboardConfig}
          isDirty={isDashboardDirty}
          onSave={async () => {
            if (activeRun && activeInfospace) {
              await saveDashboardToBackend(activeInfospace.id, activeRun.id);
            }
          }}
          onUpdateConfig={updateDashboardConfig}
          onAddPanel={addPanel}
          onCompactLayout={compactLayout}
          activeRun={activeRun}
          allSchemas={runSchemes}
          allResults={currentRunResults}
        />

        <div className="mt-2 flex-1 min-h-0">
          {isActuallyProcessing ? (
            <div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin" /> <span className="ml-2">Run is processing...</span></div>
          ) : !dashboardConfig ? (
            <div className="flex items-center justify-center h-64 text-muted-foreground">Loading dashboard configuration...</div>
          ) : (
            /* Dynamic Grid Layout with Proper Positioning */
            <div 
              className="relative w-full overflow-hidden"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', // Use minmax for better responsive behavior
                gap: 'clamp(0.5rem, 2vw, 1rem)', // Responsive gap
                gridAutoRows: '150px', // Fixed height per grid unit - NO AUTO GROWTH!
                minHeight: (() => {
                  try {
                    if (!dashboardConfig?.panels || dashboardConfig.panels.length === 0) {
                      return '300px';
                    }
                    
                    // Calculate the exact height needed for all panels
                    const heights = dashboardConfig.panels
                      .filter(p => p && p.gridPos && typeof p.gridPos.y === 'number' && typeof p.gridPos.h === 'number')
                      .map(p => (p.gridPos.y || 0) + (p.gridPos.h || 0));
                    
                    if (heights.length === 0) {
                      return '300px';
                    }
                    
                    const maxHeight = Math.max(...heights);
                    return `${Math.max(maxHeight, 2) * 150}px`;
                  } catch (error) {
                    console.warn('Error calculating grid height:', error);
                    return '300px';
                  }
                })(),
                // Ensure the grid can expand as needed
                paddingBottom: '2rem'
              }}
            >
              {(dashboardConfig?.panels || [])
                .filter(panel => panel && panel.id && panel.gridPos) // Filter out invalid panels
                .sort((a, b) => {
                  // Sort by y position first, then x position for consistent rendering
                  const aY = a.gridPos?.y || 0;
                  const bY = b.gridPos?.y || 0;
                  const aX = a.gridPos?.x || 0;
                  const bX = b.gridPos?.x || 0;
                  
                  if (aY !== bY) {
                    return aY - bY;
                  }
                  return aX - bX;
                })
                .map(panel => {
                  // Defensive handling of panel properties
                  const gridPos = panel.gridPos || { x: 0, y: 0, w: 6, h: 4 };
                  const safeX = Math.max(0, Math.min(11, gridPos.x || 0));
                  const safeY = Math.max(0, gridPos.y || 0);
                  const safeW = Math.max(1, Math.min(12 - safeX, gridPos.w || 6));
                  const safeH = Math.max(1, gridPos.h || 4);

                  return (
                    <div 
                      key={panel.id}
                      className={cn(
                        "relative transition-all duration-200 ease-in-out overflow-hidden",
                        // Responsive behavior for smaller screens
                        "min-w-0 w-full h-full",
                        // Stack panels on very small screens
                        "max-sm:col-span-12"
                      )}
                      style={{
                        gridColumn: `${safeX + 1} / span ${safeW}`,
                        gridRow: `${safeY + 1} / span ${safeH}`,
                        minHeight: `${safeH * 150}px`,
                        maxHeight: `${safeH * 150}px`, // ENFORCE maximum height!
                        height: `${safeH * 150}px`, // Explicit height constraint
                        zIndex: 1
                      }}
                    >
                      <PanelRenderer 
                        panel={panel}
                        allResults={currentRunResults}
                        allSchemas={runSchemes}
                        allSources={allSources}
                        allAssets={currentRunAssets}
                        onUpdatePanel={updatePanel}
                        onRemovePanel={removePanel}
                        onMapPointClick={(point) => {
                          setSelectedMapPointForDialog(point);
                          setIsResultDialogOpen(true);
                        }}
                        activeRunId={activeRun?.id}
                        // NEW: Result interaction callbacks
                        onResultSelect={(result) => {
                          // Use enhanced dialog for better annotation viewing experience
                          const schema = runSchemes.find(s => s.id === result.schema_id) || runSchemes[0];
                          setEnhancedSelectedResult(result);
                          setEnhancedSelectedSchema(schema);
                          setIsEnhancedDialogOpen(true);
                        }}
                        onRetrySingleResult={retrySingleResult}
                        retryingResultId={isRetryingResultId}
                        onFieldInteraction={handleFieldInteraction}
                      />
                    </div>
                  );
                })
              }
              
              {/* Empty State */}
              {(!dashboardConfig?.panels || dashboardConfig.panels.length === 0) && (
                <div className="col-span-12 row-span-2 flex items-center justify-center border-2 border-dashed border-gray-300 rounded-lg bg-gray-50/50">
                  <div className="text-center text-gray-500">
                    <LayoutDashboard className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <h3 className="text-lg font-medium mb-2">No Dashboard Panels</h3>
                    <p className="text-sm">Use the toolbar above to add visualization panels to your dashboard.</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <Dialog open={isAssetSelectorOpen} onOpenChange={setIsAssetSelectorOpen}>
        <DialogContent className="max-w-7xl h-[80vh] flex flex-col">
            <DialogHeader>
                <DialogTitle>Select Assets for a New Run</DialogTitle>
                <DialogDescription>
                    Select assets or bundles to include in a new run using the previous run's configuration.
                </DialogDescription>
            </DialogHeader>
            <div className="flex-1 min-h-0">
                <AssetSelector
                    selectedItems={new Set(selectedAssetIds.map(id => `asset-${id}`))}
                    onSelectionChange={(newSelection) => {
                        const assetIds = Array.from(newSelection)
                            .filter(id => id.startsWith('asset-'))
                            .map(id => parseInt(id.replace('asset-', '')));
                        setSelectedAssetIds(assetIds);
                    }}
                />
            </div>
            <DialogFooter>
                <Button variant="outline" onClick={() => setIsAssetSelectorOpen(false)}>Cancel</Button>
                <Button onClick={() => {
                  if (!activeRun) return;
                  const schemaIds = (activeRun.configuration as any)?.schema_ids || (activeRun as any)?.target_schema_ids || [];
                  if (selectedAssetIds.length === 0) {
                    toast.warning("Please select at least one asset to run on.");
                    return;
                  }
                  onRunWithNewAssets({
                    schemaIds: schemaIds,
                    config: activeRun.configuration,
                    assetIds: selectedAssetIds
                  });
                  setIsAssetSelectorOpen(false);
                }}>Create New Run with Selection</Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>

    <Dialog open={isSchemasDialogOpen} onOpenChange={setIsSchemasDialogOpen}>
      <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Schemas Used in This Run</DialogTitle>
          <DialogDescription>
            This run uses {runSchemes.length} annotation schema{runSchemes.length !== 1 ? 's' : ''}. Click "View Details" to see the full schema definition.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="flex-1 p-4">
          {runSchemes.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              <LayoutDashboard className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No schemas found for this run.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {runSchemes.map((schema) => (
                <Card key={schema.id} className="p-4 border border-sky-200 dark:border-sky-800 bg-sky-50/20 dark:bg-sky-950/10">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="p-1.5 rounded-md bg-sky-500/20 dark:bg-sky-500/20 text-sky-700 dark:text-sky-400">
                          <Microscope className="w-4 h-4" />
                        </div>
                        <h3 className="font-semibold text-lg truncate text-gray-900 dark:text-gray-100">{schema.name}</h3>
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                        {schema.description || 'No description available'}
                      </p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-gray-500 dark:text-gray-500">
                        <span>ID: {schema.id}</span>
                        <span>Created: {format(new Date(schema.created_at), 'MMM d, yyyy')}</span>
                        {schema.updated_at && schema.updated_at !== schema.created_at && (
                          <span>Updated: {format(new Date(schema.updated_at), 'MMM d, yyyy')}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 ml-4">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setViewingSchema(schema);
                          setIsSchemasDialogOpen(false);
                        }}
                        className="border-sky-200 dark:border-sky-800 bg-sky-50/20 dark:bg-sky-950/10 text-sky-700 dark:text-sky-400 hover:bg-sky-100/50 dark:hover:bg-sky-900/20"
                      >
                        View Details
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" onClick={() => setIsSchemasDialogOpen(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={isAssetsDialogOpen} onOpenChange={setIsAssetsDialogOpen}>
      <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Assets Used in This Run</DialogTitle>
          <DialogDescription>
            This run processes {currentRunAssets.length} asset{currentRunAssets.length !== 1 ? 's' : ''}. Click "View Details" to see the full asset content.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="flex-1 p-4">
          {currentRunAssets.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No assets found for this run.</p>
            </div>
          ) : (
            <RunAssetList 
              assets={currentRunAssets} 
              onAssetView={(asset) => {
                setSelectedAssetId(asset.id);
                setIsResultDialogOpen(true);
                setIsAssetsDialogOpen(false);
              }}
            />
          )}
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" onClick={() => setIsAssetsDialogOpen(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AnnotationSchemaCard
        show={!!viewingSchema}
        onClose={() => setViewingSchema(null)}
        title={`Schema: ${viewingSchema?.name}`}
        mode="watch"
      >
        {viewingSchema && <SchemePreview scheme={viewingSchema} />}
    </AnnotationSchemaCard>

    <Dialog open={isResultDialogOpen} onOpenChange={closeDetailsDialog}> 
      <DialogContent className="max-w-[95vw] w-full max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Details</DialogTitle>
          <DialogDescription>
            {selectedAnnotationResult
              ? `Annotation result for Asset ID: ${selectedAnnotationResult.asset_id}`
              : selectedMapPointForDialog 
              ? `Showing assets for location: ${selectedMapPointForDialog.locationString}`
              : `Detailed view for the selected asset.`
            }
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-auto">
          <div className="min-w-0">
            <TextSpanHighlightProvider>
              { selectedAnnotationResult ? (
                <AnnotationResultDisplay
                  result={selectedAnnotationResult}
                  schema={runSchemes.find(s => s.id === selectedAnnotationResult.schema_id) || runSchemes[0]}
                  renderContext="dialog"
                  compact={false}
                />
              ) : selectedAssetId ? (
                <AssetDetailView
                    selectedAssetId={selectedAssetId}
                    schemas={runSchemes}
                    onLoadIntoRunner={() => {}}
                    onEdit={() => {}}
                    highlightAssetIdOnOpen={null}
                />
              ) : selectedMapPointForDialog ? (
                <div className="space-y-4">
                  {selectedMapPointForDialog.documentIds.map(assetId => (
                      <div key={assetId} className="pb-4 mb-4">
                          <h3 className="text-lg font-semibold mb-2">Asset #{assetId}</h3>
                           <AssetDetailView
                              selectedAssetId={assetId}
                              schemas={runSchemes}
                              onLoadIntoRunner={() => {}}
                              onEdit={() => {}}
                              highlightAssetIdOnOpen={null}
                           />
                      </div>
                  ))}
                </div>
              ) : null}
            </TextSpanHighlightProvider>
          </div>
        </div>
        <DialogFooter>
          {selectedAnnotationResult && (
            <Button 
              variant="outline" 
              onClick={() => {
                setPreviousAnnotationResult(selectedAnnotationResult);
                setSelectedAssetId(selectedAnnotationResult.asset_id);
                setSelectedAnnotationResult(null);
              }}
              className="mr-2"
            >
              <FileText className="mr-2 h-4 w-4" />
              View Asset Details
            </Button>
          )}
          {selectedAssetId && previousAnnotationResult && (
            <Button 
              variant="outline" 
              onClick={() => {
                setSelectedAnnotationResult(previousAnnotationResult);
                setSelectedAssetId(null);
                setPreviousAnnotationResult(null);
              }}
              className="mr-2"
            >
              <Sparkles className="mr-2 h-4 w-4" />
              Back to Annotation
            </Button>
          )}
          <Button variant="outline" onClick={closeDetailsDialog}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* NEW: Enhanced Annotation Dialog */}
    <EnhancedAnnotationDialog
      isOpen={isEnhancedDialogOpen}
      onClose={closeEnhancedDialog}
      result={enhancedSelectedResult}
      schema={enhancedSelectedSchema}
    />

    <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Annotation Run</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete the run "{activeRun?.name}"? This will permanently delete the run and all its annotations. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction 
            onClick={handleDeleteRun}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete Run
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </div>
  );
}