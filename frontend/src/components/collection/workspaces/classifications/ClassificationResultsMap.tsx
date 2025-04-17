// frontend/src/components/collection/workspaces/classifications/LocationMap.tsx
'use client';

import React, { useRef, useEffect, useState } from 'react';
import mapboxgl, { Map as MapboxMap, LngLatLike, Popup } from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useTheme } from 'next-themes';
import { DocumentRead } from '@/client'; // Import DocumentRead if needed for popups
import { ClassificationResultRead, ClassificationSchemeRead } from '@/client'; // Import DocumentRead if needed for popups
import { FormattedClassificationResult } from '@/lib/classification/types';
import { ClassificationService } from '@/lib/classification/service';
import DocumentLink from '../documents/DocumentLink'; // Assuming DocumentLink can be rendered to string or we adapt

// Define the structure for points passed to the map
export interface MapPoint {
  id: string; // Unique ID (e.g., the location string itself)
  locationString: string;
  coordinates: { latitude: number; longitude: number };
  documentIds: number[]; // IDs of documents associated with this location in the current view
  // Optional extra info from geocoding
  bbox?: [number, number, number, number];
  type?: string;
}

interface LocationMapProps {
  points: MapPoint[];
  documents: DocumentRead[]; // Pass all relevant documents for popup context
  results: FormattedClassificationResult[];
  schemes: ClassificationSchemeRead[];
  onPointClick?: (point: MapPoint) => void; // Optional click handler
  /**
   * Configuration for text label display instead of points
   */
  labelConfig?: {
    schemeId: number;
    fieldKey: string;
    /** Optional: Field to use for label coloring */
    colorField?: string;
  };
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

// --- Helper to format value (similar to ClassificationResultsChart) ---
// You might want to move this to a shared utility if used elsewhere
const getFormattedValueForPopup = (resultValue: any, scheme: ClassificationSchemeRead): string => {
    if (!resultValue) return 'N/A';
    const field = scheme.fields[0];
    if (!field) return 'N/A';

    let fieldValue = resultValue;
    if (typeof resultValue === 'object' && resultValue !== null && !Array.isArray(resultValue)) {
        fieldValue = resultValue[field.name] ?? resultValue[scheme.name] ?? Object.values(resultValue)[0] ?? resultValue;
    }

    // Simple formatting, adapt ClassificationService.getFormattedValue if needed
    switch (field.type) {
        case 'int':
            const num = Number(fieldValue);
            if (!isNaN(num)) {
                if ((field.scale_min === 0) && (field.scale_max === 1)) {
                    return num > 0.5 ? 'True' : 'False';
                }
                return String(Number(num.toFixed(2)));
            }
            return String(fieldValue);
        case 'List[str]':
            return Array.isArray(fieldValue) ? fieldValue.join(', ') : String(fieldValue);
        case 'List[Dict[str, any]]':
             // Use compact entity formatting for popups
            const formatted = ClassificationService.formatEntityStatements(fieldValue, { compact: true, maxItems: 2 });
            if (Array.isArray(formatted)) return formatted.join('; ');
            return String(formatted);
        default:
            return String(fieldValue);
    }
};

// --- NEW HELPER: Get specific field value for labels ---
const getLabelValue = (resultValue: any, scheme: ClassificationSchemeRead | undefined, fieldKey: string): string => {
    if (!resultValue || !scheme || !fieldKey) return 'N/A';

    const fieldDefinition = scheme.fields.find(f => f.name === fieldKey);
    let actualValue: any;

    // Extract value based on fieldKey
    if (typeof resultValue === 'object' && resultValue !== null && !Array.isArray(resultValue)) {
        // If result.value is an object, try accessing by fieldKey
        actualValue = resultValue[fieldKey];
    } else {
        // If result.value is a simple type (or array, though less common for single labels)
        // and the fieldKey matches the *first* field's name (common for simple schemes), use it
        if (fieldKey === scheme.fields[0]?.name) {
           actualValue = resultValue;
        } else {
            // Cannot reliably extract specific field if value isn't an object with that key
            actualValue = 'N/A';
        }
    }

    if (actualValue === null || actualValue === undefined) return 'N/A';

    // Basic formatting (can enhance later)
    if (typeof actualValue === 'object') {
        // Use compact entity formatting if it's an array of dicts, otherwise stringify
        if (fieldDefinition?.type === 'List[Dict[str, any]]' && Array.isArray(actualValue)) {
            const formatted = ClassificationService.formatEntityStatements(actualValue, { compact: true, maxItems: 1 });
            // Ensure the result is a string
            return Array.isArray(formatted) ? formatted.join('; ') : String(formatted);
        }
        // Special handling for List[str] is in the next condition
        if (Array.isArray(actualValue)) {
            // If it's a plain array (usually strings), join with commas
            return actualValue.map(v => String(v)).join(', ');
        }
        return ClassificationService.safeStringify(actualValue); // Use safe stringify for general objects
    }

    return String(actualValue); // Ensure result is always a string
};

// --- Helper function to get nested values (Ensure this exists) ---
const getNestedValue = (obj: any, path: string): any => {
    // Handle cases where obj might not be an object or path is invalid
    if (typeof obj !== 'object' || obj === null || !path) {
        return null;
    }
    return path.split('.').reduce((acc, part) =>
        acc && typeof acc === 'object' && acc[part] !== undefined ? acc[part] : null, // Added type check for acc
        obj
    );
};

const LocationMap: React.FC<LocationMapProps> = ({ points, documents, results, schemes, onPointClick, labelConfig }) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const { theme } = useTheme();
  const [labelData, setLabelData] = useState<GeoJSON.FeatureCollection>({ type: 'FeatureCollection', features: [] });

  // Use the same ID as the old implementation for consistency
  const pointsSourceId = 'geocoded-locations';
  const pointsLayerId = 'unclustered-point';
  const labelSourceId = 'label-source';
  const labelLayerId = 'label-layer';

  const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || 'pk.eyJ1IjoiamltdnciLCJhIjoiY20xd2U3Z2pqMGprdDJqczV2OXJtMTBoayJ9.hlSx0Nc19j_Z1NRgyX7HHg';

  // --- Initialize Map ---
  useEffect(() => {
    if (mapRef.current || !mapContainerRef.current) return;

    console.log("Initializing map...");
    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: theme === 'dark' ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/light-v11',
      center: [13.2, 52.52], // Center of Berlin
      zoom: 0,
      attributionControl: false,
      projection: { name: 'mercator' }
    });

    mapRef.current = map;

    // Initialize popup
    popupRef.current = new mapboxgl.Popup({
      closeButton: false,
      closeOnClick: false,
      maxWidth: '400px',
      className: 'force-black-text-popup'
    });

    // --- Inject CSS to style the popup content ---
    // Create a style element if it doesn't exist
    const styleId = 'mapbox-popup-style-override';
    let styleElement = document.getElementById(styleId);
    if (!styleElement) {
        styleElement = document.createElement('style');
        styleElement.id = styleId;
        document.head.appendChild(styleElement);
    }
    // Add the rule to force black text within our custom popup class
    // Using !important might still be necessary if Mapbox styles are strong
    styleElement.innerHTML = `
      .mapboxgl-popup.force-black-text-popup .mapboxgl-popup-content {
        color: black !important;
      }
      .mapboxgl-popup.force-black-text-popup .mapboxgl-popup-content * {
        color: black !important; /* Force on all child elements too */
      }
    `;
    // --- End of CSS injection ---

    map.on('load', () => {
      console.log("Map loaded");
      setMapLoaded(true);

      // ----- POINTS SOURCE AND LAYER SETUP -----
      console.log("Adding points source and layer...");
      
      // Add Source (initially empty)
      map.addSource(pointsSourceId, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
      console.log(`Added source '${pointsSourceId}'`);

      // Add Unclustered Point Layer
      map.addLayer({
        id: pointsLayerId,
        type: 'circle',
        source: pointsSourceId,
        paint: {
          'circle-color': theme === 'dark' ? '#4dabf7' : '#228be6',
          'circle-radius': 6,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': theme === 'dark' ? '#1864ab' : '#1971c2'
        },
        layout: {
          'visibility': 'visible' // EXPLICITLY set to visible
        }
      });
      console.log(`Added points layer '${pointsLayerId}'`);

      // ----- POINT INTERACTIONS -----
      // Hover effect
      map.on('mouseenter', pointsLayerId, (e) => {
        map.getCanvas().style.cursor = 'pointer';

        if (!e.features || e.features.length === 0 || !popupRef.current) return;
        const feature = e.features[0];

        if (feature.geometry.type === 'Point' && feature.properties) {
          const coordinates = feature.geometry.coordinates.slice() as [number, number];
          const locationString = feature.properties.locationString || 'Location';
          const docCount = feature.properties.docCount || 0;
          const docIds: number[] = feature.properties.documentIds ?
            JSON.parse(feature.properties.documentIds) : [];

          // Create popup HTML - REMOVE previous inline styles
          let popupHtml = `<div>`; // No style needed here now
          popupHtml += `<strong>${locationString}</strong>`;
          popupHtml += `<br/><span>${docCount} document${docCount !== 1 ? 's' : ''}</span>`;

          // Add document previews with first classification result
          const docsToShow = docIds
            .map(id => documents.find(d => d.id === id))
            .filter((doc): doc is DocumentRead => !!doc) // Type guard
            .slice(0, 4); 

          if (docsToShow.length > 0) {
            popupHtml += `<hr style="margin: 4px 0;"/>`; // Simple separator
            docsToShow.forEach(doc => {
              popupHtml += `<div>`;
              popupHtml += `<em>${doc.title || `Doc #${doc.id}`}</em>`;

              // Find the first classification result for this document
              const firstResult = results.find(r => r.document_id === doc.id);
              if (firstResult) {
                const scheme = schemes.find(s => s.id === firstResult.scheme_id);
                if (scheme) {
                  const formattedValue = getFormattedValueForPopup(firstResult.value, scheme);
                  popupHtml += `<br/><small>${scheme.name}: ${formattedValue}</small>`;
                }
              }
              popupHtml += `</div>`;
            });

            if (docIds.length > docsToShow.length) {
              popupHtml += `<div style="font-style: italic; font-size: 0.9em; margin-top: 4px;">...and ${docIds.length - docsToShow.length} more</div>`; // Keep structural styles
            }
          }

          popupHtml += `</div>`;

          // Normalize coordinates
          while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
            coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360;
          }

          // Set and show popup
          popupRef.current
            .setLngLat(coordinates)
            .setHTML(popupHtml)
            .addTo(map);
        }
      });

      // Remove popup on mouse leave
      map.on('mouseleave', pointsLayerId, () => {
        map.getCanvas().style.cursor = '';
        popupRef.current?.remove();
      });

      // Handle clicks for point selection
      if (onPointClick) {
        map.on('click', pointsLayerId, (e) => {
          if (!e.features || e.features.length === 0) return;

          const feature = e.features[0];
          if (feature.geometry.type === 'Point' && feature.properties) {
            const pointData: MapPoint = {
              id: feature.properties.id || '', // id is locationString here
              locationString: feature.properties.locationString || '',
              coordinates: {
                longitude: feature.geometry.coordinates[0],
                latitude: feature.geometry.coordinates[1]
              },
              documentIds: feature.properties.documentIds ?
                JSON.parse(feature.properties.documentIds) : []
            };

            console.log('Map point clicked, calling onPointClick with:', pointData); // Log data being passed
            onPointClick(pointData);
          }
        });
      }

      // ----- LABEL SOURCE -----
      map.addSource(labelSourceId, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
      console.log(`Added label source '${labelSourceId}'`);
    });

    map.addControl(new mapboxgl.NavigationControl(), 'top-right');
    
    return () => {
      console.log("Cleaning up map");
      // Clean up the injected style element
      const styleElementToRemove = document.getElementById(styleId);
      if (styleElementToRemove) {
          styleElementToRemove.remove();
      }
      mapRef.current?.remove();
      mapRef.current = null;
      popupRef.current = null;
      setMapLoaded(false);
    };
  }, [theme, MAPBOX_TOKEN]);

  // ----- UPDATE POINTS DATA -----
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    
    const map = mapRef.current;
    const source = map.getSource(pointsSourceId) as mapboxgl.GeoJSONSource;
    
    if (!source) {
      console.warn(`[Points Update Effect] Source '${pointsSourceId}' not found, skipping update.`);
      return; // Source might not be ready yet
    }
    
    // Create GeoJSON data from points
    const geoJsonFeatures: GeoJSON.Feature[] = points
      .filter(point => 
        point.coordinates &&
        typeof point.coordinates.latitude === 'number' && !isNaN(point.coordinates.latitude) &&
        typeof point.coordinates.longitude === 'number' && !isNaN(point.coordinates.longitude)
      )
      .map(point => ({
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [point.coordinates.longitude, point.coordinates.latitude]
        },
        properties: {
          id: point.id,
          locationString: point.locationString,
          docCount: point.documentIds.length,
          documentIds: JSON.stringify(point.documentIds)
        }
      }));
    
    console.log(`[Points Update Effect] Updating source '${pointsSourceId}' with ${geoJsonFeatures.length} features`);
    
    // Update the source data
    source.setData({
      type: 'FeatureCollection',
      features: geoJsonFeatures
    });
    
    // Ensure points layer remains visible
    if (map.getLayer(pointsLayerId)) {
        map.setLayoutProperty(pointsLayerId, 'visibility', 'visible');
    }
  }, [points, mapLoaded]);

  // --- Process label data based on config ---
  useEffect(() => {
    // --- ADDED GUARD ---
    // Exit early if labelConfig is not provided, or if the schemeId within it
    // isn't found in the currently available schemes for the run.
    if (!labelConfig || !schemes.some(s => s.id === labelConfig.schemeId)) {
      // If label data isn't already empty, clear it.
      if (labelData.features.length > 0) {
         setLabelData({ type: 'FeatureCollection', features: [] });
      }
      return;
    }
    // --- END GUARD ---

    // Skip if points or schemes aren't ready
    if (!schemes.length || !points.length) {
      return;
    }

    // Map schemes to a lookup object for faster access inside the loop
    const schemeLookup = new Map(schemes.map(s => [s.id, s]));

    const features: (LabelGeoJsonFeature | null)[] = points.map(point => {
      const docId = point.documentIds[0];
      if (!docId) return null;

      const result: FormattedClassificationResult | undefined = results.find(r =>
        r.document_id === docId &&
        r.scheme_id === labelConfig.schemeId
      );
      const scheme: ClassificationSchemeRead | undefined = schemeLookup.get(labelConfig.schemeId);

      if (!result || !scheme) {
          return null; // Skip this point if data is missing for the label config
      }

      const labelTextValue = getLabelValue(result.value, scheme, labelConfig.fieldKey);

      let labelColor = theme === 'dark' ? '#FFFFFF' : '#000000';
      if (labelConfig.colorField) {
          const colorValueRaw = getNestedValue(result.value, labelConfig.colorField);
          if (typeof colorValueRaw === 'string' && (colorValueRaw.startsWith('#') || colorValueRaw.startsWith('rgb'))) {
             labelColor = colorValueRaw;
          }
      }

      return {
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [point.coordinates.longitude, point.coordinates.latitude]
        },
        properties: {
          labelText: (labelTextValue ?? 'N/A').substring(0, 50),
          color: labelColor
        }
      } as LabelGeoJsonFeature;
    });

    const validFeatures = features.filter((feature): feature is LabelGeoJsonFeature => feature !== null);

    if (JSON.stringify(validFeatures) !== JSON.stringify(labelData.features)) {
       setLabelData({ type: 'FeatureCollection', features: validFeatures } as GeoJSON.FeatureCollection);
    }
  }, [points, results, schemes, labelConfig, theme, labelData.features]);

  // --- Add/Update label SOURCE DATA and LAYER VISIBILITY/DEFINITION ---
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    
    const map = mapRef.current;
    
    // Wait for style to be fully loaded before manipulating layers/sources
    if (!map.isStyleLoaded()) {
      map.once('styledata', () => {
        // Re-trigger this effect once style is loaded
        // A simple way is to update a dummy state, but 
        // Mapbox usually handles this if sources/layers were defined correctly initially.
        // For simplicity, we'll rely on the next render cycle.
        console.log('[Label Layer Effect] Style loaded, effect will re-run.');
      });
      return; 
    }

    try {
      const labelSource = map.getSource(labelSourceId) as mapboxgl.GeoJSONSource | undefined;
      const labelLayer = map.getLayer(labelLayerId);
      const shouldLabelsBeVisible = labelData.features.length > 0;

      // Update label source data
      if (labelSource) {
        console.log(`[Label Layer Effect] Updating label source data. Features: ${labelData.features.length}`);
        labelSource.setData(labelData);
      } else {
        console.warn(`[Label Layer Effect] Label source '${labelSourceId}' not found.`);
        // Attempt to re-add if missing (might happen after style change)
        if (mapLoaded && !map.getSource(labelSourceId)) {
          map.addSource(labelSourceId, { type: 'geojson', data: labelData });
          console.log('[Label Layer Effect] Re-added label source');
        }
      }

      // Add or remove label layer based on visibility
      if (shouldLabelsBeVisible && !labelLayer) {
        console.log(`[Label Layer Effect] Adding label layer '${labelLayerId}'`);
        map.addLayer({
          id: labelLayerId,
          type: 'symbol',
          source: labelSourceId,
          layout: {
            'text-field': ['get', 'labelText'],
            'text-size': 12,
            'text-variable-anchor': ['top', 'bottom'],
            'text-anchor': 'top',
            'text-offset': [0, 1.5],
            'text-justify': 'auto',
            'text-allow-overlap': false,
            'text-ignore-placement': false
          },
          paint: {
            'text-color': ['get', 'color'],
            'text-halo-color': theme === 'dark' ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.8)',
            'text-halo-width': 1
          }
        });
      } else if (!shouldLabelsBeVisible && labelLayer) {
        console.log(`[Label Layer Effect] Removing label layer '${labelLayerId}'`);
        map.removeLayer(labelLayerId);
      } else if (shouldLabelsBeVisible && labelLayer) {
        // Ensure layer is visible if it should be (might have been hidden)
        const currentVisibility = map.getLayoutProperty(labelLayerId, 'visibility');
        if (currentVisibility !== 'visible') {
           console.log(`[Label Layer Effect] Setting label layer to visible`);
           map.setLayoutProperty(labelLayerId, 'visibility', 'visible');
        }
        // Update paint properties if theme changed
        map.setPaintProperty(labelLayerId, 'text-color', ['get', 'color']);
        map.setPaintProperty(labelLayerId, 'text-halo-color', theme === 'dark' ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.8)');
      }

    } catch (error) {
      console.error('[Label Layer Effect] Error:', error);
    }
  }, [mapLoaded, labelData, theme]);

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
                console.log(`Theme changed to ${theme}. Updating map style to ${targetStyleUrl}`);
                map.setStyle(targetStyleUrl);
                // Wait for the new style to load before potentially letting other effects run
                map.once('style.load', () => {
                    console.log('New map style finished loading.');
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
                console.log('Initial style loaded, checking theme style applicability.');
                updateStyleIfNeeded();
            });
        }
     }
     // Keep dependencies minimal, related only to theme and map readiness.
  }, [theme, mapLoaded]);

  return <div ref={mapContainerRef} style={{ width: '100%', height: '100%', minHeight: '500px', borderRadius: '8px' }} />;
};

export default LocationMap;
