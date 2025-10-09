// frontend/src/components/collection/infospaces/annotation/AnnotationResultsMap.tsx
'use client';

import React, { useRef, useEffect, useState, useCallback, useMemo, startTransition } from 'react';
import mapboxgl, { Map as MapboxMap, LngLatLike, Popup, Marker, LngLatBounds } from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useTheme } from 'next-themes';
import { AnnotationSchemaRead, AssetRead } from '@/client';
import { FormattedAnnotation, TimeAxisConfig } from '@/lib/annotations/types';
import { formatDisplayValue, getAnnotationFieldValue, getTargetKeysForScheme } from '@/lib/annotations/utils';
import { debounce } from 'lodash';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Globe, Map as MapIcon, MapPin, FileText, Calendar, Tag, X, ExternalLink, Info, ChevronDown, Eye } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import AnnotationResultDisplay from './AnnotationResultDisplay';
import { cn } from '@/lib/utils';
import { VariableSplittingConfig, applySplittingToResults } from './VariableSplittingControls';
import { Settings2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

// Define the structure for points passed to the map
export interface MapPoint {
  id: string;
  locationString: string;
  coordinates: {
    latitude: number;
    longitude: number;
  };
  documentIds: number[];
  bbox?: [number, number, number, number];
  type?: string;
  splitValue?: string; // NEW: Split value for variable splitting
}

// Time filtering utility function (copied from AnnotationResultsChart.tsx)
const getTimestamp = (result: FormattedAnnotation, assetsMap: Map<number, AssetRead>, timeAxisConfig: TimeAxisConfig | null): Date | null => {
  if (!timeAxisConfig) return null;

  switch (timeAxisConfig.type) {
    case 'default':
      return new Date(result.timestamp);
    case 'schema':
      if (result.schema_id === timeAxisConfig.schemaId && timeAxisConfig.fieldKey) {
        const fieldValue = getAnnotationFieldValue(result.value, timeAxisConfig.fieldKey);
        if (fieldValue && (typeof fieldValue === 'string' || fieldValue instanceof Date)) {
          try {
            return new Date(fieldValue);
          } catch {
            return null;
          }
        }
      }
      return null;
    case 'event':
      const asset = assetsMap.get(result.asset_id);
      if (asset?.event_timestamp) {
        try {
          return new Date(asset.event_timestamp);
        } catch {
          return null;
        }
      }
      return null;
    default:
      return new Date(result.timestamp);
  }
};

interface AnnotationResultsMapProps {
  points: MapPoint[];
  results: FormattedAnnotation[];
  schemas: AnnotationSchemaRead[];
  labelConfig?: {
    schemaId: number;
    fieldKey: string;
  };
  onPointClick?: (point: MapPoint) => void;
  assets?: any[];
  // NEW: Time frame filtering
  timeAxisConfig?: TimeAxisConfig | null;
  // NEW: Variable splitting
  variableSplittingConfig?: VariableSplittingConfig | null;
  onVariableSplittingChange?: (config: VariableSplittingConfig | null) => void;
  // NEW: Settings persistence
  onSettingsChange?: (settings: any) => void;
  initialSettings?: any;
  // NEW: Field selection controls
  selectedFieldsPerScheme?: Record<number, string[]>;
  onSelectedFieldsChange?: (selectedFieldsPerScheme: Record<number, string[]>) => void;
  // NEW: Result selection callback
  onResultSelect?: (result: FormattedAnnotation) => void;
}

// Define a specific type for our label features
interface LabelGeoJsonFeature extends GeoJSON.Feature {
  geometry: {
    type: 'Point';
    coordinates: [number, number];
  };
  properties: {
    labelText: string;
    color: string;
    // Add other potential properties if needed
  };
}

// Get specific field value for labels using hierarchical access
const getLabelValue = (resultValue: any, schema: AnnotationSchemaRead | undefined, fieldKey: string): string => {
    if (!resultValue || !schema || !schema.output_contract) return 'N/A';

    // Use hierarchical field access for better compatibility
    const actualValue = getAnnotationFieldValue(resultValue, fieldKey);

    if (actualValue === null || actualValue === undefined) return 'N/A';

    if (Array.isArray(actualValue)) {
        return actualValue.map(v => String(v)).join(', ');
    }
    if (typeof actualValue === 'object') {
        return JSON.stringify(actualValue);
    }

    return String(actualValue);
};

// Inline Side Panel Component
interface InlineSidePanelProps {
  point: MapPoint | null;
  results: FormattedAnnotation[];
  schemas: AnnotationSchemaRead[];
  onClose: () => void;
  onPointClick?: (point: MapPoint) => void;
  assets?: any[];
  // NEW: Field selection props
  selectedFieldsPerScheme?: Record<number, string[]>;
  onSelectedFieldsChange?: (selectedFieldsPerScheme: Record<number, string[]>) => void;
  // NEW: Result selection callback
  onResultSelect?: (result: FormattedAnnotation) => void;
}

const InlineSidePanel: React.FC<InlineSidePanelProps> = ({ 
  point, 
  results, 
  schemas, 
  onClose, 
  onPointClick,
  assets = [],
  // NEW: Field selection props
  selectedFieldsPerScheme: externalSelectedFieldsPerScheme,
  onSelectedFieldsChange: externalOnSelectedFieldsChange,
  // NEW: Result selection callback
  onResultSelect
}) => {
  // SIMPLIFIED: Use one state source like table
  const [selectedFieldsPerScheme, setSelectedFieldsPerScheme] = useState<Record<number, string[]>>(() => {
    // If external state provided, use it
    if (externalSelectedFieldsPerScheme && Object.keys(externalSelectedFieldsPerScheme).length > 0) {
      return externalSelectedFieldsPerScheme;
    }
    // Otherwise initialize with ALL fields like table
    const initialState: Record<number, string[]> = {};
    schemas.forEach(schema => {
        const targetKeys = getTargetKeysForScheme(schema.id, schemas);
        initialState[schema.id] = targetKeys.map(tk => tk.key);
    });
    
    return initialState;
  });

  // Update state when schemas change, but respect external state
  React.useEffect(() => {
    setSelectedFieldsPerScheme(prev => {
      const newState: Record<number, string[]> = {};
      schemas.forEach(schema => {
        const targetKeys = getTargetKeysForScheme(schema.id, schemas);
        const keys = targetKeys.map(tk => tk.key);
        
        // Priority: external state > previous state > default (all keys)
        if (externalSelectedFieldsPerScheme && externalSelectedFieldsPerScheme[schema.id]) {
          newState[schema.id] = externalSelectedFieldsPerScheme[schema.id];
        } else {
          newState[schema.id] = prev[schema.id] ?? keys;
        }
      });
      
      return newState;
    });
  }, [schemas, externalSelectedFieldsPerScheme]);

  // NEW: Field selection handler - ALLOW ZERO FIELDS TO HIDE SCHEMAS
  const handleFieldToggle = useCallback((schemaId: number, fieldKey: string) => {
    setSelectedFieldsPerScheme(prev => {
      const currentSelected = prev[schemaId] || [];
      const isSelected = currentSelected.includes(fieldKey);
      const newSelected = isSelected 
        ? currentSelected.filter(key => key !== fieldKey) 
        : [...currentSelected, fieldKey];
      
      // FIXED: Allow zero fields (this hides the schema)
      const updatedSelection = { ...prev, [schemaId]: newSelected };
      
      return updatedSelection;
    });
  }, []);

  // Sync external state when local state changes (prevents render-time state updates)
  const prevSelectedFieldsRef = useRef<Record<number, string[]>>({});
  const externalOnSelectedFieldsChangeRef = useRef(externalOnSelectedFieldsChange);
  
  // Update the ref whenever the callback changes
  React.useEffect(() => {
    externalOnSelectedFieldsChangeRef.current = externalOnSelectedFieldsChange;
  }, [externalOnSelectedFieldsChange]);
  
  React.useEffect(() => {
    // Only call external change handler if the values have actually changed
    const hasChanged = JSON.stringify(selectedFieldsPerScheme) !== JSON.stringify(prevSelectedFieldsRef.current);
    
    if (hasChanged && externalOnSelectedFieldsChangeRef.current) {
      prevSelectedFieldsRef.current = selectedFieldsPerScheme;
      externalOnSelectedFieldsChangeRef.current(selectedFieldsPerScheme);
    }
  }, [selectedFieldsPerScheme]); // Remove externalOnSelectedFieldsChange from dependencies

  // Early return AFTER all hooks have been called
  if (!point) return null;

  const schemaLookup = new Map(schemas.map(s => [s.id, s]));
  
  // Get annotation results for this point's documents
  const pointResults = results.filter(r => point.documentIds.includes(r.asset_id));
  
  // Group assets by asset_id to show unique assets
  const assetGroups = new Map<number, {
    assetId: number;
    results: Array<{ result: FormattedAnnotation; schema: AnnotationSchemaRead }>;
  }>();
  
  pointResults.forEach(result => {
    const schema = schemaLookup.get(result.schema_id);
    if (schema) {
      if (!assetGroups.has(result.asset_id)) {
        assetGroups.set(result.asset_id, {
          assetId: result.asset_id,
          results: []
        });
      }
      assetGroups.get(result.asset_id)!.results.push({ result, schema });
    }
  });

  return (
    <div className="absolute top-0 right-0 w-1/2 h-full bg-background/25 backdrop-blur border-l border-border z-10 flex flex-col">
      <div className="flex-shrink-0 border-b border-border px-2 py-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <MapPin className="h-3.5 w-3.5 text-primary flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <h3 className="font-medium text-xs truncate">{point.locationString}</h3>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <FileText className="h-3 w-3" />
                <span>{point.documentIds.length} doc{point.documentIds.length === 1 ? '' : 's'}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {/* NEW: Field Configuration Button */}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  title="Configure visible fields"
                >
                  <Settings2 className="h-3 w-3" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-0" align="end">
                <div className="p-3 font-medium text-sm border-b">Configure Visible Fields</div>
                <ScrollArea className="max-h-80 overflow-y-auto">
                  {schemas.map(schema => {
                    const currentSelectedFields = selectedFieldsPerScheme[schema.id] || [];
                    const availableFields = getTargetKeysForScheme(schema.id, schemas);
                    
                    return (
                      <div key={schema.id} className="p-3 border-b last:border-b-0">
                        <div className="font-medium text-sm mb-2">{schema.name}</div>
                        <div className="space-y-2">
                          {availableFields.map(field => (
                            <div key={field.key} className="flex items-center space-x-2">
                              <Checkbox
                                id={`field-map-toggle-${schema.id}-${field.key}`}
                                checked={currentSelectedFields.includes(field.key)}
                                onCheckedChange={() => handleFieldToggle(schema.id, field.key)}
                              />
                              <Label
                                htmlFor={`field-map-toggle-${schema.id}-${field.key}`}
                                className="text-sm cursor-pointer truncate"
                              >
                                {field.name} ({field.type})
                              </Label>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </ScrollArea>
              </PopoverContent>
            </Popover>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={onClose}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>
      
      <div className="flex-1 overflow-auto p-2">
        {assetGroups.size > 0 ? (
          <div className="space-y-2">
            {Array.from(assetGroups.values()).map((assetGroup, index) => {
              if (index > 0) {
                return (
                  <div key={assetGroup.assetId}>
                    <div className="border-t my-2" />
                    <AssetCard 
                      assetGroup={assetGroup} 
                      selectedFieldsPerScheme={selectedFieldsPerScheme}
                      onPointClick={onPointClick}
                      point={point}
                      compact={true}
                      allAssets={assets}
                      onResultSelect={onResultSelect}
                    />
                  </div>
                );
              }
              return (
                <AssetCard 
                  key={assetGroup.assetId}
                  assetGroup={assetGroup} 
                  selectedFieldsPerScheme={selectedFieldsPerScheme}
                  onPointClick={onPointClick}
                  point={point}
                  compact={true}
                  allAssets={assets}
                  onResultSelect={onResultSelect}
                />
              );
            })}
            
            {assetGroups.size > 1 && (
              <div className="pt-2 border-t">
                <Button 
                  onClick={() => onPointClick?.(point)}
                  className="w-full text-xs"
                  variant="outline"
                  size="sm"
                >
                  <ExternalLink className="h-3 w-3 mr-1" />
                  View All {assetGroups.size} Asset{assetGroups.size === 1 ? '' : 's'}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-6 text-muted-foreground">
            <MapPin className="h-6 w-6 mx-auto mb-2 opacity-50" />
            <p className="text-xs">No annotation results available</p>
          </div>
        )}
      </div>
    </div>
  );
};

// Asset Card Component using AnnotationResultDisplay
interface AssetCardProps {
  assetGroup: {
    assetId: number;
    results: Array<{ result: FormattedAnnotation; schema: AnnotationSchemaRead }>;
  };
  selectedFieldsPerScheme: Record<number, string[]>;
  onPointClick?: (point: MapPoint) => void;
  point: MapPoint;
  compact?: boolean;
  allAssets?: any[]; // Add assets for title lookup
  // NEW: Result selection callback
  onResultSelect?: (result: FormattedAnnotation) => void;
}

const AssetCard: React.FC<AssetCardProps> = ({ 
  assetGroup, 
  selectedFieldsPerScheme, 
  onPointClick, 
  point,
  compact = false,
  allAssets = [],
  // NEW: Result selection callback
  onResultSelect
}) => {
  // Group by schema
  const schemaMap = new Map<string, Array<{ result: FormattedAnnotation; schema: AnnotationSchemaRead }>>();
  assetGroup.results.forEach(({ result, schema }) => {
    if (!schemaMap.has(schema.name)) {
      schemaMap.set(schema.name, []);
    }
    schemaMap.get(schema.name)!.push({ result, schema });
  });

  // Find the asset to get its title
  const asset = allAssets.find(a => a.id === assetGroup.assetId);
  const assetTitle = asset?.title || `Asset ${assetGroup.assetId}`;

  const handleAssetClick = () => {
    if (onPointClick) {
      // Create a point for just this asset
      const singleAssetPoint: MapPoint = {
        ...point,
        documentIds: [assetGroup.assetId]
      };
      onPointClick(singleAssetPoint);
    }
  };

  return (
    <div className={cn(
      "border rounded-lg hover:bg-muted/20 transition-colors",
      compact ? "p-2 space-y-2" : "p-3 space-y-3"
    )}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className={cn("text-primary flex-shrink-0", compact ? "h-3 w-3" : "h-4 w-4")} />
          <div className="flex-1 min-w-0">
            <button
              onClick={handleAssetClick}
              className={cn(
                "font-medium hover:underline text-foreground hover:text-primary cursor-pointer text-left p-0 m-0 bg-transparent border-none transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 rounded-sm block w-full truncate",
                compact ? "text-xs" : "text-sm"
              )}
              title={`View details: ${assetTitle}`}
            >
              {assetTitle}
            </button>
            <div className={cn(
              "text-muted-foreground font-mono",
              compact ? "text-xs" : "text-xs"
            )}>
              ID: {assetGroup.assetId}
            </div>
          </div>
        </div>
        <Button 
          onClick={handleAssetClick}
          size={compact ? "sm" : "sm"}
          variant="outline"
          className={compact ? "text-xs h-5 px-2 flex-shrink-0" : "text-xs h-6 flex-shrink-0"}
        >
          View Details
        </Button>
      </div>

      <div className={compact ? "space-y-1" : "space-y-2"}>
        {Array.from(schemaMap.entries()).map(([schemaName, schemaResults]) => {
          const sampleResult = schemaResults[0];
          if (!sampleResult) return null;
          
          const selectedFields = selectedFieldsPerScheme[sampleResult.schema.id] || [];
          
          // FIXED: Hide schemas with zero selected fields
          if (selectedFields.length === 0) return null;
          
          return (
            <div key={schemaName} className="space-y-1">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className={compact ? "text-xs px-1 py-0" : "text-xs"}>
                  {schemaName}
                </Badge>
                {selectedFields.length > 1 && (
                  <Badge variant="outline" className="text-xs">
                    {selectedFields.length} fields
                  </Badge>
                )}
              </div>
              <div className={compact ? "ml-1" : "ml-2"}>
                <AnnotationResultDisplay
                  result={sampleResult.result}
                  schema={sampleResult.schema}
                  compact={false}
                  selectedFieldKeys={selectedFields}
                  renderContext="table"
                  onResultSelect={onResultSelect}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const AnnotationResultsMap: React.FC<AnnotationResultsMapProps> = ({
  points,
  results,
  schemas,
  labelConfig,
  onPointClick,
  assets = [],
  // NEW: Time frame filtering
  timeAxisConfig,
  // NEW: Variable splitting
  variableSplittingConfig,
  onVariableSplittingChange,
  // NEW: Settings persistence
  onSettingsChange,
  initialSettings,
  // NEW: Field selection
  selectedFieldsPerScheme,
  onSelectedFieldsChange,
  // NEW: Result selection callback
  onResultSelect,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<MapPoint | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [isGlobeView, setIsGlobeView] = useState(false);
  const { theme } = useTheme();

  const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || 'pk.eyJ1IjoiamltdnciLCJhIjoiY20xd2U3Z2pqMGprdDJqczV2OXJtMTBoayJ9.hlSx0Nc19j_Z1NRgyX7HHg';

  // NEW: Apply time frame filtering and variable splitting
  const assetsMap = useMemo(() => new Map((assets || []).map(asset => [asset.id, asset])), [assets]);
  
  const timeFilteredResults = useMemo(() => {
    if (!timeAxisConfig?.timeFrame?.enabled || !timeAxisConfig.timeFrame.startDate || !timeAxisConfig.timeFrame.endDate) {
      return results;
    }

    const { startDate, endDate } = timeAxisConfig.timeFrame;
    
    return results.filter(result => {
      const timestamp = getTimestamp(result, assetsMap, timeAxisConfig);
      if (!timestamp) return false;
      
      return timestamp >= startDate && timestamp <= endDate;
    });
  }, [results, timeAxisConfig, assetsMap]);

  const processedResults = useMemo(() => {
    if (variableSplittingConfig?.enabled) {
      return applySplittingToResults(timeFilteredResults, variableSplittingConfig);
    }
    return { all: timeFilteredResults };
  }, [timeFilteredResults, variableSplittingConfig]);

  // NEW: Process points to handle variable splitting
  const processedPoints = useMemo(() => {
    if (variableSplittingConfig?.enabled && Object.keys(processedResults).length > 1) {
      // Create split-specific points
      const splitPoints: MapPoint[] = [];
      
      Object.entries(processedResults).forEach(([splitValue, splitResults]) => {
        if (splitResults.length > 0) {
          // Group results by location for this split
          const locationGroups = new Map<string, number[]>();
          
          splitResults.forEach(result => {
            const point = points.find(p => p.documentIds.includes(result.asset_id));
            if (point) {
              const locationKey = `${point.coordinates.latitude},${point.coordinates.longitude}`;
              if (!locationGroups.has(locationKey)) {
                locationGroups.set(locationKey, []);
              }
              if (!locationGroups.get(locationKey)!.includes(result.asset_id)) {
                locationGroups.get(locationKey)!.push(result.asset_id);
              }
            }
          });
          
          // Create points for each location with split identifiers
          locationGroups.forEach((documentIds, locationKey) => {
            const originalPoint = points.find(p => 
              documentIds.some(docId => p.documentIds.includes(docId))
            );
            
            if (originalPoint) {
              splitPoints.push({
                ...originalPoint,
                id: `${originalPoint.id}_split_${splitValue}`,
                locationString: `${originalPoint.locationString} (${splitValue})`,
                documentIds: documentIds,
                splitValue: splitValue !== 'all' ? splitValue : undefined
              });
            }
          });
        }
      });
      
      return splitPoints;
    }
    
    // Return original points if no splitting
    return points;
  }, [points, processedResults, variableSplittingConfig]);

  // Use processed results and points for display
  const resultsForMap = useMemo(() => {
    return processedResults.all || timeFilteredResults;
  }, [processedResults, timeFilteredResults]);

  const toggleProjection = useCallback(() => {
    if (mapRef.current && mapLoaded) {
      const newProjection = isGlobeView ? 'mercator' : 'globe';
      mapRef.current.setProjection(newProjection as any);
      setIsGlobeView(!isGlobeView);
    }
  }, [isGlobeView, mapLoaded]);

  // Handle point click - always show side panel for consistent UX
  const handlePointClick = useCallback((point: MapPoint) => {
    // Always show the side panel first, regardless of result count
    // This provides consistent behavior and lets users see context
    setSelectedPoint(point);
  }, []);

  const handleClosePopup = useCallback(() => {
    setSelectedPoint(null);
  }, []);

  // Map resize effect removed since overlay is now opaque and doesn't require map resizing

  useEffect(() => {
    if (!mapContainerRef.current) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: theme === 'dark' ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/light-v11',
      center: [-98.5795, 39.8283], // Center of the US
      zoom: 3,
      projection: 'mercator' as any // Start with flat view
    });

    map.on('load', () => {
      setMapLoaded(true);
    });

    mapRef.current = map;

    // Set up ResizeObserver to handle container resize
    if (mapContainerRef.current && 'ResizeObserver' in window) {
      resizeObserverRef.current = new ResizeObserver(
        debounce(() => {
          if (mapRef.current) {
            // Trigger map resize after a short delay to ensure container has finished resizing
            setTimeout(() => {
              if (mapRef.current) {
                mapRef.current.resize();
              }
            }, 100);
          }
        }, 250)
      );
      
      resizeObserverRef.current.observe(mapContainerRef.current);
    }

    return () => {
      // Clean up resize observer
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
      
      // Clean up markers when map is removed
      markersRef.current.forEach(marker => marker.remove());
      markersRef.current = [];
      map.remove();
    };
  }, [theme, MAPBOX_TOKEN]);

  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;

    const map = mapRef.current;
    
    // Function to add markers when style is ready
    const addMarkers = () => {
      // Safety check - make sure map is still valid
      if (!mapRef.current || !mapRef.current.isStyleLoaded()) {
        return;
      }

      try {
        // Clean up existing markers
        markersRef.current.forEach(marker => marker.remove());
        markersRef.current = [];

        const bounds = new mapboxgl.LngLatBounds();

        // Add markers for each point - using default Mapbox markers
        processedPoints.forEach(point => {
          const { longitude, latitude } = point.coordinates;
          bounds.extend([longitude, latitude]);

          // Create default Mapbox marker (no custom styling)
          const marker = new mapboxgl.Marker()
            .setLngLat([longitude, latitude])
            .addTo(map);

          // Store reference to marker for cleanup
          markersRef.current.push(marker);

          // Add click handler to the marker element
          const markerElement = marker.getElement();
          markerElement.style.cursor = 'pointer';
          markerElement.addEventListener('click', (e) => {
            e.stopPropagation();
            handlePointClick(point);
          });
        });

        // Fit map to bounds if we have points
        if (!bounds.isEmpty()) {
          map.fitBounds(bounds, {
            padding: 50,
            maxZoom: 15
          });
        }
      } catch (error) {
        console.warn('Error adding map markers:', error);
      }
    };

    // Check if style is loaded before adding markers
    if (map.isStyleLoaded()) {
      addMarkers();
    } else {
      // Wait for style to load, then add markers
      map.once('style.load', addMarkers);
    }

    // Cleanup function to remove existing markers
    return () => {
      markersRef.current.forEach(marker => marker.remove());
      markersRef.current = [];
    };
  }, [processedPoints, mapLoaded, handlePointClick]);

  // Enhanced label generation with numeric field averaging
  const labelData = useMemo(() => {
    if (processedPoints.length === 0) {
      return null;
    }

    const schemeLookup = new Map(schemas.map(s => [s.id, s]));
    
    const featuresForMap: LabelGeoJsonFeature[] = processedPoints.map(point => {
      if (!point.documentIds.length) return null;

      // Always show location as the primary label
      let labelText = point.locationString;

      // If labelConfig is provided, add the field value underneath
      if (labelConfig && schemas.some(s => s.id === labelConfig.schemaId) && resultsForMap.length > 0) {
        const schema = schemeLookup.get(labelConfig.schemaId);
        
        if (schema) {
          // Get ALL results for this location (all documents at this point)
          const locationResults = resultsForMap.filter(r =>
            point.documentIds.includes(r.asset_id) && r.schema_id === labelConfig.schemaId
          );

          if (locationResults.length > 0) {
            // Determine if this is a numeric field
            const targetKeys = getTargetKeysForScheme(labelConfig.schemaId, schemas);
            const fieldInfo = targetKeys.find(tk => tk.key === labelConfig.fieldKey);
            const isNumericField = fieldInfo && (fieldInfo.type === 'integer' || fieldInfo.type === 'number');

            if (isNumericField && locationResults.length > 1) {
              // Calculate average for numeric fields with multiple results
              const numericValues: number[] = [];
              
              locationResults.forEach(result => {
                const fieldValue = getAnnotationFieldValue(result.value, labelConfig.fieldKey);
                const numValue = Number(fieldValue);
                if (!isNaN(numValue) && fieldValue !== null && fieldValue !== undefined) {
                  numericValues.push(numValue);
                }
              });

              if (numericValues.length > 0) {
                const average = numericValues.reduce((sum, val) => sum + val, 0) / numericValues.length;
                const formattedAverage = Number.isInteger(average) ? average.toString() : average.toFixed(2);
                labelText = `${labelText}\nAvg: ${formattedAverage} (${numericValues.length} values)`;
              }
            } else {
              // For non-numeric fields or single results, use existing logic
              const firstResult = locationResults[0];
              const fieldValue = getLabelValue(firstResult.value, schema, labelConfig.fieldKey);
              if (fieldValue && fieldValue !== 'N/A') {
                // Add the field value on a new line, truncated to prevent overly long labels
                const truncatedFieldValue = String(fieldValue).substring(0, 30);
                labelText = `${labelText}\n${truncatedFieldValue}`;
              }
            }
          }
        }
      }

      const labelColor = theme === 'dark' ? '#FFFFFF' : '#000000';

      return {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [point.coordinates.longitude, point.coordinates.latitude]
        },
        properties: {
          labelText: labelText,
          color: labelColor
        }
      } as LabelGeoJsonFeature;
    }).filter((feature): feature is LabelGeoJsonFeature => feature !== null);

    return featuresForMap;
  }, [labelConfig?.schemaId, labelConfig?.fieldKey, processedPoints, resultsForMap, schemas, theme]);

  // Calculate and display labels if configured - STABLE with memoized data
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;

    const map = mapRef.current;
    const sourceId = 'label-source';
    const layerId = 'label-layer';

    // Function to add labels when style is ready
    const addLabels = () => {
      // Safety check - make sure map is still valid
      if (!mapRef.current || !mapRef.current.isStyleLoaded()) {
        return;
      }

      try {
        // Always try to remove existing source/layer first
        if (map.getLayer(layerId)) {
          map.removeLayer(layerId);
        }
        if (map.getSource(sourceId)) {
          map.removeSource(sourceId);
        }

        // Only add labels if we have label data
        if (!labelData || labelData.length === 0) {
          return;
        }

        // Add the label source and layer
        map.addSource(sourceId, {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: labelData
          }
        });

        map.addLayer({
          id: layerId,
          type: 'symbol',
          source: sourceId,
          layout: {
            'text-field': ['get', 'labelText'],
            'text-size': 11,
            'text-anchor': 'top',
            'text-offset': [0, 1.2],
            'text-allow-overlap': false,
            'text-line-height': 1.2,
            'text-justify': 'center'
          },
          paint: {
            'text-color': ['get', 'color'],
            'text-halo-color': theme === 'dark' ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.8)',
            'text-halo-width': 1.5
          }
        });
      } catch (error) {
        console.warn('Error adding map labels:', error);
      }
    };

    // Check if style is loaded before adding labels
    if (map.isStyleLoaded()) {
      addLabels();
    } else {
      // Wait for style to load, then add labels
      map.once('style.load', addLabels);
    }

    // Cleanup function to remove existing labels
    return () => {
      if (mapRef.current && mapRef.current.isStyleLoaded()) {
        try {
          if (map.getLayer(layerId)) {
            map.removeLayer(layerId);
          }
          if (map.getSource(sourceId)) {
            map.removeSource(sourceId);
          }
        } catch (error) {
          console.warn('Error cleaning up map labels:', error);
        }
      }
    };
  }, [mapLoaded, labelData]); // SIMPLIFIED: Only depend on mapLoaded and memoized labelData

  // --- Adjust map style based on theme ---
  useEffect(() => {
     if (mapRef.current && mapLoaded) {
        const map = mapRef.current;
        const targetStyleUrl = theme === 'dark' ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/light-v11';

        const updateStyleIfNeeded = () => {
            if (!map.isStyleLoaded()) return;
            
            // Get current style URL safely
            try {
                const styleObject = map.getStyle();
                const currentStyleUrl = styleObject?.sprite?.toString().split('/sprites')[0] ?? '';

                if (currentStyleUrl !== targetStyleUrl) {
                    map.setStyle(targetStyleUrl);
                    // The style.load event will trigger and other useEffects will handle re-adding sources/layers
                }
            } catch (error) {
                console.warn('Error checking map style:', error);
            }
        };

        // Ensure the map's style is loaded before attempting to get or set it
        if (map.isStyleLoaded()) {
            updateStyleIfNeeded();
        } else {
            // If the style isn't loaded yet, wait for it to load first
            map.once('style.load', () => {
                updateStyleIfNeeded();
            });
        }
     }
     // Keep dependencies minimal, related only to theme and map readiness.
  }, [theme, mapLoaded]);

  // Get label configuration info for display
  const labelConfigInfo = useMemo(() => {
    if (!labelConfig) return null;
    
    const schema = schemas.find(s => s.id === labelConfig.schemaId);
    if (!schema) return null;
    
    const targetKeys = getTargetKeysForScheme(labelConfig.schemaId, schemas);
    const fieldInfo = targetKeys.find(tk => tk.key === labelConfig.fieldKey);
    
    return {
      schemaName: schema.name,
      fieldName: fieldInfo?.name || labelConfig.fieldKey,
      fieldType: fieldInfo?.type || 'unknown'
    };
  }, [labelConfig, schemas]);

  // Handle location click from list
  const handleLocationClick = useCallback((point: MapPoint) => {
    if (mapRef.current) {
      // Calculate offset to account for side panel (which takes up half the width)
      // We want the marker to appear in the center of the visible (left) half
      const map = mapRef.current;
      const container = map.getContainer();
      const containerWidth = container.offsetWidth;
      
      // Side panel takes up 50% of width, so we want to center in the left 50%
      // This means shifting the center point to the left by 25% of total width
      const offsetRatio = -0.05; // Shift left by 25% of total width
      
      // Convert the offset from screen coordinates to map coordinates
      try {
        const bounds = map.getBounds();
        if (!bounds) {
          throw new Error('Bounds not available');
        }
        
        const longitudeRange = bounds.getEast() - bounds.getWest();
        const longitudeOffset = longitudeRange * offsetRatio;
        
        // Calculate the adjusted center
        const adjustedCenter: [number, number] = [
          point.coordinates.longitude - longitudeOffset,
          point.coordinates.latitude
        ];
        
        // Fly to the adjusted position
        map.flyTo({
          center: adjustedCenter,
          zoom: Math.max(map.getZoom(), 10), // Ensure minimum zoom level
          duration: 1000
        });
      } catch (error) {
        // Fallback to original coordinates if bounds calculation fails
        map.flyTo({
          center: [point.coordinates.longitude, point.coordinates.latitude],
          zoom: Math.max(map.getZoom(), 10),
          duration: 1000
        });
      }
      
      // Also trigger the point click to show details
      handlePointClick(point);
    }
  }, [handlePointClick]);

  return (
    <div className="w-full h-full relative">
      <div 
        ref={mapContainerRef} 
        className="h-full w-full"
        style={{ 
          minHeight: '200px', // Reduced minimum height to respect panel constraints
          maxHeight: '100%' // Ensure it doesn't exceed container height
        }} 
      />
      
      {/* Projection Toggle Button */}
      <div className="absolute top-2 right-2 sm:top-4 sm:right-4 z-10">
        <Button
          onClick={toggleProjection}
          variant="secondary"
          size="sm"
          className="bg-background/80 backdrop-blur-sm border shadow-lg hover:bg-background/90 h-8 sm:h-9 px-2 sm:px-3"
          disabled={!mapLoaded}
        >
          {isGlobeView ? (
            <>
              <MapIcon className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
              <span className="hidden sm:inline">Flat View</span>
              <span className="sm:hidden">Flat</span>
            </>
          ) : (
            <>
              <Globe className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
              <span className="hidden sm:inline">Globe View</span>
              <span className="sm:hidden">Globe</span>
            </>
          )}
        </Button>
      </div>
      
      {/* Label Indicator Badge */}
      {labelConfigInfo && (
        <div className="absolute bottom-1 left-1 z-10">
          <div className="bg-background/90 backdrop-blur-sm border border-blue-500 shadow-lg rounded-lg px-2 sm:px-3 py-1 sm:py-2">
            <div className="flex items-center gap-1 sm:gap-2">
              <Eye className="h-3 w-3 sm:h-4 sm:w-4 text-blue-500 flex-shrink-0" />
              <div className="flex flex-col min-w-0">
                <span className="text-xs text-muted-foreground truncate">
                  <span className="hidden sm:inline">{labelConfigInfo.fieldName} ({labelConfigInfo.fieldType})</span>
                  <span className="sm:hidden">{labelConfigInfo.fieldName}</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Points Counter with Location List */}
      {processedPoints.length > 0 && (
        <div className="absolute top-2 left-2 sm:top-4 sm:left-4 z-10">
          <Popover>
            <PopoverTrigger asChild>
              <Button 
                variant="ghost" 
                className="bg-background/80 backdrop-blur-sm border shadow-lg hover:bg-background/90 px-2 sm:px-3 py-1 sm:py-2 h-auto"
              >
                <div className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm">
                  <MapPin className="h-3 w-3 sm:h-4 sm:w-4 text-primary flex-shrink-0" />
                  <span className="font-medium">{processedPoints.length}</span>
                  <span className="text-muted-foreground hidden sm:inline">location{processedPoints.length === 1 ? '' : 's'}</span>
                  <span className="text-muted-foreground sm:hidden">loc{processedPoints.length === 1 ? '' : 's'}</span>
                  {variableSplittingConfig?.enabled && (
                    <Badge variant="secondary" className="text-xs hidden sm:inline-flex">Split View</Badge>
                  )}
                  <ChevronDown className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                </div>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0" align="start">
              <div className="p-3 font-medium text-sm border-b">
                All Locations ({processedPoints.length})
              </div>
              <ScrollArea className="max-h-80 overflow-y-auto">
                <div className="p-2">
                  {processedPoints.map((point, index) => {
                    // Get result count for this location
                    const locationResultCount = resultsForMap.filter(r => 
                      point.documentIds.includes(r.asset_id)
                    ).length;
                    
                    return (
                      <button
                        key={point.id}
                        onClick={() => handleLocationClick(point)}
                        className="w-full text-left p-2 rounded-md hover:bg-muted/50 transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <MapPin className="h-3 w-3 text-primary flex-shrink-0" />
                              <span className="font-medium text-sm truncate">
                                {point.locationString}
                              </span>
                            </div>
                            <div className="flex items-center gap-4 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <FileText className="h-3 w-3" />
                                {point.documentIds.length} doc{point.documentIds.length === 1 ? '' : 's'}
                              </span>
                              {locationResultCount > 0 && (
                                <span className="flex items-center gap-1">
                                  <Tag className="h-3 w-3" />
                                  {locationResultCount} result{locationResultCount === 1 ? '' : 's'}
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground mt-1 font-mono">
                              {point.coordinates.latitude.toFixed(4)}, {point.coordinates.longitude.toFixed(4)}
                            </div>
                          </div>
                          {point.splitValue && (
                            <Badge variant="outline" className="text-xs flex-shrink-0">
                              {point.splitValue}
                            </Badge>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>
            </PopoverContent>
          </Popover>
        </div>
      )}

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/50">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      )}

      {/* Inline Side Panel */}
      {selectedPoint && (
        <InlineSidePanel
          point={selectedPoint}
          results={resultsForMap}
          schemas={schemas}
          onClose={handleClosePopup}
          onPointClick={onPointClick}
          assets={assets}
          selectedFieldsPerScheme={selectedFieldsPerScheme}
          onSelectedFieldsChange={onSelectedFieldsChange}
          onResultSelect={onResultSelect}
        />
      )}
    </div>
  );
};

export default AnnotationResultsMap;
