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
import { Loader2, X, AlertCircle, Info, Pencil, BarChart3, Table as TableIcon, MapPin, SlidersHorizontal, XCircle, RefreshCw, AlertTriangle, ChevronDown, ChevronUp, PieChartIcon, Download, Share2, Network } from 'lucide-react';
import {
  AnnotationSchemaRead,
  AssetRead,
  AnnotationRunRead,
  AnnotationRead,
  AnnotationRunUpdate,
} from '@/client/models';
import { FormattedAnnotation, TimeAxisConfig } from '@/lib/annotations/types';
import AnnotationResultsChart from './AnnotationResultsChart';
import AnnotationResultsPieChart from './AnnotationResultsPieChart';
import { format } from 'date-fns';
import { AnnotationResultFilters, ResultFilter, getTargetKeysForScheme } from './AnnotationResultFilters';
import { checkFilterMatch, extractLocationString } from '@/lib/annotations/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast as sonnerToast } from 'sonner';
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils";
import AssetDetailView from '../assets/Views/AssetDetailView';
import { useTutorialStore } from '../../../../zustand_stores/storeTutorial';
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
import { useAnnotationRunStore } from '@/zustand_stores/useAnnotationRunStore';
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

type SourceRead = any;

export type FilterLogicMode = 'and' | 'or';

interface AnnotationRunnerProps {
  allRuns: AnnotationRunRead[];
  isLoadingRuns: boolean;
  onSelectRun: (runId: number) => void;
  allSchemas: AnnotationSchemaRead[];
  allSources: SourceRead[];
  activeRun: AnnotationRunRead | null;
  isProcessing: boolean;
  results: FormattedAnnotation[];
  assets: AssetRead[];
  onClearRun: () => void;
  onRunWithNewAssets: (template: { schemaIds: number[], config: any, assetIds: number[] }) => void;
}

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
}: AnnotationRunnerProps) {
  const {
    retryJobFailures,
    isRetryingJob,
    retrySingleResult,
    isRetryingResultId,
    updateJob,
  } = useAnnotationSystem();
  
  const isActuallyProcessing = isProcessingProp || isRetryingJob;

  const [activeFilters, setActiveFilters] = useState<ResultFilter[]>([]);
  const [filterLogicMode, setFilterLogicMode] = useState<FilterLogicMode>('and');
  const [isResultDialogOpen, setIsResultDialogOpen] = useState(false);
  const [selectedAssetId, setSelectedAssetId] = useState<number | null>(null);
  const [selectedMapPointForDialog, setSelectedMapPointForDialog] = useState<MapPoint | null>(null);
  const [geocodedPoints, setGeocodedPoints] = useState<MapPoint[]>([]);
  const [filteredGeocodedPoints, setFilteredGeocodedPoints] = useState<MapPoint[]>([]);
  const [isLoadingGeocoding, setIsLoadingGeocoding] = useState(false);
  const [geocodingError, setGeocodingError] = useState<string | null>(null);
  const [currentMapLabelConfig, setCurrentMapLabelConfig] = useState<{ schemaId: number; fieldKey: string } | undefined>(undefined);
  const [currentTimeAxisConfig, setCurrentTimeAxisConfig] = useState<TimeAxisConfig | null>(null);
  const [initialMapControlsConfig, setInitialMapControlsConfig] = useState<{
    geocodeSchemaId: number | null;
    geocodeFieldKey: string | null;
    labelSchemeId: number | null;
    labelFieldKey: string | null;
    showLabels: boolean;
  }>({ geocodeSchemaId: null, geocodeFieldKey: null, labelSchemeId: null, labelFieldKey: null, showLabels: false });

  const [isEditingName, setIsEditingName] = useState(false);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [isSchemesCollapsed, setIsSchemesCollapsed] = useState(false);

  const [selectedDataSourceIdsForChart, setSelectedDataSourceIdsForChart] = useState<number[]>([]);
  const [selectedTimeInterval, setSelectedTimeInterval] = useState<'day' | 'week' | 'month' | 'quarter' | 'year'>('day');

  const [isSourceStatsOpen, setIsSourceStatsOpen] = useState(false);

  const [excludedRecordIdsSet, setExcludedRecordIdsSet] = useState<Set<number>>(new Set());
  const [isAssetSelectorOpen, setIsAssetSelectorOpen] = useState(false);
  const [selectedAssetIds, setSelectedAssetIds] = useState<number[]>([]);
  const [viewingSchema, setViewingSchema] = useState<AnnotationSchemaRead | null>(null);

  const { geocodeLocation, loading: isGeocodingSingle, error: geocodeSingleError } = useGeocode();
  const { getCache, setCache } = useGeocodingCacheStore();
  const { activeInfospace } = useInfospaceStore();

  const runSchemes = useMemo(() => {
    const config = activeRun?.configuration as any;
    
    const schemeIds = (activeRun as any)?.schema_ids ||
                   config?.schema_ids || 
                   (activeRun as any)?.target_schema_ids ||
                   [];
    
    if (!schemeIds || schemeIds.length === 0) {
      return [];
    }
    
    const foundSchemas = allSchemas.filter(s => schemeIds.includes(s.id));
    
    return foundSchemas;
  }, [activeRun, allSchemas]);

  const runDataSources = useMemo(() => {
    return allSources;
  }, [allSources]);

  const formattedRunResults = currentRunResults;

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

  useEffect(() => {
    if (runSchemes && runSchemes.length > 0) {
      let defaultGeoSchemeId: number | null = null;
      let defaultGeoFieldKey: string | null = null;
      let defaultLabelSchemeId: number | null = null;
      let defaultLabelFieldKey: string | null = null;
      let shouldShowLabels = false;

      const schemeToUseForGeo = runSchemes[0];

      if (schemeToUseForGeo) {
        const geoTargetKeys = getTargetKeysForScheme(schemeToUseForGeo.id, allSchemas);
        const locationKey = geoTargetKeys.find(k => k.name.toLowerCase().includes('location') || k.name.toLowerCase().includes('address'));
        
        if(locationKey || geoTargetKeys.length > 0) {
          defaultGeoSchemeId = schemeToUseForGeo.id;
          defaultGeoFieldKey = locationKey?.key || (geoTargetKeys.length > 0 ? geoTargetKeys[0].key : null);
          defaultLabelSchemeId = schemeToUseForGeo.id;
          defaultLabelFieldKey = defaultGeoFieldKey;
          shouldShowLabels = true;
        }
      }

      setInitialMapControlsConfig({
        geocodeSchemaId: defaultGeoSchemeId,
        geocodeFieldKey: defaultGeoFieldKey,
        labelSchemeId: defaultLabelSchemeId,
        labelFieldKey: defaultLabelFieldKey,
        showLabels: shouldShowLabels,
      });
    } else {
      setInitialMapControlsConfig({ geocodeSchemaId: null, geocodeFieldKey: null, labelSchemeId: null, labelFieldKey: null, showLabels: false });
    }
  }, [runSchemes, allSchemas]);

  useEffect(() => {
    const initialDataSourceIds = runDataSources.map((ds: any) => ds.id);
    setSelectedDataSourceIdsForChart(initialDataSourceIds);
  }, [runDataSources]);

  const generateGeocodingCacheKey = useCallback(() => {
    if (!activeInfospace?.id || !activeRun?.id) return null;
    return `${activeInfospace.id}-run-${activeRun.id}`;
  }, [activeInfospace?.id, activeRun]);

  const handleGeocodeRequest = useCallback(async (schemaIdStr: string, fieldKey: string) => {
    if (!activeRun?.id || !schemaIdStr || !fieldKey || !currentRunResults) {
      setGeocodedPoints([]);
      setFilteredGeocodedPoints([]);
      return;
    }
    const cacheKey = generateGeocodingCacheKey();
    if (cacheKey) {
        const cachedPoints = getCache(cacheKey);
        if (cachedPoints) {
            setGeocodedPoints(cachedPoints);
            const activeEnabledFilters = activeFilters.filter(f => f.isActive);
            if (activeEnabledFilters.length > 0) {
              // Re-filter points from cache
            } else {
              setFilteredGeocodedPoints(cachedPoints);
            }
            return;
        }
    }
    
    setIsLoadingGeocoding(true);
    setGeocodingError(null);
    setGeocodedPoints([]);
    setFilteredGeocodedPoints([]);

    const schemaIdNum = parseInt(schemaIdStr, 10);
    const locationStrings = new Set<string>();
    currentRunResults.forEach(result => {
      if (result.schema_id === schemaIdNum) {
        const loc = extractLocationString(result.value, fieldKey);
        if (loc) locationStrings.add(loc);
      }
    });

    if (locationStrings.size === 0) {
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
        geocodedData.set(locStr, null);
        errorsEncountered = true;
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (errorsEncountered) setGeocodingError("Some locations failed to geocode. See console for details.");

    const pointsMap = new Map<string, MapPoint>();
    currentRunResults.forEach(result => {
      if (result.schema_id === schemaIdNum) {
        const locStr = extractLocationString(result.value, fieldKey);
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
            if (!mapPoint.documentIds.includes(result.asset_id)) {
              mapPoint.documentIds.push(result.asset_id);
            }
          }
        }
      }
    });
    const newPoints = Array.from(pointsMap.values());
    setGeocodedPoints(newPoints);
    if (cacheKey) setCache(cacheKey, newPoints);
    setIsLoadingGeocoding(false);
  }, [
    activeRun?.id, currentRunResults, extractLocationString, geocodeLocation, generateGeocodingCacheKey, getCache, setCache, activeFilters, filterLogicMode, runSchemes
  ]);

  const toggleRecordExclusion = useCallback((recordId: number) => {
    setExcludedRecordIdsSet(prevSet => {
        const newSet = new Set(prevSet);
        if (newSet.has(recordId)) {
            newSet.delete(recordId);
        } else {
            newSet.add(recordId);
        }
        return newSet;
    });
  }, []);

  const filteredResults = useMemo(() => {
    const activeEnabledFilters = activeFilters.filter(f => f.isActive);
    let resultsToFilter = currentRunResults;

    if (activeEnabledFilters.length > 0) {
      const resultsByAssetId = currentRunResults.reduce<Record<number, FormattedAnnotation[]>>((acc, result) => {
        const assetId = result.asset_id;
        if (!acc[assetId]) acc[assetId] = [];
        acc[assetId].push(result);
        return acc;
      }, {});

      const filteredAssetIds = Object.keys(resultsByAssetId)
        .map(Number)
        .filter(assetId => {
          const assetResults = resultsByAssetId[assetId];
          if (filterLogicMode === 'and') {
            return activeEnabledFilters.every(filter => checkFilterMatch(filter, assetResults, runSchemes));
          } else { // 'or'
            return activeEnabledFilters.some(filter => checkFilterMatch(filter, assetResults, runSchemes));
          }
        });
      resultsToFilter = currentRunResults.filter(result => filteredAssetIds.includes(result.asset_id));
    }
    
    if (excludedRecordIdsSet.size > 0) {
      return resultsToFilter.filter(result => !excludedRecordIdsSet.has(result.asset_id));
    }
    
    return resultsToFilter;

  }, [currentRunResults, activeFilters, filterLogicMode, runSchemes, excludedRecordIdsSet]);

  useEffect(() => {
    const filteredPoints = geocodedPoints.filter(point => {
        const pointAssetIds = point.documentIds;
        return pointAssetIds.some(assetId => !excludedRecordIdsSet.has(assetId));
    });
    setFilteredGeocodedPoints(filteredPoints);
  }, [geocodedPoints, excludedRecordIdsSet]);

  useEffect(() => {
    setGeocodedPoints([]);
    setFilteredGeocodedPoints([]);
    setGeocodingError(null);
    setIsLoadingGeocoding(false);
  }, [activeRun?.id]);

  const handleTableRowClick = (result: FormattedAnnotation) => {
    setSelectedAssetId(result.asset_id);
    setSelectedMapPointForDialog(null);
    setIsResultDialogOpen(true);
  };

  const handleMapPointClick = (point: MapPoint) => {
    if (point.documentIds && point.documentIds.length > 0) {
      setSelectedAssetId(null);
      setSelectedMapPointForDialog(point);
      setIsResultDialogOpen(true);
    }
  };

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

  const handleShareActiveJob = () => {
    toast.info("Sharing not implemented yet.");
  };
  
  const handleExportActiveJob = () => {
    toast.info("Exporting not implemented yet.");
  };

  const renderResultsTabs = () => {
    if (isActuallyProcessing) {
      return <div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin" /> <span className="ml-2">Run is processing...</span></div>;
    }
    // Show tabs even with no data to allow user to see and configure chart controls
    const hasNoResults = !filteredResults || filteredResults.length === 0;
    
    if (hasNoResults && activeRun && (activeRun.status === 'running' || activeRun.status === 'pending')) {
       return <div className="flex items-center justify-center h-64 text-muted-foreground">Load a run to view results.</div>;
    }

    return (
       <Tabs defaultValue="table" className="w-full">
         <TabsList className="grid w-full grid-cols-5 mb-2 border border-background! sticky top-0 z-10 bg-background/80 backdrop-blur">
           <TabsTrigger value="chart"><BarChart3 className="h-4 w-4 mr-2" />Chart</TabsTrigger>
           <TabsTrigger value="pie"><PieChartIcon className="h-4 w-4 mr-2" />Pie</TabsTrigger>
           <TabsTrigger value="table"><TableIcon className="h-4 w-4 mr-2" />Table</TabsTrigger>
           <TabsTrigger value="graph"><Network className="h-4 w-4 mr-2" />Graph</TabsTrigger>
           <TabsTrigger value="map"><MapPin className="h-4 w-4 mr-2" />Map</TabsTrigger>
         </TabsList>
         <TabsContent value="chart">
           <div className="p-1 rounded-lg bg-muted/40 backdrop-blur supports-[backdrop-filter]:bg-background/60">
             <div className="p-2 mb-2 border-b">
                <AnnotationTimeAxisControls
                  schemas={runSchemes}
                  initialConfig={currentTimeAxisConfig}
                  onTimeAxisConfigChange={setCurrentTimeAxisConfig}
                />
             </div>
             <div className="flex items-center gap-4 p-2 mb-2 flex-wrap">
               <Popover>
                 <PopoverTrigger asChild>
                   <Button variant="outline" size="sm" disabled={runDataSources.length === 0}>
                     <SlidersHorizontal className="h-4 w-4 mr-2" />
                     Sources ({selectedDataSourceIdsForChart.length} / {runDataSources.length})
                   </Button>
                 </PopoverTrigger>
                 <PopoverContent className="w-64 p-0" align="start">
                   <div className="p-2 font-medium text-xs border-b">Select Sources to Display</div>
                   <ScrollArea className="max-h-60">
                     <div className="p-2 space-y-1">
                       {runDataSources.length > 0 ? (
                         <>
                           <div className="flex items-center space-x-2 px-1 py-1.5">
                             <Checkbox
                               id="chart-source-select-all"
                               checked={selectedDataSourceIdsForChart.length === runDataSources.length}
                               onCheckedChange={(checked) => {
                                 setSelectedDataSourceIdsForChart(checked ? runDataSources.map(ds => ds.id) : []);
                               }}
                             />
                             <Label htmlFor="chart-source-select-all" className="text-xs font-normal cursor-pointer flex-1">
                               Select All ({runDataSources.length})
                             </Label>
                           </div>
                           <Separator />
                           {runDataSources.map(ds => (
                             <div key={ds.id} className="flex items-center space-x-2 px-1 py-1.5">
                               <Checkbox
                                 id={`chart-source-${ds.id}`}
                                 checked={selectedDataSourceIdsForChart.includes(ds.id)}
                                 onCheckedChange={(checked) => {
                                   setSelectedDataSourceIdsForChart(prev =>
                                     checked
                                       ? [...prev, ds.id]
                                       : prev.filter(id => id !== ds.id)
                                   );
                                 }}
                               />
                               <Label htmlFor={`chart-source-${ds.id}`} className="text-xs font-normal cursor-pointer flex-1 truncate" title={ds.name ?? `Source ${ds.id}`}>
                                 {ds.name ?? `Source ${ds.id}`}
                               </Label>
                             </div>
                           ))}
                         </>
                       ) : (
                         <div className="p-4 text-center text-xs text-muted-foreground">No sources in this run.</div>
                       )}
                     </div>
                   </ScrollArea>
                 </PopoverContent>
               </Popover>

               <div className="flex items-center gap-2">
                 <Label htmlFor="chart-interval-select" className="text-sm whitespace-nowrap">Aggregate By:</Label>
                 <Select
                   value={selectedTimeInterval}
                   onValueChange={(value: 'day' | 'week' | 'month' | 'quarter' | 'year') => setSelectedTimeInterval(value)}
                 >
                   <SelectTrigger id="chart-interval-select" className="w-[120px] h-9 text-sm">
                     <SelectValue />
                   </SelectTrigger>
                   <SelectContent>
                     <SelectItem value="day">Day</SelectItem>
                     <SelectItem value="week">Week</SelectItem>
                     <SelectItem value="month">Month</SelectItem>
                     <SelectItem value="quarter">Quarter</SelectItem>
                     <SelectItem value="year">Year</SelectItem>
                   </SelectContent>
                 </Select>
               </div>
             </div>
             <AssetDetailProvider>
               <AnnotationResultsChart
                 results={filteredResults}
                 schemas={runSchemes}
                 sources={runDataSources}
                 assets={currentRunAssets}
                 timeAxisConfig={currentTimeAxisConfig}
                 selectedDataSourceIds={selectedDataSourceIdsForChart}
                 selectedTimeInterval={selectedTimeInterval}
                 aggregateSourcesDefault={true}
               />
             </AssetDetailProvider>
           </div>
         </TabsContent>
         <TabsContent value="pie">
            <div className="p-1 rounded-lg bg-muted/40 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                <AssetDetailProvider>
                  <AnnotationResultsPieChart
                      results={filteredResults}
                      schemas={runSchemes}
                      sources={runDataSources}
                      selectedSourceIds={selectedDataSourceIdsForChart}
                      assets={currentRunAssets}
                  />
                </AssetDetailProvider>
            </div>
         </TabsContent>
         <TabsContent value="table">
           <div className="p-1 rounded-lg bg-muted/40 backdrop-blur supports-[backdrop-filter]:bg-background/60">
             <AssetDetailProvider>
               <AnnotationResultsTable
                 results={filteredResults as any}
                 schemas={runSchemes}
                 sources={runDataSources}
                 assets={currentRunAssets}
                 filters={activeFilters}
                 onResultSelect={handleTableRowClick as any}
                 onRetrySingleResult={retrySingleResult}
                 retryingResultId={isRetryingResultId}
                 excludedRecordIds={excludedRecordIdsSet}
                 onToggleRecordExclusion={toggleRecordExclusion}
               />
             </AssetDetailProvider>
           </div>
         </TabsContent>
         <TabsContent value="graph">
           <div className="p-1 rounded-lg bg-muted/40 backdrop-blur supports-[backdrop-filter]:bg-background/60 overflow-hidden h-[600px] relative">
             <AnnotationResultsGraph
               results={filteredResults}
               schemas={runSchemes}
               assets={currentRunAssets}
               activeRunId={activeRun?.id}
               allSchemas={allSchemas}
             />
           </div>
         </TabsContent>
         <TabsContent value="map">
            <AnnotationMapControls
               schemas={allSchemas}
               results={currentRunResults}
               onGeocodeRequest={handleGeocodeRequest}
               isLoadingGeocoding={isLoadingGeocoding}
               geocodingError={geocodingError}
               onMapLabelConfigChange={setCurrentMapLabelConfig}
               initialSelectedGeocodeSchemaId={initialMapControlsConfig.geocodeSchemaId !== null ? String(initialMapControlsConfig.geocodeSchemaId) : null}
               initialSelectedGeocodeField={initialMapControlsConfig.geocodeFieldKey}
               initialMapLabelSchemaId={initialMapControlsConfig.labelSchemeId}
               initialMapLabelFieldKey={initialMapControlsConfig.labelFieldKey}
               initialShowMapLabels={initialMapControlsConfig.showLabels}
            />
            <div className="p-1 mt-2 rounded-lg bg-muted/40 backdrop-blur supports-[backdrop-filter]:bg-background/60 overflow-hidden h-[600px] relative">
              {isLoadingGeocoding ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10"><Loader2 className="h-8 w-8 animate-spin text-primary"/></div>
              ) : filteredGeocodedPoints.length > 0 ? (
                  <AnnotationResultsMap
                      points={filteredGeocodedPoints}
                      results={currentRunResults}
                      schemas={allSchemas}
                      labelConfig={currentMapLabelConfig ? { schemaId: currentMapLabelConfig.schemaId, fieldKey: currentMapLabelConfig.fieldKey } : undefined}
                      onPointClick={handleMapPointClick}
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

  const isDetailsDialogOpen = isResultDialogOpen && (selectedAssetId !== null || selectedMapPointForDialog !== null);

  const closeDetailsDialog = () => {
    setIsResultDialogOpen(false);
    setSelectedAssetId(null);
    setSelectedMapPointForDialog(null);
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
          <Button variant="outline" size="sm" onClick={onClearRun} disabled={!activeRun?.id}>
            <XCircle className="h-4 w-4 mr-1" /> Clear Loaded Run
          </Button>
          <div className="w-full mt-2">
             {sourceStats && (
                  <Collapsible
                      open={isSourceStatsOpen}
                      onOpenChange={setIsSourceStatsOpen}
                      className="w-full"
                  >
                      <CollapsibleTrigger asChild>
                          <Button
                              variant="ghost"
                              className="flex justify-between items-center w-full px-2 py-1.5 text-xs h-auto hover:bg-muted/50"
                          >
                              <span className="text-muted-foreground">
                                  Run Overview: Sources & Schemes
                              </span>
                              {isSourceStatsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-2 px-1 pb-1 space-y-4">
                           <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                               <div className="flex flex-col">
                                   <h4 className="text-xs font-medium text-muted-foreground mb-1.5 px-1">Source Distribution</h4>
                                   <ScrollArea className="max-h-[200px] border rounded-md">
                                       <Table className="text-xs">
                                           <TableHeader className="sticky top-0 bg-muted/90">
                                               <TableRow>
                                                   <TableHead className="h-7 px-2">Source Name</TableHead>
                                                   <TableHead className="h-7 px-2 text-right">Records</TableHead>
                                                   <TableHead className="h-7 px-2 text-right">% of Total</TableHead>
                                               </TableRow>
                                           </TableHeader>
                                           <TableBody>
                                               {sourceStats.detailedStats.map(stat => (
                                                   <TableRow key={stat.id} className="h-7">
                                                       <TableCell className="px-2 py-1 font-medium truncate" title={stat.name}>{stat.name}</TableCell>
                                                       <TableCell className="px-2 py-1 text-right">{stat.count}</TableCell>
                                                       <TableCell className="px-2 py-1 text-right">{stat.percentage}</TableCell>
                                                   </TableRow>
                                               ))}
                                           </TableBody>
                                       </Table>
                                   </ScrollArea>
                                   <p className="text-xs text-muted-foreground mt-1 px-1">
                                       Total: {sourceStats.totalRecords} records from {sourceStats.sourcesWithRecordsCount} sources
                                       {sourceStats.sourcesWithRecordsCount !== sourceStats.totalSourcesInRun && ` (of ${sourceStats.totalSourcesInRun} targeted)`}
                                   </p>
                               </div>

                               {activeRun && runSchemes.length > 0 && (
                                   <div className="flex flex-col">
                                         <h4 className="text-xs font-medium text-muted-foreground mb-1.5 px-1">Schemes Used</h4>
                                         <ScrollArea className="max-h-[200px] border rounded-md p-1">
                                                <div className="grid grid-cols-1 gap-3 p-1">
                                                  {runSchemes.map(scheme => (
                                                    <div key={scheme.id} className="border rounded-lg p-3 bg-card/50 shadow-sm hover:shadow-md transition-shadow cursor-pointer" onClick={() => setViewingSchema(scheme)}>
                                                      <SchemePreview scheme={scheme} />
                                                    </div>
                                                  ))}
                                                </div>
                                         </ScrollArea>
                                      </div>
                                  )}
                             </div>
                        </CollapsibleContent>
                    </Collapsible>
               )}
          </div>

        </div>

        <div className="p-3 rounded-md bg-muted/10 space-y-3">
          <AnnotationResultFilters
            filters={activeFilters}
            schemas={runSchemes}
            onChange={setActiveFilters}
            logicMode={filterLogicMode}
            onLogicModeChange={setFilterLogicMode}
          />
        </div>

        <div className="mt-2">
          {renderResultsTabs()}
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

    <AnnotationSchemaCard
        show={!!viewingSchema}
        onClose={() => setViewingSchema(null)}
        title={`Schema: ${viewingSchema?.name}`}
        mode="watch"
      >
        {viewingSchema && <SchemePreview scheme={viewingSchema} />}
    </AnnotationSchemaCard>

    <Dialog open={isDetailsDialogOpen} onOpenChange={closeDetailsDialog}> 
      <DialogContent className="max-w-[95vw] w-full max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Details</DialogTitle>
          <DialogDescription>
            {selectedMapPointForDialog 
              ? `Showing assets for location: ${selectedMapPointForDialog.locationString}`
              : `Detailed view for the selected asset.`
            }
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-auto">
          <div className="min-w-0">
            { selectedAssetId ? (
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
          </div>
        </div>
        <DialogFooter>
            <Button variant="outline" onClick={closeDetailsDialog}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </div>
  );
}