// frontend/src/components/collection/workspaces/classifications/LocationMap.tsx
'use client';

import React, { useRef, useEffect, useState } from 'react';
import mapboxgl from 'mapbox-gl';
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

const LocationMap: React.FC<LocationMapProps> = ({ points, documents, results, schemes, onPointClick }) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const popupRef = useRef<mapboxgl.Popup | null>(null); // Use ref for popup
  const [mapLoaded, setMapLoaded] = useState(false);
  const { theme } = useTheme();

  const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || 'pk.eyJ1IjoiamltdnciLCJhIjoiY20xd2U3Z2pqMGprdDJqczV2OXJtMTBoayJ9.hlSx0Nc19j_Z1NRgyX7HHg';

  // --- Initialize Map --- (Keep this useEffect largely the same)
  useEffect(() => {
    if (mapRef.current || !mapContainerRef.current) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: theme === 'dark' ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/light-v11',
      center: [0, 20],
      zoom: 1,
      projection: 'mercator'
    });

    mapRef.current = map;

    map.on('load', () => {
      setMapLoaded(true);
      console.log("Map loaded");

      // Initialize Popup here
      popupRef.current = new mapboxgl.Popup({
        closeButton: false,
        closeOnClick: false,
        maxWidth: '400px'
      });

      // --- ADD SOURCE, LAYERS, and EVENT LISTENERS ONCE --- 
      const sourceId = 'geocoded-locations';
      const clusterLayerId = 'clusters';
      const clusterCountLayerId = 'cluster-count';
      const unclusteredPointLayerId = 'unclustered-point';

      // Add Source (initially empty)
      map.addSource(sourceId, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] }, // Start empty
          cluster: true,
          clusterMaxZoom: 14,
          clusterRadius: 50
      });
      console.log("Map source added (initially empty)");

      // Add Cluster Layer
      map.addLayer({
          id: clusterLayerId,
          type: 'circle',
          source: sourceId,
          filter: ['has', 'point_count'],
          paint: {
              'circle-color': [
                  'step',
                  ['get', 'point_count'],
                  '#51bbd6', 10, '#f1f075', 100, '#f28cb1'
              ],
              'circle-radius': [
                  'step',
                  ['get', 'point_count'],
                  20, 10, 30, 100, 40
              ],
              'circle-stroke-width': 1,
              'circle-stroke-color': '#fff'
          }
      });
      console.log("Cluster layer added");

      // Add Cluster Count Layer
      map.addLayer({
          id: clusterCountLayerId,
          type: 'symbol',
          source: sourceId,
          filter: ['has', 'point_count'],
          layout: {
              'text-field': '{point_count_abbreviated}',
              'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
              'text-size': 12,
              'text-allow-overlap': true
          },
          paint: {
              'text-color': '#ffffff'
          }
      });
      console.log("Cluster count layer added");

      // Add Unclustered Point Layer
      map.addLayer({
          id: unclusteredPointLayerId,
          type: 'circle',
          source: sourceId,
          filter: ['!', ['has', 'point_count']],
          paint: {
              'circle-color': '#11b4da',
              'circle-radius': 6,
              'circle-stroke-width': 1,
              'circle-stroke-color': '#fff'
          }
      });
      console.log("Unclustered point layer added");

      // --- ADD EVENT LISTENERS ONCE --- 
      // Inspect cluster on click
      map.on('click', clusterLayerId, (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: [clusterLayerId] });
        if (!features.length) return;
        const clusterId = features[0].properties?.cluster_id;
        if (!clusterId) return;

        (map.getSource(sourceId) as mapboxgl.GeoJSONSource).getClusterExpansionZoom(
            clusterId,
            (err, zoom) => {
                if (err) return;
                if (features[0].geometry.type === 'Point') {
                    map.easeTo({
                        center: features[0].geometry.coordinates as [number, number],
                        zoom: zoom ?? map.getZoom() + 1
                    });
                }
            }
        );
      });

      // Handle mouseenter for unclustered points (popup)
      map.on('mouseenter', unclusteredPointLayerId, (e) => {
          map.getCanvas().style.cursor = 'pointer';
          if (!e.features || e.features.length === 0 || !popupRef.current) return;
          const feature = e.features[0];

          if (feature.geometry.type === 'Point' && feature.properties) {
              const coordinates = feature.geometry.coordinates.slice() as [number, number];
              const locationString = feature.properties.locationString;
              const docCount = feature.properties.docCount;
              const docIds: number[] = JSON.parse(feature.properties.documentIds || '[]');

              // --- Generate popup HTML (using helper or inline logic - unchanged) ---
              let popupHtml = `<div class="p-1 text-foreground dark:text-background space-y-2">`;
              popupHtml += `<strong class="text-base block">${locationString} (${docCount} doc${docCount > 1 ? 's' : ''})</strong>`;
              const docsToShow = docIds
                 .map(id => documents?.find(doc => doc.id === id)) // Use optional chaining for documents
                 .filter((doc): doc is DocumentRead => !!doc)
                 .slice(0, 3);

               docsToShow.forEach(doc => {
                  const docTitle = doc.title || `Document ${doc.id}`;
                  popupHtml += `<div class="border-t pt-1 mt-1">`;
                  popupHtml += `<p class="text-xs font-medium mb-1">${docTitle}</p>`;
                  popupHtml += `<div class="text-xs space-y-0.5">`;
                  const docResults = results?.filter(r => // Use optional chaining for results
                     r.document_id === doc.id && schemes?.some(s => s.id === r.scheme_id) // Use optional chaining for schemes
                  ) || [];
                  if (docResults.length > 0) {
                     docResults.forEach(res => {
                         const scheme = schemes?.find(s => s.id === res.scheme_id);
                         if (scheme) {
                             const formattedValue = getFormattedValueForPopup(res.value, scheme);
                             const displayValue = formattedValue.length > 50 ? formattedValue.substring(0, 50) + '...' : formattedValue;
                             popupHtml += `<div><span class="font-semibold">${scheme.name}:</span> ${displayValue}</div>`;
                         }
                     });
                  } else {
                      popupHtml += `<div class="italic">No results for active schemes.</div>`;
                  }
                  popupHtml += `</div></div>`;
               });
               if (docIds.length > docsToShow.length) {
                  popupHtml += `<div class="text-xs italic mt-1">...and ${docIds.length - docsToShow.length} more document(s)</div>`;
               }
               popupHtml += `</div>`;
              // --- End popup HTML generation ---

              while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
                  coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360;
              }

              popupRef.current.setLngLat(coordinates).setHTML(popupHtml).addTo(map);
          }
      });

      // Handle mouseleave for unclustered points
      map.on('mouseleave', unclusteredPointLayerId, () => {
          map.getCanvas().style.cursor = '';
          popupRef.current?.remove();
      });

      // Handle clicks on unclustered points
      map.on('click', unclusteredPointLayerId, (e) => {
         if (!e.features || e.features.length === 0 || !onPointClick) return;
         const feature = e.features[0];
         if (feature.geometry.type === 'Point' && feature.properties) {
            const pointData: MapPoint = {
              id: feature.properties.id,
              locationString: feature.properties.locationString,
              coordinates: { longitude: feature.geometry.coordinates[0], latitude: feature.geometry.coordinates[1] },
              documentIds: JSON.parse(feature.properties.documentIds || '[]')
            };
            onPointClick(pointData);
         }
      });

      // Change cursor for clusters
      map.on('mouseenter', clusterLayerId, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', clusterLayerId, () => { map.getCanvas().style.cursor = ''; });
      // --- END ADD EVENT LISTENERS ONCE ---

    }); // End map.on('load')

    // Add controls
    map.addControl(new mapboxgl.NavigationControl());

    // Cleanup on unmount
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      popupRef.current = null; // Clean up popup ref
      setMapLoaded(false);
      console.log("Map cleaned up");
    };
  }, [theme, MAPBOX_TOKEN]); // Only depends on theme and token for init


  // --- UPDATE DATA useEffect --- (Only updates the source data)
  useEffect(() => {
    // Wait for map to be loaded and have points data
    if (!mapLoaded || !mapRef.current) return;

    const map = mapRef.current;
    const sourceId = 'geocoded-locations';

    // Ensure the source exists before trying to set data
    const source = map.getSource(sourceId) as mapboxgl.GeoJSONSource;
    if (!source) {
        console.warn("Map source not found yet, skipping data update.");
        return; // Source might not be ready yet if 'load' hasn't fully completed
    }

    // Prepare GeoJSON data from points prop
    const geoJsonFeatures: GeoJSON.Feature[] = points
        .filter(point => // Stricter check for valid coordinates
            point.coordinates &&
            typeof point.coordinates.latitude === 'number' && !isNaN(point.coordinates.latitude) &&
            typeof point.coordinates.longitude === 'number' && !isNaN(point.coordinates.longitude)
        )
        .map(point => ({
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: [point.coordinates.longitude, point.coordinates.latitude]
            },
            properties: {
                id: point.id,
                locationString: point.locationString,
                docCount: point.documentIds.length,
                documentIds: JSON.stringify(point.documentIds)
            }
        }));

    const geoJsonData: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: geoJsonFeatures
    };

    console.log(`Updating map source '${sourceId}' with ${geoJsonFeatures.length} features.`);
    source.setData(geoJsonData); // Update the data of the existing source

  }, [mapLoaded, points]); // Only depends on mapLoaded and points

  // Adjust map style based on theme (Keep this useEffect)
  useEffect(() => {
     if (mapRef.current && mapLoaded) {
        // --- MODIFIED: Use optional chaining and adjust comparison --- 
        const currentStyleName = mapRef.current?.getStyle()?.name;
        const targetStyleUrl = theme === 'dark' ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/light-v11';
        const targetStyleName = theme === 'dark' ? 'Mapbox Dark' : 'Mapbox Light'; // Compare against style name

        // Only setStyle if the target style is different from the current one
        if (currentStyleName !== targetStyleName) { 
           console.log(`Theme changed to ${theme}. Updating map style.`);
           mapRef.current.setStyle(targetStyleUrl);
           // Layers and sources *should* persist across style changes if defined correctly,
           // but Mapbox GL JS behavior can vary. Adding a check/reload might be needed
           // in complex cases, but let's omit it for now for simplicity.
        }
        // --- END MODIFICATION ---
     }
  }, [theme, mapLoaded]);

  return <div ref={mapContainerRef} style={{ width: '100%', height: '100%', minHeight: '500px', borderRadius: '8px' }} />;
};

export default LocationMap;
