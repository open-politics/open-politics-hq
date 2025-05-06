'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
import { Loader2, X, AlertCircle, Info, Pencil, BarChart3, Table as TableIcon, MapPin, SlidersHorizontal, XCircle, RefreshCw, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import {
  ClassificationSchemeRead,
  DataSourceRead,
  EnhancedClassificationResultRead,
  ClassificationJobRead,
  DataRecordRead,
  ClassificationJobStatus
} from '@/client/models';
import { FormattedClassificationResult, ClassificationScheme } from '@/lib/classification/types';
import ClassificationResultsChart from '@/components/collection/workspaces/classifications/ClassificationResultsChart';
import { format } from 'date-fns';
import { getTargetFieldDefinition, ResultFilters, getTargetKeysForScheme, ResultFilter } from './ClassificationResultFilters';
import { checkFilterMatch, formatDisplayValue, extractLocationString } from '@/lib/classification/utils';
import ClassificationResultDisplay from '@/components/collection/workspaces/classifications/ClassificationResultDisplay';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from '@/components/ui/use-toast';
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils";
import DocumentDetailProvider from '../documents/DocumentDetailProvider';
import DocumentDetailWrapper from '../documents/DocumentDetailWrapper';
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
import ClassificationResultsMap, { MapPoint } from './ClassificationResultsMap';
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useClassificationSettingsStore } from '@/zustand_stores/storeClassificationSettings';
import ClassificationSchemeEditor from './ClassificationSchemeEditor';
import { useGeocodingCacheStore } from '@/zustand_stores/storeGeocodingCache';
import ClassificationResultsTable from './ClassificationResultsTable';
import { Switch } from '@/components/ui/switch';
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useWorkspaceStore } from '@/zustand_stores/storeWorkspace';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { ClassificationMapControls } from './ClassificationMapControls';
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { adaptEnhancedResultReadToFormattedResult, adaptDataSourceReadToDataSource } from '@/lib/classification/adapters';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useRecurringTasksStore } from '@/zustand_stores/storeRecurringTasks';
import Link from 'next/link';
import { ClassificationTimeAxisControls, TimeAxisConfig } from './ClassificationTimeAxisControls';
import { SchemePreview } from '@/components/collection/workspaces/classifications/schemaCreation/SchemePreview';
import { transformApiToFormData } from '@/lib/classification/service';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useClassificationSystem } from '@/hooks/useClassificationSystem';
import { ClassificationResultStatus } from '@/lib/classification/types';

// Filter Logic Type defined earlier
export type FilterLogicMode = 'and' | 'or';

interface ClassificationRunnerProps {
  allSchemes: ClassificationSchemeRead[];
  allDataSources: DataSourceRead[];
  activeJob: ClassificationJobRead | null;
  isClassifying: boolean;
  results: FormattedClassificationResult[];
  activeJobDataRecords: DataRecordRead[];
  retryJob: (jobId: number) => Promise<boolean>;
  onClearJob: () => void;
}

export default function ClassificationRunner({
  allSchemes,
  allDataSources,
  activeJob,
  isClassifying: isClassifyingProp,
  results: currentRunResults,
  activeJobDataRecords: currentRunDataRecords,
  retryJob,
  onClearJob,
}: ClassificationRunnerProps) {

  const [activeFilters, setActiveFilters] = useState<ResultFilter[]>([]);
  const [isResultDialogOpen, setIsResultDialogOpen] = useState(false);
  const [selectedDataRecordId, setSelectedDataRecordId] = useState<number | null>(null);
  const [geocodedPoints, setGeocodedPoints] = useState<MapPoint[]>([]);
  const [filteredGeocodedPoints, setFilteredGeocodedPoints] = useState<MapPoint[]>([]);
  const [isLoadingGeocoding, setIsLoadingGeocoding] = useState(false);
  const [geocodingError, setGeocodingError] = useState<string | null>(null);
  const [currentMapLabelConfig, setCurrentMapLabelConfig] = useState<{ schemeId: number; fieldKey: string } | undefined>(undefined);
  const [currentTimeAxisConfig, setCurrentTimeAxisConfig] = useState<TimeAxisConfig | null>(null);
  const [initialMapControlsConfig, setInitialMapControlsConfig] = useState<{
    geocodeSchemeId: number | null;
    geocodeFieldKey: string | null;
    labelSchemeId: number | null;
    labelFieldKey: string | null;
    showLabels: boolean;
  }>({ geocodeSchemeId: null, geocodeFieldKey: null, labelSchemeId: null, labelFieldKey: null, showLabels: false });

  // --- State for Filter Logic (defined here) ---
  const [filterLogicMode, setFilterLogicMode] = useState<FilterLogicMode>('and');
  // --- END State Definition ---

  const { toast } = useToast();
  const { geocodeLocation, loading: isGeocodingSingle, error: geocodeSingleError } = useGeocode();
  const { getCache, setCache } = useGeocodingCacheStore();
  const { activeWorkspace } = useWorkspaceStore();
  const { recurringTasks } = useRecurringTasksStore();

  const [isEditingName, setIsEditingName] = useState(false);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [isSchemesCollapsed, setIsSchemesCollapsed] = useState(false);

  const [selectedDataSourceIdsForChart, setSelectedDataSourceIdsForChart] = useState<number[]>([]);
  const [selectedTimeInterval, setSelectedTimeInterval] = useState<'day' | 'week' | 'month' | 'quarter' | 'year'>('day');

  const [isSourceStatsOpen, setIsSourceStatsOpen] = useState(false);

  // --- NEW: State for Excluded Record IDs --- 
  const [excludedRecordIdsSet, setExcludedRecordIdsSet] = useState<Set<number>>(new Set());
  // --- END NEW ---

  // --- Get retry functions from hook ---
  const {
    retryJobFailures,
    isRetryingJob,
    retrySingleResult,
    isRetryingResultId,
    isClassifying: isClassifyingHook,
    activeJob: activeJobFromHook,
    loadJob,
  } = useClassificationSystem();
  // --- End hook usage ---

  // Determine the actual active job and classifying state
  const currentActiveJob = activeJobFromHook || activeJob;
  const isActuallyClassifying = isClassifyingHook || isClassifyingProp || isRetryingJob;

  const runSchemes = useMemo(() => {
    if (!activeJob?.target_scheme_ids) return [];
    const schemeIds = activeJob.target_scheme_ids;
    return allSchemes.filter(s => schemeIds.includes(s.id));
  }, [activeJob, allSchemes]);

  const runDataSources = useMemo(() => {
    if (!activeJob?.target_datasource_ids) return [];
    const dataSourceIds = activeJob.target_datasource_ids;
    return allDataSources.filter(ds => dataSourceIds.includes(ds.id));
  }, [activeJob, allDataSources]);

  const formattedRunResults = currentRunResults;

  const sourceStats = useMemo(() => {
    if (!currentRunDataRecords || currentRunDataRecords.length === 0 || !runDataSources) {
      return null;
    }

    const totalRecords = currentRunDataRecords.length;
    const sourceCounts: Record<number, number> = {};
    const sourceMap = new Map(runDataSources.map(ds => [ds.id, ds.name || `Source ${ds.id}`]));
    let sourcesWithRecordsCount = 0;

    currentRunDataRecords.forEach(record => {
      if (record.datasource_id !== null && record.datasource_id !== undefined) {
        if(sourceMap.has(record.datasource_id)) {
          sourceCounts[record.datasource_id] = (sourceCounts[record.datasource_id] || 0) + 1;
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

    sourcesWithRecordsCount = detailedStats.length;

    return {
      totalRecords,
      totalSourcesInRun: runDataSources.length,
      sourcesWithRecordsCount: sourcesWithRecordsCount,
      detailedStats
    };
  }, [currentRunDataRecords, runDataSources]);

  useEffect(() => {
    if (runSchemes && runSchemes.length > 0) {
      let defaultGeoSchemeId: number | null = null;
      let defaultGeoFieldKey: string | null = null;
      let defaultLabelSchemeId: number | null = null;
      let defaultLabelFieldKey: string | null = null;
      let shouldShowLabels = false;

      const classificationSchemes = runSchemes.filter(s => s.name.toLowerCase() === 'classification');
      const schemeToUseForGeo = classificationSchemes.length > 0 ? classificationSchemes[0] : runSchemes[0];

      if (schemeToUseForGeo) {
        const geoTargetKeys = getTargetKeysForScheme(schemeToUseForGeo.id, allSchemes);
        const locationKey = geoTargetKeys.find(k => k.name.toLowerCase().includes('location') || k.name.toLowerCase().includes('address'));
        const firstStringKeyGeo = geoTargetKeys.find(k => k.type === 'str');

        if(locationKey || firstStringKeyGeo || geoTargetKeys.length > 0) {
          defaultGeoSchemeId = schemeToUseForGeo.id;
          defaultGeoFieldKey = locationKey?.key || firstStringKeyGeo?.key || (geoTargetKeys.length > 0 ? geoTargetKeys[0].key : null);

           const firstSuitableLabelField = schemeToUseForGeo.fields.find(f =>
              f.type === 'str' || f.type === 'List[str]' || f.type === 'List[Dict[str, any]]'
           );

           if (firstSuitableLabelField) {
               defaultLabelSchemeId = schemeToUseForGeo.id;
               defaultLabelFieldKey = firstSuitableLabelField.name;
               shouldShowLabels = true;
           }
        }
      }

      console.log(`[Runner] Setting initial map config: GeoScheme ${defaultGeoSchemeId}, GeoField ${defaultGeoFieldKey}, LabelScheme ${defaultLabelSchemeId}, LabelField ${defaultLabelFieldKey}, ShowLabels ${shouldShowLabels}`);
      setInitialMapControlsConfig({
        geocodeSchemeId: defaultGeoSchemeId,
        geocodeFieldKey: defaultGeoFieldKey,
        labelSchemeId: defaultLabelSchemeId,
        labelFieldKey: defaultLabelFieldKey,
        showLabels: shouldShowLabels,
      });
    } else {
      setInitialMapControlsConfig({ geocodeSchemeId: null, geocodeFieldKey: null, labelSchemeId: null, labelFieldKey: null, showLabels: false });
    }
  }, [runSchemes, allSchemes]);

  useEffect(() => {
    const initialDataSourceIds = runDataSources.map(ds => ds.id);
    setSelectedDataSourceIdsForChart(initialDataSourceIds);
  }, [runDataSources]);

  const generateGeocodingCacheKey = useCallback(() => {
    if (!activeWorkspace?.id || !activeJob?.id) return null;
    return `${activeWorkspace.id}-run-${activeJob.id}`;
  }, [activeWorkspace?.id, activeJob]);

  const handleGeocodeRequest = useCallback(async (schemeIdStr: string, fieldKey: string) => {
    if (!activeJob?.id || !schemeIdStr || !fieldKey || !currentRunResults) {
      console.log("Geocoding prerequisites not met. Clearing points.");
      setGeocodedPoints([]);
      setFilteredGeocodedPoints([]);
      return;
    }
    const cacheKey = generateGeocodingCacheKey();
    if (cacheKey) {
        const cachedPoints = getCache(cacheKey);
        if (cachedPoints) {
            console.log("Using cached geocoded points.");
            setGeocodedPoints(cachedPoints);
            // Apply filters to cached points immediately
            const activeEnabledFilters = activeFilters.filter(f => f.isActive);
            if (activeEnabledFilters.length === 0) {
              setFilteredGeocodedPoints(cachedPoints);
            } else {
              const resultsByDataRecordId = currentRunResults.reduce<Record<number, FormattedClassificationResult[]>>((acc, result) => {
                  const recordId = result.datarecord_id;
                  if (!acc[recordId]) acc[recordId] = [];
                  acc[recordId].push(result);
                  return acc;
              }, {});
              const newlyFilteredPoints = cachedPoints.filter(point =>
                  point.documentIds.some(recordId => {
                      const recordResults = resultsByDataRecordId[recordId];
                      if (!recordResults) return false;
                      if (filterLogicMode === 'and') {
                          return activeEnabledFilters.every(filter => checkFilterMatch(filter, recordResults, runSchemes));
                      } else { // 'or'
                          return activeEnabledFilters.some(filter => checkFilterMatch(filter, recordResults, runSchemes));
                      }
                  })
              );
              setFilteredGeocodedPoints(newlyFilteredPoints);
            }
            return;
        }
    }
    console.log(`Geocoding run ${activeJob.id}, scheme ${schemeIdStr}, field ${fieldKey}`);
    setIsLoadingGeocoding(true);
    setGeocodingError(null);
    setGeocodedPoints([]);
    setFilteredGeocodedPoints([]);

    const schemeIdNum = parseInt(schemeIdStr, 10);
    const locationStrings = new Set<string>();
    currentRunResults.forEach(result => {
      if (result.scheme_id === schemeIdNum) {
        const loc = extractLocationString(result.value, fieldKey);
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
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (errorsEncountered) setGeocodingError("Some locations failed to geocode. See console for details.");

    const pointsMap = new Map<string, MapPoint>();
    currentRunResults.forEach(result => {
      if (result.scheme_id === schemeIdNum) {
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
            if (!mapPoint.documentIds.includes(result.datarecord_id)) {
              mapPoint.documentIds.push(result.datarecord_id);
            }
          }
        }
      }
    });
    const newPoints = Array.from(pointsMap.values());
    console.log(`Generated ${newPoints.length} geocoded points.`);
    setGeocodedPoints(newPoints);
    if (cacheKey) setCache(cacheKey, newPoints);
    setIsLoadingGeocoding(false);
    console.log("Finished geocoding.");

    // Apply filters to newly geocoded points
    const activeEnabledFilters = activeFilters.filter(f => f.isActive);
    if (activeEnabledFilters.length === 0) {
        setFilteredGeocodedPoints(newPoints);
    } else {
        const resultsByDataRecordId = currentRunResults.reduce<Record<number, FormattedClassificationResult[]>>((acc, result) => {
            const recordId = result.datarecord_id;
            if (!acc[recordId]) acc[recordId] = [];
            acc[recordId].push(result);
            return acc;
        }, {});
        const newlyFilteredPointsPostGeocode = newPoints.filter(point =>
            point.documentIds.some(recordId => {
                const recordResults = resultsByDataRecordId[recordId];
                if (!recordResults) return false;
                if (filterLogicMode === 'and') {
                    return activeEnabledFilters.every(filter => checkFilterMatch(filter, recordResults, runSchemes));
                } else { // 'or'
                    return activeEnabledFilters.some(filter => checkFilterMatch(filter, recordResults, runSchemes));
                }
            })
        );
        setFilteredGeocodedPoints(newlyFilteredPointsPostGeocode);
    }
  }, [
    activeJob?.id,
    currentRunResults,
    extractLocationString,
    geocodeLocation,
    setIsLoadingGeocoding,
    setGeocodedPoints,
    setGeocodingError,
    generateGeocodingCacheKey,
    getCache,
    setCache,
    activeFilters,
    filterLogicMode,
    runSchemes
  ]);

  // --- NEW: Handler to toggle record exclusion --- 
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
  // --- END NEW ---

  const filteredResults = useMemo(() => {
    const activeEnabledFilters = activeFilters.filter(f => f.isActive);
    let resultsToFilter = currentRunResults;

    // 1. Apply criteria filters (AND/OR)
    if (activeEnabledFilters.length > 0) {
      const resultsByDataRecordId = currentRunResults.reduce<Record<number, FormattedClassificationResult[]>>((acc, result) => {
        const recordId = result.datarecord_id;
        if (!acc[recordId]) acc[recordId] = [];
        acc[recordId].push(result);
        return acc;
      }, {});

      const filteredDataRecordIds = Object.keys(resultsByDataRecordId)
        .map(Number)
        .filter(recordId => {
          const recordResults = resultsByDataRecordId[recordId];
          if (filterLogicMode === 'and') {
            return activeEnabledFilters.every(filter => checkFilterMatch(filter, recordResults, runSchemes));
          } else { // 'or'
            return activeEnabledFilters.some(filter => checkFilterMatch(filter, recordResults, runSchemes));
          }
        });
      resultsToFilter = currentRunResults.filter(result => filteredDataRecordIds.includes(result.datarecord_id));
    }

    // --- MODIFIED: Apply exclusion filter --- 
    // 2. Apply exclusion filter AFTER criteria filters
    if (excludedRecordIdsSet.size > 0) {
      return resultsToFilter.filter(result => !excludedRecordIdsSet.has(result.datarecord_id));
    }
    // --- END MODIFICATION ---

    return resultsToFilter; // Return if no exclusions or no criteria filters applied

  }, [currentRunResults, activeFilters, filterLogicMode, runSchemes, excludedRecordIdsSet]); // Added excludedRecordIdsSet

  useEffect(() => {
    const sourcePoints = geocodedPoints;
    const activeEnabledFilters = activeFilters.filter(f => f.isActive);
    let recordIdsToInclude: Set<number> | null = null; // Set to store IDs passing filters

    // Determine which record IDs pass the criteria filters
    if (activeEnabledFilters.length > 0) {
      const resultsByDataRecordId = currentRunResults.reduce<Record<number, FormattedClassificationResult[]>>((acc, result) => {
        const recordId = result.datarecord_id;
        if (!acc[recordId]) acc[recordId] = [];
        acc[recordId].push(result);
        return acc;
      }, {});

      recordIdsToInclude = new Set(
        Object.keys(resultsByDataRecordId)
          .map(Number)
          .filter(recordId => {
            const recordResults = resultsByDataRecordId[recordId];
            if (!recordResults) return false;
            if (filterLogicMode === 'and') {
              return activeEnabledFilters.every(filter => checkFilterMatch(filter, recordResults, runSchemes));
            } else { // 'or'
              return activeEnabledFilters.some(filter => checkFilterMatch(filter, recordResults, runSchemes));
            }
          })
      );
    }

    // Filter points: must pass criteria (if any) AND not be excluded
    const finalFilteredPoints = sourcePoints.filter(point =>
      point.documentIds.some(recordId =>
        // Check if ID passes criteria filter (if applicable)
        (recordIdsToInclude === null || recordIdsToInclude.has(recordId)) &&
        // Check if ID is NOT excluded
        !excludedRecordIdsSet.has(recordId)
      )
    );

    setFilteredGeocodedPoints(finalFilteredPoints);

  // Added excludedRecordIdsSet to dependencies
  }, [geocodedPoints, activeFilters, filterLogicMode, currentRunResults, runSchemes, excludedRecordIdsSet]);

  useEffect(() => {
    setGeocodedPoints([]);
    setFilteredGeocodedPoints([]);
    setGeocodingError(null);
    setIsLoadingGeocoding(false);
  }, [activeJob?.id]);

  const handleTableRowClick = (result: FormattedClassificationResult) => {
    setSelectedDataRecordId(result.datarecord_id);
    setIsResultDialogOpen(true);
  };

  const handleMapPointClick = (point: MapPoint) => {
    console.log("Map point clicked in parent:", point);
    if (point.documentIds && point.documentIds.length > 0) {
      setSelectedDataRecordId(point.documentIds[0]);
      setIsResultDialogOpen(true);
    } else {
      console.warn("Map point clicked, but no associated document IDs found.");
      toast({
        title: "No Documents Found",
        description: "Could not find documents associated with this map point.",
        variant: "destructive"
      });
    }
  };

  const handleEditClick = (field: 'name' | 'description') => {
      const elementId = field === 'name' ? 'run-name-editable' : 'run-description-editable';
      if (field === 'name') setIsEditingName(true);
      else setIsEditingDescription(true);
      setTimeout(() => {
          const el = document.getElementById(elementId);
          if (el) {
              el.contentEditable = 'true';
              el.focus();
              const selection = window.getSelection();
              const range = document.createRange();
              range.selectNodeContents(el);
              selection?.removeAllRanges();
              selection?.addRange(range);
          }
      }, 0);
  };

  const handleBlur = (e: React.FocusEvent<HTMLSpanElement>, field: 'name' | 'description') => {
    const newValue = e.target.innerText.trim();
    e.target.contentEditable = 'false';
    if (field === 'name') {
        setIsEditingName(false);
        if (newValue !== activeJob?.name) {
            console.warn("Job name update via UI not implemented yet.");
        }
    } else {
        setIsEditingDescription(false);
        const placeholder = "Add a description...";
        if (newValue !== (activeJob?.description ?? '') && newValue !== placeholder) {
            console.warn("Job description update via UI not implemented yet.");
        } else if (newValue === placeholder && activeJob?.description) {
            console.warn("Job description clearing via UI not implemented yet.");
        }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLSpanElement>, field: 'name' | 'description') => {
      if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
      } else if (e.key === 'Escape') {
          e.currentTarget.innerText = field === 'name' ? (activeJob?.name ?? 'Unnamed Job') : (activeJob?.description ?? 'Add a description...');
          e.currentTarget.blur();
      }
  };

  const renderResultsTabs = () => {
    if (isActuallyClassifying) {
      return <div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin" /> <span className="ml-2">Job is running...</span></div>;
    }
    if (!filteredResults || filteredResults.length === 0) {
       if (activeJob && activeJob.status !== 'running' && activeJob.status !== 'pending') {
           const noResultsReason = activeFilters.length > 0
              ? "No results match the current filters."
              : "No results found for this job.";
          return <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                    <span>{noResultsReason}</span>
                    {activeJob.status === 'failed' && <span className="text-xs mt-1">(Job Failed)</span>}
                 </div>;
       }
       return <div className="flex items-center justify-center h-64 text-muted-foreground">Load a job to view results.</div>;
    }

    return (
       <Tabs defaultValue="table" className="w-full">
         <TabsList className="grid w-full grid-cols-3 mb-2 sticky top-0 z-10 bg-background/80 backdrop-blur">
           <TabsTrigger value="chart">Chart</TabsTrigger>
           <TabsTrigger value="table">Table</TabsTrigger>
           <TabsTrigger value="map">Map</TabsTrigger>
         </TabsList>
         <TabsContent value="chart">
           <div className="p-1 rounded-lg bg-muted/40 backdrop-blur supports-[backdrop-filter]:bg-background/60">
             <div className="p-2 mb-2 border-b">
                <ClassificationTimeAxisControls
                  schemes={runSchemes}
                  initialConfig={currentTimeAxisConfig}
                  onTimeAxisConfigChange={setCurrentTimeAxisConfig}
                />
             </div>
             <div className="flex items-center gap-4 p-2 mb-2 border-b flex-wrap">
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
                         <div className="p-4 text-center text-xs text-muted-foreground">No sources in this job.</div>
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
             <ClassificationResultsChart
               results={filteredResults}
               schemes={runSchemes}
               dataSources={runDataSources}
               dataRecords={currentRunDataRecords}
               filters={activeFilters}
               timeAxisConfig={currentTimeAxisConfig}
               selectedDataSourceIds={selectedDataSourceIdsForChart}
               onDataSourceSelectionChange={setSelectedDataSourceIdsForChart}
               selectedTimeInterval={selectedTimeInterval}
               onTimeIntervalChange={setSelectedTimeInterval}
             />
           </div>
         </TabsContent>
         <TabsContent value="table">
           <div className="p-1 rounded-lg bg-muted/40 backdrop-blur supports-[backdrop-filter]:bg-background/60">
             <ClassificationResultsTable
               results={filteredResults}
               schemes={runSchemes}
               dataSources={runDataSources}
               dataRecords={currentRunDataRecords}
               filters={activeFilters}
               onResultSelect={handleTableRowClick}
               onRetrySingleResult={retrySingleResult}
               retryingResultId={isRetryingResultId}
               excludedRecordIds={excludedRecordIdsSet}
               onToggleRecordExclusion={toggleRecordExclusion}
             />
           </div>
         </TabsContent>
         <TabsContent value="map">
            <ClassificationMapControls
               schemes={allSchemes}
               results={currentRunResults}
               onGeocodeRequest={handleGeocodeRequest}
               isLoadingGeocoding={isLoadingGeocoding}
               geocodingError={geocodingError}
               onMapLabelConfigChange={setCurrentMapLabelConfig}
               initialSelectedGeocodeSchemeId={initialMapControlsConfig.geocodeSchemeId !== null ? String(initialMapControlsConfig.geocodeSchemeId) : null}
               initialSelectedGeocodeField={initialMapControlsConfig.geocodeFieldKey}
               initialMapLabelSchemeId={initialMapControlsConfig.labelSchemeId}
               initialMapLabelFieldKey={initialMapControlsConfig.labelFieldKey}
               initialShowMapLabels={initialMapControlsConfig.showLabels}
            />
            <div className="p-1 mt-2 rounded-lg bg-muted/40 backdrop-blur supports-[backdrop-filter]:bg-background/60 overflow-hidden h-[600px] relative">
              {isLoadingGeocoding ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10"><Loader2 className="h-8 w-8 animate-spin text-primary"/></div>
              ) : filteredGeocodedPoints.length > 0 ? (
                  <ClassificationResultsMap
                      points={filteredGeocodedPoints}
                      dataSources={allDataSources}
                      results={currentRunResults}
                      schemes={allSchemes}
                      labelConfig={currentMapLabelConfig}
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

  let recurringTaskInfoElement: React.ReactNode = null;
  if (activeJob?.configuration?.recurring_task_id) {
    const recurringTaskId = activeJob.configuration.recurring_task_id;
    const taskName = Object.values(recurringTasks).find(t => t.id === recurringTaskId)?.name;
    const taskLabel = taskName ? `"${taskName}" (ID: ${recurringTaskId})` : `ID: ${recurringTaskId}`;
    recurringTaskInfoElement = (
      <div className="text-xs text-muted-foreground mt-1">
        Triggered by Recurring Task:{' '}
        <Link href={`/workspaces/${activeWorkspace?.id}/settings/recurring?highlight=${recurringTaskId}`} legacyBehavior>
          <a className="underline hover:text-primary cursor-pointer">{taskLabel}</a>
        </Link>
      </div>
    );
  }

  return (
    <DocumentDetailProvider>
      <DocumentDetailWrapper onLoadIntoRunner={() => { /* Placeholder - Parent should handle this if needed */ }}>
          <div className="flex-1 flex flex-col overflow-auto">
            <div className="p-4 flex-1 space-y-4">

              {activeJob ? (
                <div className="p-3 rounded-md bg-muted/10 flex items-center justify-between sticky top-0 bg-background/95 backdrop-blur z-10 flex-wrap gap-2 border-b">
                  <div className="flex flex-col flex-1 min-w-0 mr-4">
                    <div className="flex items-center gap-1">
                      <span
                          id="run-name-editable"
                          className={`font-medium text-base px-1 truncate ${isEditingName ? 'outline outline-1 outline-primary bg-background' : 'hover:bg-muted/50 cursor-text'}`}
                          contentEditable={isEditingName ? 'true' : 'false'}
                          suppressContentEditableWarning={true}
                          onBlur={(e) => handleBlur(e, 'name')}
                          onKeyDown={(e) => handleKeyDown(e, 'name')}
                          onClick={() => !isEditingName && handleEditClick('name')}
                          title={activeJob.name}
                      >
                          {activeJob.name}
                      </span>
                      <TooltipProvider delayDuration={100}>
                        <Tooltip>
                            <TooltipTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => handleEditClick('name')}><Pencil className="h-3 w-3" /></Button>
                            </TooltipTrigger>
                            <TooltipContent><p>Edit Job Name</p></TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <div className="flex items-center gap-1 mt-1">
                       <span
                          id="run-description-editable"
                          className={`text-sm px-1 truncate ${isEditingDescription ? 'outline outline-1 outline-primary bg-background w-full' : 'hover:bg-muted/50 cursor-text italic text-muted-foreground'}`}
                          contentEditable={isEditingDescription ? 'true' : 'false'}
                          suppressContentEditableWarning={true}
                          onBlur={(e) => handleBlur(e, 'description')}
                          onKeyDown={(e) => handleKeyDown(e, 'description')}
                          onClick={() => !isEditingDescription && handleEditClick('description')}
                          title={activeJob.description || 'Add a description...'}
                      >
                          {activeJob.description || 'Add a description...'}
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
                    {recurringTaskInfoElement}
                    <div className="mt-2 flex items-center gap-2">
                      <Badge variant={
                         activeJob?.status === 'completed' ? 'default'
                         : activeJob?.status === 'failed' ? 'destructive'
                         : activeJob?.status === 'running' ? 'secondary'
                         : activeJob?.status === 'pending' ? 'secondary'
                         : activeJob?.status === 'completed_with_errors' ? 'outline'
                         : 'outline'
                      } className="capitalize">
                        {(isActuallyClassifying || activeJob?.status === 'running' || activeJob?.status === 'pending') && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                        {(activeJob?.status ?? '').replace(/_/g, ' ')}
                      </Badge>
                      {(activeJob?.status === 'failed' || activeJob?.status === 'completed_with_errors') && (
                        <TooltipProvider delayDuration={100}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  if (activeJob?.status === 'failed' && retryJob && activeJob.id) {
                                      retryJob(activeJob.id);
                                  } else if (activeJob?.status === 'completed_with_errors' && activeJob.id) {
                                    retryJobFailures(activeJob.id);
                                  }
                                }}
                                disabled={isActuallyClassifying || !activeJob?.id}
                                className="h-6 px-2"
                              >
                                <RefreshCw className={`h-3 w-3 mr-1 ${isRetryingJob ? 'animate-spin' : ''}`} />
                                {activeJob?.status === 'failed' ? 'Retry Job' : 'Retry Failed Items'}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>{activeJob?.status === 'failed' ? 'Restart the entire job from the beginning.' : 'Attempt to re-run only the classifications that failed in this job.'}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                    {activeJob?.status === 'failed' && activeJob.error_message && (
                       <Alert variant="destructive" className="mt-2 text-xs p-2">
                         <AlertCircle className="h-4 w-4" />
                         <AlertTitle>Job Failed</AlertTitle>
                         <AlertDescription>{activeJob.error_message}</AlertDescription>
                       </Alert>
                    )}
                     {activeJob?.status === 'completed_with_errors' && (
                       <Alert variant="default" className="mt-2 text-xs p-2 bg-yellow-100 dark:bg-yellow-900/30 border-yellow-300 dark:border-yellow-700">
                         <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
                         <AlertTitle className="text-yellow-800 dark:text-yellow-200">Completed with Errors</AlertTitle>
                         <AlertDescription className="text-yellow-700 dark:text-yellow-300">
                           Some classifications may have failed. {activeJob.error_message && `Error: ${activeJob.error_message}`}
                         </AlertDescription>
                       </Alert>
                    )}
                  </div>
                  <Button variant="outline" size="sm" onClick={onClearJob} disabled={!activeJob?.id}>
                    <XCircle className="h-4 w-4 mr-1" /> Clear Loaded Job
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

                                       {activeJob && runSchemes.length > 0 && (
                                           <div className="flex flex-col">
                                                 <h4 className="text-xs font-medium text-muted-foreground mb-1.5 px-1">Schemes Used</h4>
                                                 <ScrollArea className="max-h-[200px] border rounded-md p-1">
                                                        <div className="grid grid-cols-1 gap-3 p-1">
                                                          {runSchemes.map(scheme => (
                                                            <div key={scheme.id} className="border rounded-lg p-3 bg-card/50 shadow-sm">
                                                              <SchemePreview scheme={transformApiToFormData(scheme)} />
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
              ) : (
                 <div className="p-3 rounded-md bg-muted/10 text-center text-muted-foreground italic">
                    No job loaded. Create a new job or load one from the dock.
                 </div>
              )}

              {activeJob && !isActuallyClassifying && (
                <div className="p-3 rounded-md bg-muted/10 space-y-3">
                  <ResultFilters
                    filters={activeFilters}
                    schemes={runSchemes}
                    onChange={setActiveFilters}
                    logicMode={filterLogicMode}
                    onLogicModeChange={setFilterLogicMode}
                  />
                </div>
              )}

              {activeJob ? (
                <div className="mt-2">
                  {renderResultsTabs()}
                </div>
              ) : (
                 !isActuallyClassifying && <div className="text-center p-12 text-muted-foreground border rounded-lg border-dashed mt-4">
                  Load a job from the dock to view results.
                </div>
              )}
            </div>
          </div>

        <Dialog open={isResultDialogOpen} onOpenChange={setIsResultDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Result Details</DialogTitle>
              <DialogDescription>
                Detailed view of classification results for the selected data record.
              </DialogDescription>
            </DialogHeader>
            <ScrollArea className="py-4 max-h-[70vh]">
              {selectedDataRecordId !== null && (() => {
                   const dataRecord = currentRunDataRecords.find(dr => dr.id === selectedDataRecordId);
                   const allResultsForRecord = filteredResults.filter(r => r.datarecord_id === selectedDataRecordId);
                   const validResultsForRecord = allResultsForRecord.filter(r => runSchemes.some(s => s.id === r.scheme_id));
                   const schemesForValidResults = runSchemes.filter(s => validResultsForRecord.some(r => r.scheme_id === s.id));

                   if (!dataRecord) return <p>Data Record details not found.</p>;
                    if (validResultsForRecord.length === 0) {
                        return <p className="text-muted-foreground italic">No results found for this record matching the schemes and filters used in this job run.</p>;
                    }

                   const recordSource = runDataSources.find(ds => ds.id === dataRecord.datasource_id);

                   return (
                     <div className="space-y-4">
                       <div className="p-3 rounded-md bg-muted/40 border border-border space-y-1 mb-4">
                          <h3 className="font-semibold text-lg">{dataRecord.title || 'Untitled Data Record'}</h3>
                          <p className="text-sm text-muted-foreground">
                             Record ID: {dataRecord.id}
                             {recordSource?.name && (
                               <span className="ml-2"> | Source: {recordSource.name}</span>
                             )}
                          </p>
                          {dataRecord.event_timestamp && <p className="text-xs text-muted-foreground">Event Date: {format(new Date(dataRecord.event_timestamp), 'PPP p')}</p>}
                       </div>

                       <h4 className="text-md font-medium text-muted-foreground border-b pb-1 mb-3">Classification Results:</h4>
                       <ClassificationResultDisplay
                           result={validResultsForRecord}
                           scheme={schemesForValidResults}
                           useTabs={schemesForValidResults.length > 1}
                           renderContext="dialog"
                           compact={false}
                       />
                     </div>
                   );
               })()}
            </ScrollArea>
            <DialogFooter>
                <Button variant="outline" onClick={() => setIsResultDialogOpen(false)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DocumentDetailWrapper>
    </DocumentDetailProvider>
  );
}