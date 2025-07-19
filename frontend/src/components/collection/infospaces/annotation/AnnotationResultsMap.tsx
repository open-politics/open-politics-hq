// frontend/src/components/collection/infospaces/annotation/AnnotationResultsMap.tsx
'use client';

import React, { useRef, useEffect, useState, useCallback, useMemo, startTransition } from 'react';
import mapboxgl, { Map as MapboxMap, LngLatLike, Popup, Marker, LngLatBounds } from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useTheme } from 'next-themes';
import { AnnotationSchemaRead, AssetRead } from '@/client/models';
import { FormattedAnnotation, TimeAxisConfig } from '@/lib/annotations/types';
import { formatDisplayValue, getAnnotationFieldValue, getTargetKeysForScheme } from '@/lib/annotations/utils';
import { debounce } from 'lodash';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Globe, Map as MapIcon, MapPin, FileText, Calendar, Tag, X, ExternalLink } from 'lucide-react';
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
  onSelectedFieldsChange: externalOnSelectedFieldsChange
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

  // NEW: Field selection handler - ALLOW ZERO FIELDS TO HIDE SCHEMAS
  const handleFieldToggle = (schemaId: number, fieldKey: string) => {
    setSelectedFieldsPerScheme(prev => {
      const currentSelected = prev[schemaId] || [];
      const isSelected = currentSelected.includes(fieldKey);
      const newSelected = isSelected 
        ? currentSelected.filter(key => key !== fieldKey) 
        : [...currentSelected, fieldKey];
      
      // FIXED: Allow zero fields (this hides the schema)
      const updatedSelection = { ...prev, [schemaId]: newSelected };
      
      // Notify parent immediately without setTimeout to prevent blinking
      if (externalOnSelectedFieldsChange) {
        externalOnSelectedFieldsChange(updatedSelection);
      }
      
      return updatedSelection;
    });
  };

  return (
    <div className="absolute top-0 right-0 w-1/2 h-full bg-background/25 backdrop-blur border-l border-border z-10 flex flex-col">
      <div className="flex-shrink-0 border-b border-border p-3">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <MapPin className="h-4 w-4 text-primary flex-shrink-0" />
              <h3 className="font-medium text-sm truncate">{point.locationString}</h3>
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <FileText className="h-3 w-3" />
              <span>{point.documentIds.length} document{point.documentIds.length === 1 ? '' : 's'}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
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
      
      <div className="flex-1 overflow-auto p-3">
        {assetGroups.size > 0 ? (
          <div className="space-y-3">
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
}

const AssetCard: React.FC<AssetCardProps> = ({ 
  assetGroup, 
  selectedFieldsPerScheme, 
  onPointClick, 
  point,
  compact = false,
  allAssets = []
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

  // Handle point click with fixed popup
  const handlePointClick = useCallback((point: MapPoint) => {
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

  // Memoize label data to prevent unnecessary re-renders
  const labelData = useMemo(() => {
    if (processedPoints.length === 0) {
      return null;
    }

    const schemeLookup = new Map(schemas.map(s => [s.id, s]));
    
    const featuresForMap: LabelGeoJsonFeature[] = processedPoints.map(point => {
      const assetId = point.documentIds[0];
      if (!assetId) return null;

      // Always show location as the primary label
      let labelText = point.locationString;

      // If labelConfig is provided, add the field value underneath
      if (labelConfig && schemas.some(s => s.id === labelConfig.schemaId) && resultsForMap.length > 0) {
        const result = resultsForMap.find(r =>
          r.asset_id === assetId && r.schema_id === labelConfig.schemaId
        );
        const schema = schemeLookup.get(labelConfig.schemaId);

        if (result && schema) {
          const fieldValue = getLabelValue(result.value, schema, labelConfig.fieldKey);
          if (fieldValue && fieldValue !== 'N/A') {
            // Add the field value on a new line, truncated to prevent overly long labels
            const truncatedFieldValue = String(fieldValue).substring(0, 30);
            labelText = `${labelText}\n${truncatedFieldValue}`;
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
      <div className="absolute top-4 right-4 z-10">
        <Button
          onClick={toggleProjection}
          variant="secondary"
          size="sm"
          className="bg-background/80 backdrop-blur-sm border shadow-lg hover:bg-background/90"
          disabled={!mapLoaded}
        >
          {isGlobeView ? (
            <>
              <MapIcon className="h-4 w-4 mr-2" />
              Flat View
            </>
          ) : (
            <>
              <Globe className="h-4 w-4 mr-2" />
              Globe View
            </>
          )}
        </Button>
      </div>
      
            {/* Points Counter */}
      {processedPoints.length > 0 && (
        <div className="absolute top-4 left-4 z-10">
          <div className="bg-background/80 backdrop-blur-sm border shadow-lg rounded-lg px-3 py-2">
            <div className="flex items-center gap-2 text-sm">
              <MapPin className="h-4 w-4 text-primary" />
              <span className="font-medium">{processedPoints.length}</span>
              <span className="text-muted-foreground">location{processedPoints.length === 1 ? '' : 's'}</span>
              {variableSplittingConfig?.enabled && (
                <Badge variant="secondary" className="text-xs">Split View</Badge>
              )}
            </div>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/50">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      )}

      {/* Inline Side Panel */}
      <InlineSidePanel
        point={selectedPoint}
        results={resultsForMap}
        schemas={schemas}
        onClose={handleClosePopup}
        onPointClick={onPointClick}
        assets={assets}
        selectedFieldsPerScheme={selectedFieldsPerScheme}
        onSelectedFieldsChange={onSelectedFieldsChange}
      />
    </div>
  );
};

export default AnnotationResultsMap;
