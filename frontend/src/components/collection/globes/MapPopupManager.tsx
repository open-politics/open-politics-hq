import React, { useEffect, useRef, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import { useGeoDataStore } from '@/zustand_stores/storeGeodata';
import { LngLat } from 'mapbox-gl'; // Import LngLat

// Define a type for the detailed content within a feature property
interface ContentDetail {
  content_id: string;
  title: string;
  url: string;
  source: string;
  insertion_date: string;
  classification?: { // Optional classification object
    event_type?: string;
    event_subtype?: string;
    // Add other classification fields if needed
  };
  // Add other fields if they exist
}

interface MapPopupManagerProps {
  map: mapboxgl.Map | null;
  layerIds?: string[];
  onFeatureClick?: (feature: mapboxgl.GeoJSONFeature, lngLat: mapboxgl.LngLat) => void;
  onClusterClick?: (clusterId: number, source: string, coordinates: [number, number]) => void;
  createPopupContent?: (feature: mapboxgl.GeoJSONFeature) => string;
  debug?: boolean; // Add debug mode option
}

// Helper function to safely stringify properties for unique ID
const safeStringify = (obj: any): string => {
  try {
    // A simple approach: stringify coordinates if it's geometry, else basic props
    if (obj && obj.type === 'Point' && obj.coordinates) {
      return JSON.stringify(obj.coordinates);
    } else if (obj && obj.id) {
      return obj.id.toString();
    }
    // Fallback for other types or complex properties
    return 'complex-geometry';
  } catch (e) {
    return 'stringify-error';
  }
};

/**
 * A reusable component to manage hover and click popups for Mapbox maps
 * Can be used with any Mapbox implementation including gGlobe
 */
const MapPopupManager: React.FC<MapPopupManagerProps> = ({
  map,
  layerIds = [],
  onFeatureClick,
  onClusterClick,
  createPopupContent,
  debug = false
}) => {
  const {
    setSelectedLocation: storeSetSelectedLocation,
    setSelectedEventType: storeSetSelectedEventType,
    setActiveContents: storeSetActiveContents,
    selectedContentId, // Get selectedContentId
  } = useGeoDataStore();

  const hoverPopupRef = useRef<mapboxgl.Popup | null>(null);
  const clickPopupRef = useRef<mapboxgl.Popup | null>(null);
  const hoverTimeoutRef = useRef<number | null>(null);
  const lastFeatureIdRef = useRef<string | null>(null);

  // Ref to store props and callbacks to avoid re-running useEffect for listeners
  const propsRef = useRef({
    layerIds,
    onFeatureClick,
    onClusterClick,
    createPopupContent,
    debug,
    setSelectedLocation: storeSetSelectedLocation,
    setSelectedEventType: storeSetSelectedEventType,
    setActiveContents: storeSetActiveContents,
    selectedContentId, // Include selectedContentId in the ref
  });

  // Update the ref whenever props/callbacks change
  useEffect(() => {
    propsRef.current = {
      layerIds,
      onFeatureClick,
      onClusterClick,
      createPopupContent,
      debug,
      setSelectedLocation: storeSetSelectedLocation,
      setSelectedEventType: storeSetSelectedEventType,
      setActiveContents: storeSetActiveContents,
      selectedContentId, // Update selectedContentId in the ref
    };
  }, [
    layerIds,
    onFeatureClick,
    onClusterClick,
    createPopupContent,
    debug,
    storeSetSelectedLocation,
    storeSetSelectedEventType,
    storeSetActiveContents,
    selectedContentId, // Include selectedContentId in the dependency array
  ]);


  // Debounced hover popup logic
  const debouncedShowPopup = useCallback((feature: mapboxgl.GeoJSONFeature, lngLat: mapboxgl.LngLat) => {
    if (!map) return;

    // Clear any existing timeout
    if (hoverTimeoutRef.current !== null) {
      window.clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }

    // Generate a unique ID for the feature
    const featureId = feature.id?.toString() ||
      `${feature.properties?.id || 'no-prop-id'}-${feature.geometry?.type || 'no-geom-type'}-${
        safeStringify(feature.geometry)
      }`;

    // If it's the same feature ID already being shown or processed, reset the timer and exit
    if (featureId === lastFeatureIdRef.current) {
      hoverTimeoutRef.current = window.setTimeout(() => {}, 150); // Keep timeout active but do nothing
      return;
    }

    // If a *different* feature is hovered quickly, clear the old ref to allow immediate update
    lastFeatureIdRef.current = null;

    // Set a new timeout to show the popup
    hoverTimeoutRef.current = window.setTimeout(() => {
      if (!map) return;

      // Ensure it's still the same feature intended for this timeout
      const currentFeatureId = feature.id?.toString() ||
        `${feature.properties?.id || 'no-prop-id'}-${feature.geometry?.type || 'no-geom-type'}-${
          safeStringify(feature.geometry)
        }`;
      if (currentFeatureId !== featureId) return; // ID changed, another hover event is processing

      // Close existing hover popup before creating new one
      if (hoverPopupRef.current) {
        hoverPopupRef.current.remove();
        hoverPopupRef.current = null;
      }

      const properties = feature.properties || {};
      const isCluster = !!properties.cluster_id; // More robust check for cluster
      const layerId = feature.layer?.id || '';
      const sourceId = feature.layer?.source;
      const count = properties.content_count || properties.point_count || 0;

      const createAndShowPopup = (headlinesHtml: string = '', locationName: string, primaryEventType: string) => {
        lastFeatureIdRef.current = featureId; // Set last feature ID *only when showing* the popup

        let html = `<div class="p-2 bg-background/80 backdrop-blur-sm rounded-lg shadow-md max-w-xl border border-border/50">`;
        html += `<h3 class="text-sm font-semibold mb-0.5 truncate">${locationName}</h3>`;
        html += `<p class="text-xs font-medium text-green-600 dark:text-green-400">${primaryEventType}</p>`;
        html += `<p class="text-xs mt-1 text-muted-foreground">${count} ${isCluster ? 'items' : count === 1 ? 'article' : 'articles'}</p>`;
        html += headlinesHtml;
        html += `</div>`;

      hoverPopupRef.current = new mapboxgl.Popup({
        closeButton: false,
        closeOnClick: false,
        className: 'map-popup-hover',
        anchor: 'bottom',
        offset: 10,
          maxWidth: 'none'
      })
        .setLngLat(lngLat)
          .setHTML(html)
        .addTo(map);
      };

      // Determine base info
      let locationName = 'Unknown Location';
      let primaryEventType = 'Articles / Events';

      // Determine primary event type based on layer or properties
      if (layerId.startsWith('clusters-') || layerId.startsWith('unclustered-point-')) {
        const parts = layerId.split('-');
        const typeIndex = layerId.startsWith('clusters-') ? 1 : 2;
        if (parts.length > typeIndex && parts[typeIndex] !== 'articles') {
          primaryEventType = parts[typeIndex]; // e.g., Protests
        } else if (parts[typeIndex] === 'articles') {
          primaryEventType = 'General Articles'; // Specific for articles layer
        }
      } else if (!isCluster && properties.event_type) {
        primaryEventType = properties.event_type; // Fallback from property
      } else if (isCluster) {
        primaryEventType = 'Mixed Cluster'; // Default for clusters
      }

      // --- Generate content based on whether it's a cluster or point ---
      if (isCluster) {
        locationName = primaryEventType !== 'Mixed Cluster' ? `${primaryEventType} Cluster` : 'Location Cluster';

        // Fetch limited leaves for cluster hover headlines
        if (!sourceId) {
          console.error('Cluster hover error: Missing source ID');
          createAndShowPopup('', locationName, primaryEventType); // Show basic info without headlines
          return;
        }
        const clusterSource = map.getSource(sourceId);
        // Check if source is valid and has the getClusterLeaves method
        if (clusterSource && clusterSource.type === 'geojson' && typeof (clusterSource as mapboxgl.GeoJSONSource).getClusterLeaves === 'function') {
          const MAX_HOVER_LEAVES = 3; // Limit number of leaves fetched
          (clusterSource as mapboxgl.GeoJSONSource).getClusterLeaves(properties.cluster_id, MAX_HOVER_LEAVES, 0, (err, leaves) => {
            // Re-generate feature ID inside callback to check against current feature
            const callbackFeatureId = feature.id?.toString() ||
              `${feature.properties?.id || 'no-prop-id'}-${feature.geometry?.type || 'no-geom-type'}-${
                safeStringify(feature.geometry)
              }`;

            // Important: Check if the featureId still matches the one this callback was initiated for
            if (callbackFeatureId !== featureId) {
              // A newer hover event has likely started, abandon this one
              return;
            }

            if (err || !leaves || leaves.length === 0) {
              // If error or no leaves, show popup without headlines
              createAndShowPopup('', locationName, primaryEventType);
              return;
            }

            // Generate headlines from fetched leaves
            let clusterHeadlinesHtml = '<ul class="mt-1 text-xs list-disc list-inside text-muted-foreground/80 max-w-[280px]">';
            leaves.forEach((leaf) => {
              const leafProps = leaf.properties || {};
              const contents = (() => { // Use IIFE to initialize const
                  try {
                      // Safely parse contents
                      return typeof leafProps.contents === "string" ? JSON.parse(leafProps.contents) : (Array.isArray(leafProps.contents) ? leafProps.contents : []);
                  } catch (e) { 
                      return []; 
                  }
              })(); // Assign result to const contents

              if (contents.length > 0) {
                const content: ContentDetail = contents[0]; // Use first content item from the leaf
                const truncatedTitle = content.title && content.title.length > 50 ? content.title.substring(0, 47) + "..." : content.title || "Untitled Article";
                const isSelected = content.content_id === propsRef.current.selectedContentId;
                const titleClass = isSelected ? "font-bold text-foreground" : "";
                clusterHeadlinesHtml += `<li class="${titleClass} truncate">${truncatedTitle}</li>`;
                const articleEventSubtype = content.classification?.event_subtype || null;
                if (articleEventSubtype) {
                  clusterHeadlinesHtml += `<p class="ml-4 text-xs text-blue-600 dark:text-blue-400">${articleEventSubtype}</p>`;
                }
              }
            });
            clusterHeadlinesHtml += '</ul>';

            // Show popup with the generated headlines
            createAndShowPopup(clusterHeadlinesHtml, locationName, primaryEventType);
          });
        } else {
          // If source is invalid or doesn't support leaves, show basic popup
          if (propsRef.current.debug) console.warn(`Cluster hover: Source ${sourceId} invalid or doesn't support getClusterLeaves.`);
          createAndShowPopup('', locationName, primaryEventType);
        }
      } else {
        // Handle individual points (simpler, no async fetch needed)
        locationName = properties.name || properties.NAME || properties.location_name || properties.title || 'Unnamed Point';
        let pointHeadlinesHtml = '';
        if (properties.contents && properties.contents.length > 0) {
          // Refine event type based on first content item if possible
          primaryEventType = properties.contents[0]?.classification?.event_type || primaryEventType;
          try {
            const contents = (() => { // Use IIFE
                try {
                    return typeof properties.contents === "string" ? JSON.parse(properties.contents) : (Array.isArray(properties.contents) ? properties.contents : []);
                } catch(e) {
                    return [];
                }
            })();

            if (contents.length > 0) {
              const MAX_HEADLINES = 1; // Show only one for individual points
              pointHeadlinesHtml += '<ul class="mt-1 text-xs list-disc list-inside text-muted-foreground/80 max-w-[280px]">';
              contents.slice(0, MAX_HEADLINES).forEach((content: ContentDetail) => {
                const truncatedTitle = content.title && content.title.length > 50 ? content.title.substring(0, 47) + "..." : (content.title || "Untitled Article");
                const isSelected = content.content_id === propsRef.current.selectedContentId;
                const titleClass = isSelected ? "font-bold text-foreground" : "";
                pointHeadlinesHtml += `<li class="${titleClass} truncate">${truncatedTitle}</li>`;
                const articleEventSubtype = content.classification?.event_subtype || null;
                if (articleEventSubtype) {
                  pointHeadlinesHtml += `<p class="ml-4 text-xs text-blue-600 dark:text-blue-400">${articleEventSubtype}</p>`;
                }
              });
              pointHeadlinesHtml += "</ul>";
            }
          } catch (e) {
            if (propsRef.current.debug) console.error("Error parsing contents for point hover:", e);
            pointHeadlinesHtml = '';
          }
        }
        // Show popup for the individual point
        createAndShowPopup(pointHeadlinesHtml, locationName, primaryEventType);
      }
    }, 150); // Debounce delay for hover
  }, [map, propsRef.current.selectedContentId]); // Re-run useCallback if map instance or selectedContentId changes


  // Effect to setup and cleanup map listeners
  useEffect(() => {
    if (!map) return;

    // --- MOUSEMOVE ---
    const handleMouseMove = (e: mapboxgl.MapMouseEvent & any) => {
      // Extract features directly from the event if available
      const features = e.features;
      if (features && features.length > 0) {
        debouncedShowPopup(features[0], e.lngLat);
        } else {
        // If mouse moves off features, clear timeout and remove popup
          if (hoverTimeoutRef.current !== null) {
            window.clearTimeout(hoverTimeoutRef.current);
            hoverTimeoutRef.current = null;
          }
        if (hoverPopupRef.current) {
          hoverPopupRef.current.remove();
          hoverPopupRef.current = null;
        }
        lastFeatureIdRef.current = null; // Clear last feature ID when moving off
      }
    };

    // --- MOUSELEAVE ---
    const handleMouseLeave = () => {
      // Clear timeout and remove popup when mouse leaves the layer
      if (hoverTimeoutRef.current !== null) {
        window.clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = null;
      }
      if (hoverPopupRef.current) {
        hoverPopupRef.current.remove();
        hoverPopupRef.current = null;
      }
      lastFeatureIdRef.current = null; // Clear last feature ID on leave
    };

    // --- CLICK ---
    const handleClick = (e: mapboxgl.MapMouseEvent & any) => {
      // Extract features directly from the event
      const features = e.features;
      if (!features || features.length === 0) return;

      // Close hover popup immediately on any map click
      if (hoverPopupRef.current) {
        hoverPopupRef.current.remove();
        hoverPopupRef.current = null;
        if (hoverTimeoutRef.current !== null) {
          window.clearTimeout(hoverTimeoutRef.current);
          hoverTimeoutRef.current = null;
        }
        lastFeatureIdRef.current = null; // Clear hover state
      }

          const feature = features[0];
          const properties = feature.properties || {};
      const isCluster = !!properties.cluster_id;
      const layerId = feature.layer?.id || '';
      const sourceId = feature.layer?.source;
      const currentProps = propsRef.current; // Use ref for callbacks

      // Close any existing *click* popup first
          if (clickPopupRef.current) {
            clickPopupRef.current.remove();
        clickPopupRef.current = null;
      }

      // --- Handle Cluster Click ---
      if (isCluster) {
            const clusterId = properties.cluster_id;

            if (!sourceId) {
          if (currentProps.debug) console.error('Cluster click error: Missing source ID');
              return;
            }
        const clusterSource = map.getSource(sourceId);

        // Validate source and method exist
        if (!clusterSource || clusterSource.type !== 'geojson' || typeof (clusterSource as mapboxgl.GeoJSONSource).getClusterLeaves !== 'function') {
          if (currentProps.debug) console.error(`Cluster click failed: Source ${sourceId} (type: ${clusterSource?.type}) invalid or getClusterLeaves unsupported.`);
               return;
            }

        // Fetch *all* leaves for the click popup
        (clusterSource as mapboxgl.GeoJSONSource).getClusterLeaves(clusterId, Infinity, 0, (err, leaves) => {
          if (err || !leaves) {
            if (currentProps.debug) console.error("Error getting cluster leaves for click:", err);
                  return;
                }

          const count = leaves.length;
          let popupContentHtml = '';
          let articlesHtml = '<ul class="mt-2 space-y-1.5 overflow-y-auto max-h-48 custom-scrollbar pr-1">';

          // Determine cluster type for title/heading
          let clusterEventType = 'Mixed Cluster';
          if (layerId.startsWith('clusters-')) {
            const parts = layerId.split('-');
            if (parts.length > 1 && parts[1] !== 'articles') {
              clusterEventType = parts[1];
            } else if (parts[1] === 'articles') {
              clusterEventType = 'General Articles Cluster';
            }
          }
          const clusterName = `${clusterEventType}`;

          // Generate Header
          popupContentHtml += `<div class="p-3 bg-background/90 backdrop-blur-sm rounded-lg shadow-lg max-w-xl border border-border">`;
          popupContentHtml += `<h3 class="text-base font-semibold mb-1">${clusterName} Events Cluster</h3>`;
          // popupContentHtml += `<p class="text-xs font-medium text-green-600 dark:text-green-400">${clusterEventType}</p>`;
          popupContentHtml += `<p class="text-xs mt-1 text-muted-foreground">${count} ${count === 1 ? 'item' : 'items'}</p>`;

          // Generate list of articles in the cluster
          const addedContentIds = new Set<string>(); // Keep track of added content IDs
          leaves.forEach((leaf) => {
            const leafProps = leaf.properties || {};
            const leafContents = (() => { // Use IIFE
                try {
                    return typeof leafProps.contents === 'string' ? JSON.parse(leafProps.contents) : Array.isArray(leafProps.contents) ? leafProps.contents : [];
                } catch (e) { 
                    return []; 
                }
            })(); 

            if (leafContents.length > 0) {
              const content: ContentDetail = leafContents[0];
              // Deduplication check
              if (content.content_id && !addedContentIds.has(content.content_id)) {
                addedContentIds.add(content.content_id); // Add new ID to set
                const truncatedTitle = content.title && content.title.length > 120 ? content.title.substring(0, 117) + '...' : (content.title || 'Untitled Article');
                const articleEventSubtype = content.classification?.event_subtype || null;
                const isSelected = content.content_id === propsRef.current.selectedContentId;
                const titleClass = isSelected ? 'font-semibold text-foreground' : 'text-foreground/90';
                articlesHtml += `<li data-content-id="${content.content_id}" class="text-xs border-b border-border/50 pb-1 last:border-b-0">`;
                articlesHtml += `<span class="${titleClass}">${truncatedTitle}</span>`;
                if (articleEventSubtype) {
                  articlesHtml += `<p class="text-xs text-blue-600 dark:text-blue-400">${articleEventSubtype}</p>`;
                }
                articlesHtml += `</li>`;
              } else if (!content.content_id && propsRef.current.debug) {
                // Log if content is missing an ID, might indicate data issue
                console.warn('Cluster leaf content missing content_id:', content);
              }
            } else {
              // Add placeholder only if no actual content was processed from this leaf
              // articlesHtml += `<li class="text-xs text-muted-foreground border-b border-border/50 pb-1 last:border-b-0">Unnamed Point Data</li>`;
              // Avoid adding the placeholder if we are deduplicating valid content
            }
          });
          articlesHtml += '</ul>';

          // Add "View All" button
          const centerLng = e.lngLat.lng;
          const centerLat = e.lngLat.lat;
          // Use a representative name (e.g., from the first leaf) for the location click handler
          const representativeLocationName = leaves[0]?.properties?.name || leaves[0]?.properties?.location_name || clusterName;

          const viewAllButtonHtml = `
                    <button
                        class="text-xs font-medium text-green-600 dark:text-green-400 hover:underline cursor-pointer mt-2 cluster-view-all-btn"
                        data-lng="${centerLng}"
                        data-lat="${centerLat}"
                        data-name="${representativeLocationName.replace(/\"/g, '&quot;')}"
                    >
                        View All ${count} Items →
                    </button>
          `;

          popupContentHtml += articlesHtml;
          popupContentHtml += viewAllButtonHtml;
          popupContentHtml += `</div>`; // Close main div
          if (currentProps.debug) {
            console.log("Cluster Click Popup HTML generated");
          }

          // Create and show the click popup
                clickPopupRef.current = new mapboxgl.Popup({
                    closeButton: true,
            closeOnClick: false, // Keep open until explicitly closed or another click
            className: 'map-popup-click', // Specific class for click popups
                    anchor: 'bottom',
            offset: 15, // Slightly larger offset for click popups
            maxWidth: '320px' // Max width for cluster click
                })
            .setLngLat(e.lngLat)
            .setHTML(popupContentHtml)
                .addTo(map);

          // Add event listener to the button *after* popup is added to DOM
          const popupElement = clickPopupRef.current?.getElement();
                if (popupElement) {
            popupElement.addEventListener('click', (event) => {
              const target = event.target as HTMLElement;
              if (target.classList.contains('cluster-view-all-btn')) {
                const lng = parseFloat(target.getAttribute('data-lng') || '0');
                const lat = parseFloat(target.getAttribute('data-lat') || '0');
                const name = target.getAttribute('data-name') || 'Cluster Area';

                if (currentProps.debug) {
                  console.log("Cluster 'View All' button clicked:", { lng, lat, name });
                }

                // Construct a feature-like object and LngLat for the callback
                const constructedFeature = {
                  type: 'Feature',
                  properties: {
                    name: name,
                    location_name: name,
                    cluster: true,
                    point_count: count,
                    event_type: clusterEventType !== 'Mixed Cluster' ? clusterEventType : null
                  },
                  geometry: {
                    type: 'Point',
                    coordinates: [lng, lat]
                  }
                };
                const constructedLngLat = new LngLat(lng, lat);

                // Call the main feature click handler
                if (currentProps.onFeatureClick) {
                  currentProps.onFeatureClick(constructedFeature as any, constructedLngLat);
                }

                // Close the click popup after handling
                clickPopupRef.current?.remove();
                clickPopupRef.current = null;
              }
            });
          } else if (currentProps.debug) {
            console.warn("Could not find popup element to attach cluster button listener.");
          }
        }); // End getClusterLeaves callback
          } else {
        // --- Handle Individual Point Click ---
        if (currentProps.debug) {
          console.log('Individual feature clicked:', feature);
        }
        // Directly call the provided onFeatureClick handler
        if (currentProps.onFeatureClick) {
          if (currentProps.debug) {
            console.log('Calling onFeatureClick for individual point...');
          }
          currentProps.onFeatureClick(feature, e.lngLat);
        } else if (currentProps.debug) {
          console.warn('Individual feature clicked, but no onFeatureClick handler provided.');
        }
      }
    };

    // --- Setup Listeners ---
    // Get layer IDs from props ref to ensure latest are used
    const layersToListen = propsRef.current.layerIds && propsRef.current.layerIds.length > 0 ? propsRef.current.layerIds : [];
    if (layersToListen.length > 0) {
      if (propsRef.current.debug) console.log('MapPopupManager: Attaching listeners to layers:', layersToListen);
      map.on('mousemove', layersToListen, handleMouseMove);
      map.on('mouseleave', layersToListen, handleMouseLeave);
      map.on('click', layersToListen, handleClick);
    } else {
      if (propsRef.current.debug) console.warn('MapPopupManager: No layer IDs provided to listen on.');
    }

    // Cleanup function
    return () => {
      if (propsRef.current.debug) console.log('MapPopupManager: Cleaning up listeners');
      if (layersToListen.length > 0) {
        // Check if map instance still exists before removing listeners
        if (map && map.getStyle()) {
          try {
            map.off('mousemove', layersToListen, handleMouseMove);
            map.off('mouseleave', layersToListen, handleMouseLeave);
            map.off('click', layersToListen, handleClick);
          } catch (error) {
            // Log error if removing listeners fails (e.g., map style changed)
            console.warn('Error removing MapPopupManager listeners:', error);
          }
        }
      }
      // Remove any lingering popups
      hoverPopupRef.current?.remove();
      clickPopupRef.current?.remove();
      // Clear any pending timeout
      if (hoverTimeoutRef.current !== null) { window.clearTimeout(hoverTimeoutRef.current); }
      // Reset refs
        hoverPopupRef.current = null;
        clickPopupRef.current = null;
      hoverTimeoutRef.current = null;
      lastFeatureIdRef.current = null;
    };
  }, [map]); // Effect depends only on the map instance itself

  // This component doesn't render anything itself
  return null;
};

export default MapPopupManager;