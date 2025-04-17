'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, X, AlertCircle, Info, Pencil, BarChart3, Table as TableIcon, MapPin, SlidersHorizontal, XCircle } from 'lucide-react';
import {
  ClassificationSchemeRead,
  ClassificationResultRead,
  DocumentRead,
  ClassificationResultCreate,
  ClassificationRunRead,
  ClassificationRunUpdate
} from '@/client/models';
import { FormattedClassificationResult, ClassificationScheme } from '@/lib/classification/types';
import ClassificationResultsChart from '@/components/collection/workspaces/classifications/ClassificationResultsChart';
import { format } from 'date-fns';
import { getTargetFieldDefinition, ResultFilters, getTargetKeysForScheme } from './ClassificationResultFilters';
import { schemesToSchemeReads, resultsToResultReads, resultReadToResult, resultToResultRead, schemeToSchemeRead, documentToDocumentRead } from '@/lib/classification/adapters';
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
import useGeocode, { GeocodeResult } from '@/hooks/useGeocder'; // Import hook and its result type
import type { GeocodeResult as GeocodeResultType } from '@/hooks/useGeocder'; // Explicit type import & Corrected path
import ClassificationResultsMap, { MapPoint } from './ClassificationResultsMap'; // Renamed from LocationMap
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useClassificationSettingsStore } from '@/zustand_stores/storeClassificationSettings';
import ClassificationSchemeEditor from './ClassificationSchemeEditor'; // Import the new component
import { useGeocodingCacheStore } from '@/zustand_stores/storeGeocodingCache'; // Import the new store
import { checkFilterMatch, extractLocationString, formatDisplayValue } from '@/lib/classification/utils';
import { ResultFilter } from './ClassificationResultFilters';
import ClassificationResultsTable from './ClassificationResultsTable';
import { Switch } from '@/components/ui/switch';
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useWorkspaceStore } from '@/zustand_stores/storeWorkspace';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { ClassificationMapControls } from './ClassificationMapControls'; // Import the new component

// Main component props
interface ClassificationRunnerProps {
  activeRunId: number | null;
  activeRunName: string;
  activeRunDescription: string;
  activeRunResults: FormattedClassificationResult[];
  activeRunSchemes: ClassificationSchemeRead[];
  activeRunDocuments: DocumentRead[];
  isLoadingRunDetails: boolean;
  onClearRun: () => void;
  onUpdateRunName: (newName: string) => void; // Add prop for updating name
  onUpdateRunDescription: (newDescription: string) => void; // Add prop for updating description
}

export default function ClassificationRunner({
  activeRunId,
  activeRunName,
  activeRunDescription,
  activeRunResults,
  activeRunSchemes,
  activeRunDocuments,
  isLoadingRunDetails,
  onClearRun,
  onUpdateRunName,
  onUpdateRunDescription,
}: ClassificationRunnerProps) {

  // State needed for result display and interaction
  const [activeFilters, setActiveFilters] = useState<ResultFilter[]>([]);
  const [isResultDialogOpen, setIsResultDialogOpen] = useState(false);
  const [selectedDocumentId, setSelectedDocumentId] = useState<number | null>(null);
  const [geocodedPoints, setGeocodedPoints] = useState<MapPoint[]>([]);
  const [filteredGeocodedPoints, setFilteredGeocodedPoints] = useState<MapPoint[]>([]);
  const [isLoadingGeocoding, setIsLoadingGeocoding] = useState(false);
  const [geocodingError, setGeocodingError] = useState<string | null>(null);
  // State to hold the config passed up from MapControls
  const [currentMapLabelConfig, setCurrentMapLabelConfig] = useState<{ schemeId: number; fieldKey: string } | undefined>(undefined);
  // NEW: State to hold initial config for MapControls
  const [initialMapControlsConfig, setInitialMapControlsConfig] = useState<{
    geocodeSchemeId: number | null;
    geocodeFieldKey: string | null;
    labelSchemeId: number | null;
    labelFieldKey: string | null;
    showLabels: boolean;
  }>({ geocodeSchemeId: null, geocodeFieldKey: null, labelSchemeId: null, labelFieldKey: null, showLabels: false });

  const { toast } = useToast();
  const { geocodeLocation, loading: isGeocodingSingle, error: geocodeSingleError } = useGeocode();
  const { getCache, setCache } = useGeocodingCacheStore();
  const { activeWorkspace } = useWorkspaceStore(); // Needed for cache key

  // Editable Name/Description state
  const [isEditingName, setIsEditingName] = useState(false);
  const [isEditingDescription, setIsEditingDescription] = useState(false);

  // --- Memoized Data for Views (based on props) ---
  const runSchemes = useMemo(() => activeRunSchemes, [activeRunSchemes]);
  const currentRunResults = useMemo(() => activeRunResults, [activeRunResults]);
  const currentRunDocuments = useMemo(() => activeRunDocuments, [activeRunDocuments]);

  // --- NEW: Determine Initial Map Config ---
  useEffect(() => {
    console.log('[AutoGeoDebug] Running effect. runSchemes:', runSchemes); // Log available schemes
    if (runSchemes && runSchemes.length > 0) {
      let defaultGeoSchemeId: number | null = null;
      let defaultGeoFieldKey: string | null = null;
      let defaultLabelSchemeId: number | null = null;
      let defaultLabelFieldKey: string | null = null;
      let shouldShowLabels = false; // Flag to enable labels if defaults are found

      // Prioritize schemes named 'classification'
      const classificationSchemes = runSchemes.filter(s => s.name.toLowerCase() === 'classification');
      console.log('[AutoGeoDebug] Found classificationSchemes:', classificationSchemes); // Log filtered schemes

      const schemeToUseForGeo = classificationSchemes.length > 0 ? classificationSchemes[0] : runSchemes[0];
      console.log('[AutoGeoDebug] schemeToUseForGeo:', schemeToUseForGeo); // Log the chosen scheme

      if (schemeToUseForGeo) {
        const geoTargetKeys = getTargetKeysForScheme(schemeToUseForGeo.id, runSchemes);
        console.log('[AutoGeoDebug] geoTargetKeys for scheme:', schemeToUseForGeo.id, geoTargetKeys); // Log the potential keys

        const locationKey = geoTargetKeys.find(k => k.name.toLowerCase().includes('location') || k.name.toLowerCase().includes('address'));
        console.log('[AutoGeoDebug] Found locationKey:', locationKey); // Log the location key

        const firstStringKeyGeo = geoTargetKeys.find(k => k.type === 'str');
         console.log('[AutoGeoDebug] Found firstStringKeyGeo:', firstStringKeyGeo); // Log the string key

        if(locationKey || firstStringKeyGeo || geoTargetKeys.length > 0) {
          defaultGeoSchemeId = schemeToUseForGeo.id;
          defaultGeoFieldKey = locationKey?.key || firstStringKeyGeo?.key || (geoTargetKeys.length > 0 ? geoTargetKeys[0].key : null);
           console.log('[AutoGeoDebug] Selected defaultGeoFieldKey:', defaultGeoFieldKey); // Log the selected field key

           // --- Find default label field (in the SAME scheme if possible) ---
           // Look for first str, List[str], or List[Dict] field in the selected geocode scheme
           const firstSuitableLabelField = schemeToUseForGeo.fields.find(f =>
              f.type === 'str' || f.type === 'List[str]' || f.type === 'List[Dict[str, any]]'
           );

           if (firstSuitableLabelField) {
               defaultLabelSchemeId = schemeToUseForGeo.id;
               defaultLabelFieldKey = firstSuitableLabelField.name; // Field name is the key here
               shouldShowLabels = true; // Enable labels if we found a suitable default
           }
           // Optional: If no suitable label field in the geo scheme, you could search other schemes here
        }
      }

      console.log(`[Runner] Setting initial map config: GeoScheme ${defaultGeoSchemeId}, GeoField ${defaultGeoFieldKey}, LabelScheme ${defaultLabelSchemeId}, LabelField ${defaultLabelFieldKey}, ShowLabels ${shouldShowLabels}`);
      setInitialMapControlsConfig({
        geocodeSchemeId: defaultGeoSchemeId,
        geocodeFieldKey: defaultGeoFieldKey,
        labelSchemeId: defaultLabelSchemeId,
        labelFieldKey: defaultLabelFieldKey,
        showLabels: shouldShowLabels, // Set based on whether defaults were found
      });
    } else {
      console.log('[AutoGeoDebug] No runSchemes available.');
      // Reset if no schemes
      setInitialMapControlsConfig({ geocodeSchemeId: null, geocodeFieldKey: null, labelSchemeId: null, labelFieldKey: null, showLabels: false });
    }
  }, [runSchemes]); // Re-run when schemes change

  const generateGeocodingCacheKey = useCallback(() => {
    if (!activeWorkspace?.uid || !activeRunId) return null;
    return `${activeWorkspace.uid}-run-${activeRunId}`;
  }, [activeWorkspace?.uid, activeRunId]);

  // --- Geocoding Logic (now a callback passed to MapControls) ---
  const handleGeocodeRequest = useCallback(async (schemeIdStr: string, fieldKey: string) => {
    if (!activeRunId || !schemeIdStr || !fieldKey) {
      console.log("Geocoding prerequisites not met. Clearing points.");
      setGeocodedPoints([]);
      setFilteredGeocodedPoints([]);
      return;
    }

    // Reset previous errors/state
    const cacheKey = generateGeocodingCacheKey();
    if (cacheKey) {
        const cachedPoints = getCache(cacheKey);
        if (cachedPoints) {
            console.log("Using cached geocoded points.");
            setGeocodedPoints(cachedPoints);
            return;
        }
    }

    console.log(`Geocoding run ${activeRunId}, scheme ${schemeIdStr}, field ${fieldKey}`);
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
      await new Promise(resolve => setTimeout(resolve, 50)); // Rate limiting
    }

    if (errorsEncountered) {
        setGeocodingError("Some locations failed to geocode. See console for details.");
    }

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

    if (cacheKey) {
        setCache(cacheKey, newPoints); // Cache the newly fetched points
    }

    setIsLoadingGeocoding(false);
    console.log("Finished geocoding.");
  }, [
    activeRunId,
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

  // --- Filtered Results Logic (based on props) ---
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
        // Use runSchemes (derived from prop) here
        return activeFilters.every(filter => checkFilterMatch(filter, docResults, runSchemes));
      });

    return currentRunResults.filter(result => filteredDocIds.includes(result.document_id));
  }, [currentRunResults, activeFilters, runSchemes]);

  // --- useEffect for filtering points (based on props) ---
  useEffect(() => {
    console.log(`[DEBUG] Geocoding filter useEffect triggered. Filters: ${activeFilters.length}, Current Results: ${currentRunResults.length}, Geocoded Points: ${geocodedPoints.length}`);
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
        // Use runSchemes (derived from prop) here
        return activeFilters.every(filter => checkFilterMatch(filter, docResults, runSchemes));
      })
    );
    setFilteredGeocodedPoints(newlyFilteredPoints);
  }, [geocodedPoints, activeFilters, currentRunResults, runSchemes]);

  // --- Effect for resetting geocoding state when run changes ---
  useEffect(() => {
    setGeocodedPoints([]);
    setFilteredGeocodedPoints([]);
    setGeocodingError(null);
    setIsLoadingGeocoding(false);
    // Initial values for controls will be handled by MapControls component itself based on props
  }, [activeRunId, runSchemes]); // Dependencies: run ID and its schemes

  // --- UPDATE: Handler for Table Row Click --- (simplified)
  const handleTableRowClick = (docId: number) => {
    setSelectedDocumentId(docId);
    setIsResultDialogOpen(true);
  };

  // --- NEW: Handler for Map Point Click ---
  const handleMapPointClick = (point: MapPoint) => {
    console.log("Map point clicked in parent:", point);
    if (point.documentIds && point.documentIds.length > 0) {
      // Open the dialog for the first document associated with the point
      setSelectedDocumentId(point.documentIds[0]);
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

  // --- Handlers for Editable Run Name/Description ---
  const handleEditClick = (field: 'name' | 'description') => {
      const elementId = field === 'name' ? 'run-name-editable' : 'run-description-editable';
      if (field === 'name') setIsEditingName(true);
      else setIsEditingDescription(true);

      setTimeout(() => {
          const el = document.getElementById(elementId);
          if (el) {
              el.contentEditable = 'true';
              el.focus();
              // Select text logic (simplified)
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
        if (newValue !== activeRunName) {
            onUpdateRunName(newValue); // Call prop function
        }
    } else {
        setIsEditingDescription(false);
        const placeholder = "Add a description...";
        if (newValue !== activeRunDescription && newValue !== placeholder) {
            onUpdateRunDescription(newValue); // Call prop function
        } else if (newValue === placeholder && activeRunDescription !== '') {
            onUpdateRunDescription(''); // Clear description
        }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLSpanElement>, field: 'name' | 'description') => {
      if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
      } else if (e.key === 'Escape') {
          e.currentTarget.innerText = field === 'name' ? activeRunName : (activeRunDescription || "Add a description...");
          e.currentTarget.blur();
      }
  };
  // --- End Editable Handlers ---

  // --- Define renderResultsTabs function BEFORE the main return ---
  const renderResultsTabs = () => {
    if (isLoadingRunDetails) {
      return <div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin" /></div>;
    }
    // Use prop directly for check
    if (!activeRunResults || activeRunResults.length === 0) {
      return <div className="flex items-center justify-center h-64 text-muted-foreground">No results found for this run.</div>;
    }

    return (
       <Tabs defaultValue="chart" className="w-full">
         <TabsList className="grid w-full grid-cols-3 mb-2 sticky top-0 z-10">
           <TabsTrigger value="chart">Chart</TabsTrigger>
           <TabsTrigger value="table">Table</TabsTrigger>
           <TabsTrigger value="map">Map</TabsTrigger>
         </TabsList>
         <TabsContent value="chart">
           <div className="p-1 rounded-lg bg-muted/40 backdrop-blur supports-[backdrop-filter]:bg-background/60">
             {/* Pass prop data */}
             <ClassificationResultsChart results={currentRunResults} schemes={runSchemes} documents={currentRunDocuments} filters={activeFilters} />
           </div>
         </TabsContent>
         <TabsContent value="table">
           <div className="p-1 rounded-lg bg-muted/40 backdrop-blur supports-[backdrop-filter]:bg-background/60">
             {/* Pass prop data */}
             <ClassificationResultsTable
               results={currentRunResults}
               schemes={runSchemes}
               documents={currentRunDocuments}
               filters={activeFilters}
               onRowClick={handleTableRowClick}
             />
           </div>
         </TabsContent>
         <TabsContent value="map">
            {/* Use the new Map Controls Component */}
            <ClassificationMapControls
               schemes={runSchemes}
               results={currentRunResults}
               onGeocodeRequest={handleGeocodeRequest}
               isLoadingGeocoding={isLoadingGeocoding}
               geocodingError={geocodingError}
               onMapLabelConfigChange={setCurrentMapLabelConfig}
               // Pass initial values derived from schemes
               initialSelectedGeocodeSchemeId={initialMapControlsConfig.geocodeSchemeId !== null ? String(initialMapControlsConfig.geocodeSchemeId) : null}
               initialSelectedGeocodeField={initialMapControlsConfig.geocodeFieldKey}
               // Pass initial label props
               initialMapLabelSchemeId={initialMapControlsConfig.labelSchemeId}
               initialMapLabelFieldKey={initialMapControlsConfig.labelFieldKey}
               initialShowMapLabels={initialMapControlsConfig.showLabels}
            />

            {/* Map Component - Use filteredGeocodedPoints */}
            <div className="p-1 rounded-lg bg-muted/40 backdrop-blur supports-[backdrop-filter]:bg-background/60 overflow-hidden h-[600px] relative">
              {isLoadingGeocoding ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10"><Loader2 className="h-8 w-8 animate-spin text-primary"/></div>
              ) : filteredGeocodedPoints.length > 0 ? (
                  <ClassificationResultsMap
                      points={filteredGeocodedPoints} // Use the filtered points generated after geocoding
                      documents={currentRunDocuments}
                      results={currentRunResults}
                      schemes={runSchemes}
                      labelConfig={currentMapLabelConfig} // Use state updated by MapControls
                      onPointClick={handleMapPointClick} // Pass the handler
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

  // --- Main Component Return (Modified) ---
  return (
    <DocumentDetailProvider>
      <DocumentDetailWrapper onLoadIntoRunner={() => { /* This needs to be handled by parent */ }}>
          {/* Main Content Area (Analysis) - Takes full width now */}
          <div className="flex-1 flex flex-col overflow-auto">

            {/* Analysis Content Area */}
            <div className="p-4 flex-1 space-y-4 overflow-y-auto">

              {/* Run Details Header */}
              {activeRunId && (
                <div className="p-3 rounded-md bg-muted/10 flex items-center justify-between sticky top-0 bg-background/95 backdrop-blur z-10">
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
                          title={activeRunName || 'Unnamed Run'}
                      >
                          {activeRunName || 'Unnamed Run'}
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
                          onBlur={(e) => handleBlur(e, 'description')}
                          onKeyDown={(e) => handleKeyDown(e, 'description')}
                          onClick={() => !isEditingDescription && handleEditClick('description')}
                          title={activeRunDescription || 'Add a description...'}
                      >
                          {activeRunDescription || 'Add a description...'}
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
                  </div>
                  <Button variant="outline" size="sm" onClick={onClearRun} disabled={!activeRunId}>
                    <XCircle className="h-4 w-4 mr-1" /> Clear Run
                  </Button>
                </div>
              )}

              {/* Filters */}
              {activeRunId && !isLoadingRunDetails && (
                <div className="p-3 rounded-md bg-muted/10">
                  <ResultFilters
                    filters={activeFilters}
                    schemes={runSchemes} // Use schemes from props
                    onChange={setActiveFilters}
                  />
                </div>
              )}

              {/* Results Display Area */}
              {(activeRunId && !isLoadingRunDetails) || isLoadingRunDetails ? (
                <div className="mt-2">
                  {isLoadingRunDetails ? (
                    <div className="flex justify-center items-center h-60">
                      <Loader2 className="h-8 w-8 animate-spin text-primary"/>
                      <span className="ml-2">Loading results...</span>
                    </div>
                  ) : (
                    renderResultsTabs()
                  )}
                </div>
              ) : (
                <div className="text-center p-12 text-muted-foreground border rounded-lg border-dashed">
                  Load a run from history or create a new one to view results.
                </div>
              )}
            </div>
          </div>
          {/* === End Main Content Area === */}

        {/* Dialogs (remain outside the flex container, potentially managed by parent page) */}
        <Dialog open={isResultDialogOpen} onOpenChange={setIsResultDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Result Details</DialogTitle>
              <DialogDescription>
                 Detailed view of classification results for the selected document.
              </DialogDescription>
            </DialogHeader>
            <ScrollArea className="max-h-[60vh] p-4">
                {selectedDocumentId !== null && (() => {
                   // Use prop data here
                   const doc = currentRunDocuments.find(d => d.id === selectedDocumentId);
                   const resultsForDoc = currentRunResults.filter(r => r.document_id === selectedDocumentId);
                   const schemesForDoc = resultsForDoc
                       .map(r => runSchemes?.find(s => s.id === r.scheme_id)) // Handle runSchemes potentially being undefined briefly
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

        {/* Toaster should ideally be at a higher layout level */}
      </DocumentDetailWrapper>
    </DocumentDetailProvider>
  );
}