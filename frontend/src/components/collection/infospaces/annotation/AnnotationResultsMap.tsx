// frontend/src/components/collection/infospaces/annotation/AnnotationResultsMap.tsx
'use client';

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import mapboxgl, { Map as MapboxMap, LngLatLike, Popup, Marker, LngLatBounds } from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useTheme } from 'next-themes';
import { AnnotationSchemaRead } from '@/client/models';
import { FormattedAnnotation } from '@/lib/annotations/types';
import { formatDisplayValue, getAnnotationFieldValue } from '@/lib/annotations/utils';
import { debounce } from 'lodash';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2 } from 'lucide-react';

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
}

interface AnnotationResultsMapProps {
  points: MapPoint[];
  results: FormattedAnnotation[];
  schemas: AnnotationSchemaRead[];
  labelConfig?: {
    schemaId: number;
    fieldKey: string;
  };
  onPointClick?: (point: MapPoint) => void;
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

// Helper to format value for display
const getFormattedValueForPopup = (resultValue: any, schema: AnnotationSchemaRead): string => {
    const display = formatDisplayValue(resultValue, schema);
    if (typeof display === 'object' && display !== null) {
        return JSON.stringify(display);
    }
    return String(display ?? 'N/A');
};

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



const AnnotationResultsMap: React.FC<AnnotationResultsMapProps> = ({
  points,
  results,
  schemas,
  labelConfig,
  onPointClick
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const [selectedPoint, setSelectedPoint] = useState<MapPoint | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const { theme } = useTheme();
  // Refs for delayed layer addition logic
  const prevShouldLabelsBeVisible = useRef<boolean | null>(null);
  const layerAddTimer = useRef<NodeJS.Timeout | null>(null);

  // Use the same ID as the old implementation for consistency
  const pointsSourceId = 'geocoded-locations';
  const pointsLayerId = 'unclustered-point';
  const labelSourceId = 'label-source';
  const labelLayerId = 'label-layer';

  const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || 'pk.eyJ1IjoiamltdnciLCJhIjoiY20xd2U3Z2pqMGprdDJqczV2OXJtMTBoayJ9.hlSx0Nc19j_Z1NRgyX7HHg';

  useEffect(() => {
    if (!mapContainerRef.current) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: theme === 'dark' ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/light-v11',
      center: [-98.5795, 39.8283], // Center of the US
      zoom: 3
    });

    map.on('load', () => {
      setMapLoaded(true);
    });

    mapRef.current = map;

    return () => {
      // Clean up markers when map is removed
      markersRef.current.forEach(marker => marker.remove());
      markersRef.current = [];
      map.remove();
    };
  }, [theme, MAPBOX_TOKEN]);

  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;

    const map = mapRef.current;
    
    // Clean up existing markers
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];

    const bounds = new mapboxgl.LngLatBounds();

    // Add markers for each point
    points.forEach(point => {
      const { longitude, latitude } = point.coordinates;
      bounds.extend([longitude, latitude]);

      const marker = new mapboxgl.Marker()
        .setLngLat([longitude, latitude])
        .addTo(map);

      // Store reference to marker for cleanup
      markersRef.current.push(marker);

      marker.getElement().addEventListener('click', () => {
        if (onPointClick) {
          onPointClick(point);
        }
      });
    });

    // Fit map to bounds
    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, {
        padding: 50,
        maxZoom: 15
      });
    }
  }, [points, mapLoaded, onPointClick]);

  // Calculate and display labels if configured
  useEffect(() => {
    if (!mapLoaded || !mapRef.current || !labelConfig) return;

    const map = mapRef.current;
    let featuresForMap: LabelGeoJsonFeature[] = [];

    if (schemas.some(s => s.id === labelConfig.schemaId) && points.length > 0 && results.length > 0) {
      const schemeLookup = new Map(schemas.map(s => [s.id, s]));
      
      featuresForMap = points.map(point => {
        const assetId = point.documentIds[0];
        if (!assetId) return null;

        const result = results.find(r =>
          r.asset_id === assetId && r.schema_id === labelConfig.schemaId
        );
        const schema = schemeLookup.get(labelConfig.schemaId);

        if (!result || !schema) return null;

        const labelTextValue = getLabelValue(result.value, schema, labelConfig.fieldKey);
        const labelColor = theme === 'dark' ? '#FFFFFF' : '#000000';

        return {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [point.coordinates.longitude, point.coordinates.latitude]
          },
          properties: {
            labelText: String(labelTextValue).substring(0, 50),
            color: labelColor
          }
        } as LabelGeoJsonFeature;
      }).filter((feature): feature is LabelGeoJsonFeature => feature !== null);
    }

    // Update or add the label source and layer
    const sourceId = 'label-source';
    const layerId = 'label-layer';

    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: featuresForMap
        }
      });
    } else {
      (map.getSource(sourceId) as mapboxgl.GeoJSONSource).setData({
        type: 'FeatureCollection',
        features: featuresForMap
      });
    }

    if (!map.getLayer(layerId)) {
      map.addLayer({
        id: layerId,
        type: 'symbol',
        source: sourceId,
        layout: {
          'text-field': ['get', 'labelText'],
          'text-size': 12,
          'text-anchor': 'top',
          'text-offset': [0, 1],
          'text-allow-overlap': false
        },
        paint: {
          'text-color': ['get', 'color'],
          'text-halo-color': theme === 'dark' ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.8)',
          'text-halo-width': 1
        }
      });
    }
  }, [mapLoaded, labelConfig, points, results, schemas, theme]);

  // Add cleanup for the timer when the component unmounts
  useEffect(() => {
    return () => {
      if (layerAddTimer.current) {
        clearTimeout(layerAddTimer.current);
      }
    };
  }, []); // Empty dependency array ensures this runs only on mount and unmount

  // --- Adjust map style based on theme ---
  useEffect(() => {
     if (mapRef.current && mapLoaded) {
        const map = mapRef.current;
        const targetStyleUrl = theme === 'dark' ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/light-v11';

        const updateStyleIfNeeded = () => {
            // Now it should be safe to get the style
            const styleObject = map.getStyle();
            const currentStyleUrl = styleObject?.sprite?.toString().split('/sprites')[0] ?? '';

            if (currentStyleUrl !== targetStyleUrl) {
                map.setStyle(targetStyleUrl);
                // Wait for the new style to load before potentially letting other effects run
                map.once('style.load', () => {
                    // No need to re-add sources/layers here.
                    // The existing useEffects for points and labels should handle updates
                    // because they depend on `theme` and/or `mapLoaded`.
                });
            }
        };

        // Ensure the map's style is loaded before attempting to get or set it
        if (map.isStyleLoaded()) {
            updateStyleIfNeeded();
        } else {
            // If the style isn't loaded yet (e.g., initial load), wait for it, then check if the theme style needs applying
            map.once('style.load', () => {
                updateStyleIfNeeded();
            });
        }
     }
     // Keep dependencies minimal, related only to theme and map readiness.
  }, [theme, mapLoaded]);

  return (
    <div className="w-full h-full relative">
      <div ref={mapContainerRef} className="w-full h-full" />
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/50">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      )}
    </div>
  );
};

export default AnnotationResultsMap;
