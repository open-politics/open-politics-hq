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
  // Refs for delayed layer addition logic
  const prevShouldLabelsBeVisible = useRef<boolean | null>(null);
  const layerAddTimer = useRef<NodeJS.Timeout | null>(null);

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

  // --- COMBINED: Calculate Label Data and Manage Map Layer/Source --- (MODIFIED)
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) {
      return; // Map not ready
    }
    const map = mapRef.current;

    console.log(`[Label Layer/Source Effect] Running. Config:`, labelConfig);

    // --- Feature Calculation Logic --- (as before)
    let featuresForMap: LabelGeoJsonFeature[] = [];
    if (labelConfig && schemes.some(s => s.id === labelConfig.schemeId) && schemes.length > 0 && points.length > 0 && results.length > 0) {
      console.log(`[Label Layer/Source Effect] Calculating features...`);
      const schemeLookup = new Map(schemes.map(s => [s.id, s]));
      // Directly calculate features based on current props
      const calculatedFeatures: (LabelGeoJsonFeature | null)[] = points.map(point => {
          const docId = point.documentIds[0];
          if (!docId) return null;
          // Find the result matching the document and the specific labelConfig scheme
          const result: FormattedClassificationResult | undefined = results.find(r =>
            r.document_id === docId && r.scheme_id === labelConfig.schemeId
          );
          const scheme: ClassificationSchemeRead | undefined = schemeLookup.get(labelConfig.schemeId);
          // Ensure we found both result and scheme, and the scheme has fields
          if (!result || !scheme || !scheme.fields || scheme.fields.length === 0) return null;

          // Use the getLabelValue helper function
          const labelTextValue = getLabelValue(result.value, scheme, labelConfig.fieldKey);

          // Determine color
          let labelColor = theme === 'dark' ? '#FFFFFF' : '#000000';
          if (labelConfig.colorField) {
              const colorValueRaw = getNestedValue(result.value, labelConfig.colorField);
              // Basic validation for color string
              if (typeof colorValueRaw === 'string' && (colorValueRaw.startsWith('#') || colorValueRaw.startsWith('rgb'))) {
                 labelColor = colorValueRaw;
              }
          }

          // Return the feature object if label text is valid
          return {
              type: 'Feature' as const,
              geometry: {
                type: 'Point' as const,
                coordinates: [point.coordinates.longitude, point.coordinates.latitude]
              },
              properties: {
                labelText: (labelTextValue ?? 'N/A').substring(0, 50), // Ensure labelText is string
                color: labelColor
              }
          } as LabelGeoJsonFeature;
      });
      // Filter out any nulls that occurred during mapping
      featuresForMap = calculatedFeatures.filter((feature): feature is LabelGeoJsonFeature => feature !== null);
      console.log(`[Label Layer/Source Effect] Calculation complete. Features found: ${featuresForMap.length}`);
    } else {
       console.log(`[Label Layer/Source Effect] Conditions not met for feature calculation.`);
    }

    // --- Map Layer & Source Management Logic --- (Using calculated featuresForMap)
    const geoJsonData: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: featuresForMap };
    const shouldLabelsBeVisible = featuresForMap.length > 0;
    console.log(`[Label Layer/Source Effect] shouldLabelsBeVisible = ${shouldLabelsBeVisible}`);

    // Clear any pending layer add timer at the start of each run
    if (layerAddTimer.current) {
      console.log("[Label Layer/Source Effect] Clearing pending layer add timer.");
      clearTimeout(layerAddTimer.current);
      layerAddTimer.current = null;
    }

    try {
      const labelSource = map.getSource(labelSourceId) as mapboxgl.GeoJSONSource | undefined;
      const labelLayer = map.getLayer(labelLayerId);

      // 1. Update Source Data or Add Source if Needed
      if (labelSource) {
        console.log(`[Label Layer/Source Effect] Updating source '${labelSourceId}' with ${featuresForMap.length} features.`);
        labelSource.setData(geoJsonData);
      } else if (shouldLabelsBeVisible) {
        console.warn(`[Label Layer/Source Effect] Label source '${labelSourceId}' not found. Adding source.`);
        map.addSource(labelSourceId, { type: 'geojson', data: geoJsonData });
      }

      // 2. Manage Layer Existence with Delay Logic
      if (shouldLabelsBeVisible) {
        // We need the layer visible
        if (!labelLayer) {
          // Layer doesn't exist -> Add it
          if (map.getSource(labelSourceId)) {
             // Check if transitioning from hidden to visible
             if (prevShouldLabelsBeVisible.current === false) {
                 console.log(`[Label Layer/Source Effect] Transitioning to visible. Delaying layer add...`);
                 layerAddTimer.current = setTimeout(() => {
                     console.log(`[Label Layer/Source Effect] Executing delayed layer add...`);
                     // Check again if layer exists *inside* the timeout
                     if (map.getLayer && !map.getLayer(labelLayerId)) { // Add getLayer check
                        map.addLayer({
                           id: labelLayerId,
                           type: 'symbol',
                           source: labelSourceId,
                           layout: { 'text-field': ['get', 'labelText'],'text-size': 12,'text-variable-anchor': ['top', 'bottom'],'text-anchor': 'top','text-offset': [0, 1.5],'text-justify': 'auto','text-allow-overlap': false,'text-ignore-placement': false },
                           paint: { 'text-color': ['get', 'color'],'text-halo-color': theme === 'dark' ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.8)','text-halo-width': 1 }
                       });
                       console.log(`[Label Layer/Source Effect] Delayed add complete.`);
                     } else {
                         console.log(`[Label Layer/Source Effect] Delayed add skipped, layer check failed or layer already exists.`);
                     }
                     layerAddTimer.current = null; // Clear timer ref after execution
                 }, 50); // 50ms delay
             } else {
                 // Not a transition (or first run), add immediately if source ready
                 if (map.addLayer) { // Check if function exists
                    map.addLayer({
                       id: labelLayerId,
                       type: 'symbol',
                       source: labelSourceId,
                       layout: { 'text-field': ['get', 'labelText'],'text-size': 12,'text-variable-anchor': ['top', 'bottom'],'text-anchor': 'top','text-offset': [0, 1.5],'text-justify': 'auto','text-allow-overlap': false,'text-ignore-placement': false },
                       paint: { 'text-color': ['get', 'color'],'text-halo-color': theme === 'dark' ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.8)','text-halo-width': 1 }
                    });
                    console.log(`[Label Layer/Source Effect] Immediate add complete.`);
                 }
             }
          } else {
            console.warn(`[Label Layer/Source Effect] Wanted to add layer, but source '${labelSourceId}' missing.`);
          }
        } else {
          // Layer exists -> Update paint properties and ensure visibility
          // Check methods exist before calling
          if (map.setPaintProperty && map.getLayoutProperty) {
            map.setPaintProperty(labelLayerId, 'text-color', ['get', 'color']);
            map.setPaintProperty(labelLayerId, 'text-halo-color', theme === 'dark' ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.8)');
            try {
                const currentVisibility = map.getLayoutProperty(labelLayerId, 'visibility');
                if (currentVisibility !== 'visible') {
                    console.log(`[Label Layer/Source Effect] Setting layer '${labelLayerId}' to visible.`);
                    map.setLayoutProperty(labelLayerId, 'visibility', 'visible');
                }
            } catch (e) {
                 console.warn(`[Label Layer/Source Effect] Error checking/setting visibility for layer ${labelLayerId}:`, e);
            }
          }
        }
      } else { // shouldLabelsBeVisible is false
        // We need the layer hidden/removed
        if (labelLayer && map.removeLayer) { // Check function exists
          console.log(`[Label Layer/Source Effect] Trying to remove label layer '${labelLayerId}'...`);
          try {
            map.removeLayer(labelLayerId);
            console.log(`[Label Layer/Source Effect] Removed label layer '${labelLayerId}'.`);
          } catch (e) {
             console.warn(`[Label Layer/Source Effect] Error removing layer ${labelLayerId}:`, e);
          }
        }
      }
    } catch (error) {
      console.error('[Label Layer/Source Effect] Outer Error:', error);
      // Attempt to clean up layer if error occurred during management
      if (map.getLayer && map.getLayer(labelLayerId) && map.removeLayer) {
          try { map.removeLayer(labelLayerId); } catch (e) { /* ignore */ }
      }
    }

    // Update previous state ref *after* logic runs for the next cycle
    prevShouldLabelsBeVisible.current = shouldLabelsBeVisible;

  }, [mapLoaded, labelConfig, points, results, schemes, theme]);

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
