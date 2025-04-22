'use client'

import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  forwardRef,
  useImperativeHandle,
  useMemo
} from "react";
import mapboxgl from "mapbox-gl";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronUp, ChevronDown, Locate, List, MapPin } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import "mapbox-gl/dist/mapbox-gl.css";
import * as d3 from "d3";
import MapLegend from "./MapLegend";
import { useCoordinatesStore } from "@/zustand_stores/storeCoordinates";
import { useArticleTabNameStore } from "@/hooks/useArticleTabNameStore";
import { useLocationData } from "@/hooks/useLocationData";
import { useTheme } from "next-themes";
import useGeocode from "@/hooks/useGeocder";
import LottiePlaceholder from "@/components/ui/lottie-placeholder";
import { useGeoDataStore } from '@/zustand_stores/storeGeodata';
import MapPopupManager from "@/components/collection/globes/MapPopupManager";
import ReactDOM from "react-dom";
import * as GeoJSON from 'geojson';
import { any } from "@amcharts/amcharts5/.internal/core/util/Array";

// Helper function to format Date object to YYYY-MM-DDTHH:MM:SS
const formatDateForAPI = (date: Date | null): string | null => {
  if (!date) return null;
  // Pad single digits with leading zero
  const pad = (num: number) => num.toString().padStart(2, '0');

  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1); // Month is 0-indexed
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
};

// Memoize the default date range to prevent redundant calculations
const getDefaultDateRange = (): { startDate: string, endDate: string } => {
  // Get current date
  const now = new Date();
  
  // Create date 21 days ago
  const pastDate = new Date(now);
  pastDate.setDate(now.getDate() - 21);
  
  // Format dates for API
  return {
    startDate: formatDateForAPI(pastDate) || '',
    endDate: formatDateForAPI(now) || ''
  };
};

// Distance used by Mapbox for clustering
const CLUSTER_RADIUS = 30;

// Helper to map location type to a zoom level
type LocationType = "continent" | "country" | "locality" | "region" | "city" | "address";

const getZoomLevelForLocation = (locationType: LocationType): number => {
  const zoomLevels: Record<LocationType, number> = {
    continent: 2,
    country: 4,
    region: 5,
    locality: 6,
    city: 11,
    address: 12,
  };
  return zoomLevels[locationType] || 4;
};

// Calculate a somewhat dynamic zoom level based on bounding box area
const calculateZoomLevel = (bbox: number[]): number => {
  if (!bbox || bbox.length !== 4) return 4;
  const width = Math.abs(bbox[2] - bbox[0]);
  const height = Math.abs(bbox[3] - bbox[1]);
  const area = width * height;
  if (area > 1000) return 2;
  if (area > 500) return 2.5;
  if (area > 200) return 3;
  if (area > 100) return 3.5;
  if (area > 50) return 4;
  if (area > 20) return 4.5;
  if (area > 10) return 5;
  if (area > 5) return 5.5;
  if (area > 1) return 6;
  return 7;
};

interface GlobeProps {
  geojsonUrl: string;
  onLocationClick: (locationName: string, eventType?: string) => void;
  coordinates?: { latitude: number; longitude: number };
  onBboxChange?: (bbox: number[] | null) => void;
}

const Globe = forwardRef<any, GlobeProps>(
  ({ geojsonUrl, onLocationClick, coordinates, onBboxChange }, ref) => {
    // Refs and states
    const mapContainerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<mapboxgl.Map | null>(null);

    const [mapLoaded, setMapLoaded] = useState(false);
    const [isMobile, setIsMobile] = useState(false);
    const [showLegend, setShowLegend] = useState(false);
    const [hoveredFeature, setHoveredFeature] = useState<any>(null);
    const [menuOpen, setMenuOpen] = useState(false);
    const [currentBbox, setCurrentBbox] = useState<number[] | null>(null);
    const setActiveTab = useArticleTabNameStore((state) => state.setActiveTab);
    const [isSpinning, setIsSpinning] = useState(true);
    const spinningRef = useRef<number | null>(null);
    const [isRoutePlaying, setIsRoutePlaying] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [controlsOpen, setControlsOpen] = useState(false);

    const { latitude, longitude } = useCoordinatesStore();
    const { theme } = useTheme();

    const [inputLocation, setInputLocation] = useState("");
    const { geocodeLocation, loading, error } = useGeocode();

    // To avoid reloading geoJSON on every theme change, keep a flag
    const [geojsonLoaded, setGeojsonLoaded] = useState(false);

    // In the component body, use useMemo for the date range:
    const defaultDateRange = useMemo(() => getDefaultDateRange(), []);
    const [startDate, setStartDate] = useState<string | null>(defaultDateRange.startDate);
    const [endDate, setEndDate] = useState<string | null>(defaultDateRange.endDate);
    const [eventLimit, setEventLimit] = useState<number>(100);

    // Modify the eventTypes array to use simpler icon names
    const eventTypes = useMemo(() => [
      {
        type: "Protests",
        color: theme === "dark" ? "#FF6B6B" : "#E63946",
        icon: "protest",
        zIndex: 51,
      },
      {
        type: "Elections",
        color: theme === "dark" ? "#4ECDC4" : "#2A9D8F",
        icon: "ballot",
        zIndex: 51,
      },
      {
        type: "Politics",
        color: theme === "dark" ? "#95A5A6" : "#6C757D",
        icon: "politics",
        zIndex: 51,
      },
      {
        type: "Economic",
        color: theme === "dark" ? "#FFD93D" : "#F4A261",
        icon: "economy",
        zIndex: 51,
      },
      {
        type: "Social",
        color: theme === "dark" ? "#6C5CE7" : "#4361EE",
        icon: "social",
        zIndex: 51,
      },
      {
        type: "Crisis",
        color: theme === "dark" ? "#FF8C00" : "#E67E22",
        icon: "crisis",
        zIndex: 51,
      },
      {
        type: "War",
        color: theme === "dark" ? "#FF4757" : "#DC2626",
        icon: "new_war",
        zIndex: 51,
      },
    ], [theme]);

    // A couple of example routes
    const routes = [
      {
        name: "Global Tour",
        locations: [
          {
            name: "Berlin",
            coordinates: [13.4050, 52.5200],
            description: "Capital of Germany",
          },
          {
            name: "Washington D.C.",
            coordinates: [-77.0369, 38.9072],
            description: "Capital of USA",
          },
          {
            name: "Tokyo",
            coordinates: [139.6917, 35.6895],
            description: "Capital of Japan",
          },
          {
            name: "Sydney",
            coordinates: [151.2093, -33.8688],
            description: "Largest city in Australia",
          },
        ],
      },
      {
        name: "Conflict Zones",
        locations: [
          { name: "Kyiv", coordinates: [30.5238, 50.4547], description: "Capital of Ukraine" },
          { name: "Damascus", coordinates: [36.2786, 33.5138], description: "Capital of Syria" },
          { name: "Kabul", coordinates: [69.2075, 34.5553], description: "Capital of Afghanistan" },
          { name: "Baghdad", coordinates: [44.3661, 33.3152], description: "Capital of Iraq" },
        ],
      },
    ];

    // Minimally used location shortcuts
    const locationButtons = ["Germany", "Japan", "USA", "Ukraine", "Israel", "Taiwan"];

    // Visible layers state (checkbox toggles)
    const [visibleLayers, setVisibleLayers] = useState<Record<string, boolean>>(() => {
      const initialLayers: Record<string, boolean> = {};
      for (const et of eventTypes) {
        initialLayers[et.type] = true;
      }
      return initialLayers;
    });

    // Add a new dataType state to track whether we're showing events or articles
    const [dataType, setDataType] = useState<"events" | "articles">("events");

    // Add this state for selected event type
    const [selectedEventType, setSelectedEventType] = useState("Protests");

    // Get state and actions from the store
    const {
      geojsonData,
      eventGeojsonData,
      fetchBaselineGeoJson,
      fetchEventGeoJson,
      error: storeError,
      setSelectedLocation,
      setSelectedEventType: activeFilter,
      setDateRange,
      dateRange,
      activeContents,
      setSelectedContentId,
      selectedLocation,
      selectedContentId,
      activeContentLoading,
      activeContentError,
      fetchContentsByLocation,
      fetchContentsByIds,
      fetchContentById,
      clearContents,
      setActiveContents
    } = useGeoDataStore();

    // Modify the addIconsToMap function to use theme-specific icons
    const addIconsToMap = useCallback(() => {
      if (!mapRef.current) return;
      
      eventTypes.forEach((eventType) => {
        const iconName = eventType.icon;
        // Get theme from current state rather than prop
        const currentTheme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
        const themePrefix = currentTheme === 'dark' ? '_light' : '_dark';
        const imageUrl = `/animations/maki-icons/${iconName}${themePrefix}.svg`;

        // Remove existing image before adding new one
        if (mapRef.current && mapRef.current.hasImage(iconName)) {
          mapRef.current.removeImage(iconName);
        }

        const img = new Image();
        img.onload = () => {
          // Double check the image doesn't exist and map is still valid
          if (mapRef.current && !mapRef.current.hasImage(iconName)) {
            try {
              mapRef.current.addImage(iconName, img);
            } catch (error) {
              console.warn(`Failed to add image ${iconName}:`, error);
            }
          }
        };
        img.onerror = () => {
          console.error(`Failed to load image: ${imageUrl}`);
        };
        img.src = imageUrl;
      });
    }, [eventTypes]);

    // Replace loadGeoJSONEventsData with a more generic function that handles both endpoints
    const loadGeoJSONData = useCallback(async () => {
      if (!mapRef.current || !mapLoaded) return;
      
      try {
        setIsLoading(true);
        
        // Define source ID for articles
        const articlesSourceId = "opol-globe-articles";
        
        // Clear any existing layers and sources first
        if (mapRef.current.getSource(articlesSourceId)) {
          ["clusters-articles", "unclustered-point-articles", "cluster-count-articles"].forEach((layerId) => {
            if (mapRef.current?.getLayer(layerId)) {
              mapRef.current.removeLayer(layerId);
            }
          });
          mapRef.current.removeSource(articlesSourceId);
        }

        if (dataType === "events") {
          console.log(`[Globe] Loading event GeoJSON data for ${eventTypes.length} event types`);
          
          // Process each event type sequentially instead of in parallel
          const results: any[] = [];
          for (const eventType of eventTypes) {
            console.log(`[Globe] Loading event data for ${eventType.type}`);
            try {
              // Use the store's fetch method which already has caching built in
              const result = await fetchEventGeoJson(
                eventType.type,
                startDate ?? undefined,
                endDate ?? undefined,
                eventLimit
              );
              results.push(result);
              
              // Add a small delay between requests to reduce server load
              await new Promise(resolve => setTimeout(resolve, 300));
            } catch (error) {
              console.error(`Error fetching ${eventType.type} data:`, error);
              results.push(null);
            }
          }
          
          // Process results, handling null values
          eventTypes.forEach((eventType, index) => {
            const result = results[index];
            if (!result || !mapRef.current) return;
            
            const sourceId = `geojson-events-${eventType.type}`;
            
            // Define offsets array for distributing icons
            const offsets = [
              [-7, -7], // Top-left
              [7, -7],  // Top-right
              [-7, 7],  // Bottom-left
              [7, 7],   // Bottom-right
              [0, -10], // Top-center
              [0, 10],  // Bottom-center
              [-10, 0]  // Left-center
              // Add more if needed, e.g., [10, 0] for Right-center
            ];
            const iconOffset = offsets[index % offsets.length]; // Calculate offset based on index

            // Adjust the feature properties for easier usage
            const typedResult = result as any;
            const adjustedData = {
              ...typedResult,
              features: typedResult.features.map((feature: any) => {
                let contents;
                try {
                  contents =
                    typeof feature.properties.contents === "string"
                      ? JSON.parse(feature.properties.contents)
                      : feature.properties.contents;
                } catch (error) {
                  contents = [];
                }
                return {
                  ...feature,
                  properties: {
                    ...feature.properties,
                    contents: contents,
                  },
                };
              }),
            };
            
            // Add as a cluster source
            mapRef.current.addSource(sourceId, {
              type: "geojson",
              data: adjustedData,
              cluster: true,
              clusterMaxZoom: 14,
              clusterRadius: CLUSTER_RADIUS,
            });

            // Add the cluster layer (circles)
            mapRef.current.addLayer({
              id: `clusters-${eventType.type}`,
              type: "circle",
              source: sourceId,
              filter: ["has", "point_count"],
              paint: {
                "circle-color": eventType.color,
                "circle-radius": [
                  "interpolate",
                  ["linear"],
                  ["get", "point_count"],
                  1,
                  15,
                  50,
                  30,
                  200,
                  40,
                ],
                "circle-opacity": 1,
                "circle-stroke-width": 2,
                "circle-stroke-color": "#fff",
              },
            });

            // Single unclustered points
            mapRef.current.addLayer({
              id: `unclustered-point-${eventType.type}`,
              type: "symbol",
              source: sourceId,
              filter: ["!", ["has", "point_count"]],
              layout: {
                "icon-image": eventType.icon,
                "icon-size": 1,
                "icon-allow-overlap": true,
                "icon-ignore-placement": true,
                "icon-offset": iconOffset, // Apply the calculated offset
                "symbol-placement": "point",
                "symbol-spacing": 50,
                "icon-padding": 5,
                "symbol-sort-key": ["get", "content_count"],
                "icon-pitch-alignment": "viewport",
                "icon-rotation-alignment": "viewport",
                "text-size": 18,
                "text-offset": [0, 0],
                "text-allow-overlap": true,
                "text-ignore-placement": true,
                "text-anchor": "top",
              },
              paint: {
                "icon-opacity": [
                  'case',
                  ['boolean', ['feature-state', 'selected'], false],
                  1.0, // Full opacity if selected
                  0.7 // Default opacity otherwise
                ],
                "icon-color": eventType.color,
                // Optional: Add halo effect when selected
                "icon-halo-width": [
                  'case',
                  ['boolean', ['feature-state', 'selected'], false],
                  2, // Halo width when selected
                  0 // No halo otherwise
                ],
                "icon-halo-color": "#ffffff", 
                "icon-halo-blur": 1
              },
            });

            // Cluster count label
            mapRef.current.addLayer({
              id: `cluster-count-${eventType.type}`,
              type: "symbol",
              source: sourceId,
              filter: ["has", "point_count"],
              layout: {
                "text-field": "{point_count_abbreviated}",
                "text-size": 14,
                "text-allow-overlap": true,
              },
              paint: {
                "text-color": "#ffffff",
              },
            });
          });
        } else {
          // Handle the baseline articles endpoint
          const response = await fetchBaselineGeoJson();
          
          // Check if response is null or undefined
          if (!response || !mapRef.current) {
            throw new Error("Failed to load articles data");
          }
          
          // Use a default color for articles
          const articlesColor = theme === "dark" ? "#6C5CE7" : "#4361EE";
          
          // Adjust the feature properties for easier usage
          const adjustedData = {
            ...response,
            features: response.features.map((feature: any) => {
              let contents;
              try {
                contents =
                  typeof feature.properties.contents === "string"
                    ? JSON.parse(feature.properties.contents)
                    : feature.properties.contents;
              } catch (error) {
                contents = [];
              }
              return {
                ...feature,
                properties: {
                  ...feature.properties,
                  contents: contents,
                },
              };
            }),
          };

          // Add as a cluster source with single layer for articles
          mapRef.current.addSource(articlesSourceId, {
            type: "geojson",
            data: adjustedData,
            cluster: true,
            clusterMaxZoom: 14,
            clusterRadius: CLUSTER_RADIUS,
          });

          // Add a single layer for articles clusters
          mapRef.current.addLayer({
            id: "clusters-articles",
            type: "circle",
            source: articlesSourceId,
            filter: ["has", "point_count"],
            paint: {
              "circle-color": articlesColor,
              "circle-radius": [
                "interpolate",
                ["linear"],
                ["get", "point_count"],
                1,
                15,
                50,
                30,
                200,
                40,
              ],
              "circle-opacity": 0.8,
              "circle-stroke-width": 1,
              "circle-stroke-color": "#fff",
            },
          });

          // Add text count for article clusters
          mapRef.current.addLayer({
            id: "cluster-count-articles",
            type: "symbol",
            source: articlesSourceId,
            filter: ["has", "point_count"],
            layout: {
              "text-field": "{point_count_abbreviated}",
              "text-size": 14,
              "text-allow-overlap": true,
            },
            paint: {
              "text-color": "#ffffff",
            },
          });

          // Add unclustered article points
          mapRef.current.addLayer({
            id: "unclustered-point-articles",
            type: "symbol",
            source: articlesSourceId,
            filter: ["!", ["has", "point_count"]],
            layout: {
              "icon-image": "article",
              "icon-size": 1.2,
              "icon-allow-overlap": true,
              "symbol-placement": "point",
            },
            paint: {
              "icon-color": articlesColor,
              "icon-opacity": 0.8,
            },
          });
        }

        setGeojsonLoaded(true);
      } catch (error) {
        console.error("Error fetching GeoJSON data:", error);
      } finally {
        setIsLoading(false);
      }
    }, [eventTypes, startDate, endDate, eventLimit, mapLoaded, dataType, theme, onLocationClick]);

    /**
     * CREATE A SIMPLE SPIKE CHART USING D3
     */
    const createClusterSpikeChart = useCallback(
      (
        typeMap: Record<string, { count: number; color: string }>,
        contentsArrays: any[]
      ) => {
        const container = document.createElement("div");
        container.style.width = "250px";

        const data = Object.entries(typeMap).map(([k, v]) => ({ type: k, ...v }));
        data.sort((a, b) => b.count - a.count);
        const maxVal = d3.max(data, (d) => d.count) || 1;

        const margin = { top: 10, right: 10, bottom: 10, left: 10 };
        const width = 230;
        const height = 100;

        const svg = d3
          .select(container)
          .append("svg")
          .attr("width", width + margin.left + margin.right)
          .attr("height", height + margin.top + margin.bottom)
          .style("overflow", "visible");

        const xScale = d3
          .scaleBand()
          .domain(data.map((d) => d.type))
          .range([margin.left, width - margin.right])
          .padding(0.3);

        const yScale = d3.scaleLinear().domain([0, maxVal]).range([height, 0]);

        const g = svg
          .append("g")
          .attr("transform", `translate(${margin.left}, ${margin.top})`);

        g.selectAll(".spike")
          .data(data)
          .enter()
          .append("path")
          .attr("class", "spike")
          .attr("transform", (d) => {
            const x = xScale(d.type) ?? 0;
            return `translate(${x + (xScale.bandwidth() ?? 0) / 2}, ${yScale(d.count)})`;
          })
          .attr("d", (d) => {
            const spikeHeight = (d.count / maxVal) * 80;
            return `M${-xScale.bandwidth()! / 4},0 L0,${-spikeHeight} L${
              xScale.bandwidth()! / 4
            },0`;
          })
          .style("fill", (d) => d.color || "#777")
          .style("stroke", "#333")
          .style("stroke-width", "0.5px");

        g.selectAll(".label")
          .data(data)
          .enter()
          .append("text")
          .attr("class", "label")
          .attr("x", (d) => (xScale(d.type) ?? 0) + (xScale.bandwidth() ?? 0) / 2)
          .attr("y", (d) => yScale(d.count) - 5)
          .attr("text-anchor", "middle")
          .style("fill", "#333")
          .style("font-size", "10px")
          .text((d) => d.count);

        return container;
      },
      []
    );

    /**
     * HELPERS & EVENT HANDLERS
     */
    const flyToLocation = useCallback(
      (
        longitude: number,
        latitude: number,
        zoom: number,
        locationType?: LocationType
      ) => {
        if (!mapRef.current) return;
        if (isNaN(longitude) || isNaN(latitude)) {
          return;
        }
        setIsSpinning(false);
        const finalZoom = locationType ? getZoomLevelForLocation(locationType) : zoom;
        mapRef.current.flyTo({
          center: [longitude, latitude],
          zoom: finalZoom,
          essential: true,
          duration: 2000
        });
      },
      []
    );

    const handleFlyToInputLocation = async () => {
      setIsSpinning(false);
      const result = await geocodeLocation(inputLocation);
      if (result) {
        const { longitude, latitude, bbox, type } = result;
        setTimeout(() => {
          if (mapRef.current) {
            mapRef.current.resize();
            if (bbox) {
              highlightBbox(bbox, type || "locality");
            } else {
              flyToLocation(longitude, latitude, 6, type);
            }
          }
          setTimeout(() => {
            onLocationClick(inputLocation, type);
          }, 600);
        }, 100);
      }
    };

    const handleLocationButtonClick = async (locName: string) => {
      setSelectedLocation(locName);
      onLocationClick(locName, selectedEventType || undefined);
    };

    const toggleLayerVisibility = useCallback(
      (layerId: string, visibility: "visible" | "none") => {
        if (mapRef.current && mapRef.current.getLayer(layerId)) {
          mapRef.current.setLayoutProperty(layerId, "visibility", visibility);
        }
      },
      []
    );

    const highlightBbox = useCallback(
      (bbox: string[] | number[], locationType: LocationType = "locality", dynamicZoom?: number) => {
        if (!mapRef.current || !bbox || bbox.length !== 4) return;
        const numericBbox = bbox.map((coord) =>
          typeof coord === "string" ? parseFloat(coord) : coord
        );
        const maxZoom = dynamicZoom || getZoomLevelForLocation(locationType);

        if (mapRef.current.getLayer("bbox-fill")) {
          mapRef.current.removeLayer("bbox-fill");
        }
        if (mapRef.current.getLayer("bbox-outline")) {
          mapRef.current.removeLayer("bbox-outline");
        }
        if (mapRef.current.getSource("bbox")) {
          mapRef.current.removeSource("bbox");
        }

        const bboxPolygonData: GeoJSON.Feature<GeoJSON.Polygon> = {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [numericBbox[0], numericBbox[1]],
                [numericBbox[2], numericBbox[1]],
                [numericBbox[2], numericBbox[3]],
                [numericBbox[0], numericBbox[3]],
                [numericBbox[0], numericBbox[1]],
              ],
            ],
          },
          properties: {},
        };

        mapRef.current.addSource("bbox", {
          type: "geojson",
          data: bboxPolygonData, // Use the correctly typed variable
        });

        mapRef.current.addLayer({
          id: "bbox-fill",
          type: "fill",
          source: "bbox",
          paint: {
            "fill-color": "#000000",
            "fill-opacity": 0.1,
          },
        });

        mapRef.current.addLayer({
          id: "bbox-outline",
          type: "line",
          source: "bbox",
          paint: {
            "line-color": "#000000",
            "line-width": 2,
            "line-dasharray": [2, 2],
          },
        });

        mapRef.current.fitBounds(
          [
            [numericBbox[0], numericBbox[1]],
            [numericBbox[2], numericBbox[3]],
          ],
          {
            padding: 50,
            duration: 2000,
            maxZoom,
            minZoom: Math.max(1, maxZoom - 1.5),
          }
        );
        setCurrentBbox(numericBbox);
        if (onBboxChange) {
          onBboxChange(numericBbox);
        }
      },
      [onBboxChange]
    );

    // IMPERATIVE HANDLE
    useImperativeHandle(ref, () => ({
      zoomToLocation: (
        lat: number,
        lng: number,
        bbox?: string[] | number[],
        locationType: LocationType = "country",
        dynamicZoom?: number
      ) => {
        if (isNaN(lat) || isNaN(lng)) {
          return;
        }
        if (!mapRef.current) return;

        if (bbox && bbox.length === 4) {
          const numericBbox = bbox.map((coord) =>
            typeof coord === "string" ? parseFloat(coord) : coord
          );
          const calcZoom = calculateZoomLevel(numericBbox);

          if (mapRef.current.getLayer("bbox-fill")) {
            mapRef.current.removeLayer("bbox-fill");
          }
          if (mapRef.current.getLayer("bbox-outline")) {
            mapRef.current.removeLayer("bbox-outline");
          }
          if (mapRef.current.getSource("bbox")) {
            mapRef.current.removeSource("bbox");
          }

          mapRef.current.addSource("bbox", {
            type: "geojson",
            data: {
              type: "Feature",
              geometry: {
                type: "Polygon",
                coordinates: [
                  [
                    [numericBbox[0], numericBbox[1]],
                    [numericBbox[2], numericBbox[1]],
                    [numericBbox[2], numericBbox[3]],
                    [numericBbox[0], numericBbox[3]],
                    [numericBbox[0], numericBbox[1]],
                  ],
                ],
              },
              properties: {},
            },
          });

          mapRef.current.addLayer({
            id: "bbox-fill",
            type: "fill",
            source: "bbox",
            paint: {
              "fill-color": "#000000",
              "fill-opacity": 0.1,
            },
          });

          mapRef.current.addLayer({
            id: "bbox-outline",
            type: "line",
            source: "bbox",
            paint: {
              "line-color": "#000000",
              "line-width": 2,
              "line-dasharray": [2, 2],
            },
          });

          mapRef.current.fitBounds(
            [
              [numericBbox[0], numericBbox[1]],
              [numericBbox[2], numericBbox[3]],
            ],
            {
              padding: 100,
              duration: 2000,
              maxZoom: calcZoom,
              minZoom: Math.max(1, calcZoom - 1),
            }
          );
        } else {
          flyToLocation(lng, lat, dynamicZoom || 6, locationType);
        }
      },
    }));

    // Separate map initialization from theme changes
    useEffect(() => {
      if (!mapboxgl.accessToken) {
        mapboxgl.accessToken = 'pk.eyJ1IjoiamltdnciLCJhIjoiY20xd2U3Z2pqMGprdDJqczV2OXJtMTBoayJ9.hlSx0Nc19j_Z1NRgyX7HHg';
      }

      const styleSheet = document.createElement("style");
      styleSheet.textContent = styles;
      document.head.appendChild(styleSheet);

      if (!mapRef.current && mapContainerRef.current) {
        const mapStyle = theme === 'dark' 
          ? 'mapbox://styles/jimvw/cm466rsf0014101sibqumbyfs' 
          : 'mapbox://styles/jimvw/cm237n93v000601qp9tts27w9';

        mapRef.current = new mapboxgl.Map({
          container: mapContainerRef.current,
          style: mapStyle,
          projection: 'globe',
          center: [13.4, 52.5],
          zoom: 3.5,
          minZoom: 1
        });

        // Add missing image handler
        mapRef.current.on('styleimagemissing', (e) => {
          const id = e.id;
          if (eventTypes.some(eventType => eventType.icon === id)) {
            const currentTheme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
            const themePrefix = currentTheme === 'dark' ? '_light' : '_dark';
            const img = new Image();
            img.src = `/animations/maki-icons/${id}${themePrefix}.svg`;
            img.onload = () => {
              if (mapRef.current && !mapRef.current.hasImage(id)) {
                mapRef.current.addImage(id, img);
              }
            };
          }
        });

        mapRef.current.on('load', () => {
          setMapLoaded(true);
          addIconsToMap();
        });
      }

      return () => {
        if (mapRef.current) {
          mapRef.current.remove();
          mapRef.current = null;
        }
        styleSheet.remove();
      };
    }, []);

    // Handle theme changes separately
    useEffect(() => {
      if (mapRef.current && mapRef.current.loaded()) {
        const mapStyle = theme === 'dark' 
          ? 'mapbox://styles/jimvw/cm466rsf0014101sibqumbyfs' 
          : 'mapbox://styles/jimvw/cm237n93v000601qp9tts27w9';
        
        mapRef.current.setStyle(mapStyle);
        
        // Wait for style to load before re-adding icons, applying fog, and reloading GeoJSON
        mapRef.current.once('style.load', () => {
          addIconsToMap();
          setFogProperties(theme || 'dark');
          // Reset geojsonLoaded flag to trigger a reload
          setGeojsonLoaded(false);
          // Force reload GeoJSON data
          loadGeoJSONData();
        });

        // Add missing image handler with theme-specific icons
        mapRef.current.on('styleimagemissing', (e) => {
          const id = e.id;
          if (eventTypes.some(eventType => eventType.icon === id)) {
            const currentTheme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
            const themePrefix = currentTheme === 'dark' ? '_light' : '_dark';
            const img = new Image();
            img.src = `/animations/maki-icons/${id}${themePrefix}.svg`;
            img.onload = () => {
              if (mapRef.current && !mapRef.current.hasImage(id)) {
                mapRef.current.addImage(id, img);
              }
            };
          }
        });

      }
    }, [theme]);

    // MAP FOG HELPER
    const setFogProperties = (currentTheme: string) => {
      if (!mapRef.current) return;
      
      if (currentTheme === "dark") {
        mapRef.current.setFog({
          color: "rgba(30, 30, 30, 0.2)",
          "high-color": "rgba(10, 10, 10, 0.2)",
          "horizon-blend": 0.1,
          "space-color": "rgba(5, 5, 20, 0.2)",
          "star-intensity": 0.2,
        });
      } else {
        mapRef.current.setFog({
          color: "rgba(30, 30, 30, 1)",
          "high-color": "rgba(10, 10, 10, 1)",
          "horizon-blend": 0.1,
          "space-color": "rgba(5, 5, 20, 1)",
          "star-intensity": 0.2,
        });
      }
    };

    // Mouse move over map => show hovered boundaries
    useEffect(() => {
      if (!mapLoaded || !mapRef.current) return;
      mapRef.current.on("mousemove", (e) => {
        const features = mapRef.current?.queryRenderedFeatures(e.point, {
          layers: ["country-boundaries"],
        });
        if (features && features.length > 0) {
          setHoveredFeature(features[0].properties);
        } else {
          setHoveredFeature(null);
        }
      });
    }, [mapLoaded]);

    // If user picks coords from store => fly
    useEffect(() => {
      if (latitude !== null && longitude !== null) {
        flyToLocation(longitude, latitude, 6);
      }
    }, [longitude, latitude, flyToLocation]);

    // External event for setLocation from popups
    useEffect(() => {
      const handleSetLocation = (e: CustomEvent) => {
        onLocationClick(e.detail, e.detail.event_type);
      };
      window.addEventListener("setLocation", handleSetLocation as EventListener);
      return () => {
        window.removeEventListener("setLocation", handleSetLocation as EventListener);
      };
    }, [onLocationClick]);

    // External event for zoomToCluster from popups
    useEffect(() => {
      const handleZoomToCluster = (e: CustomEvent) => {
        if (!mapRef.current) return;
        
        const { lng, lat, zoom, locationName } = e.detail;
        
        // Validate coordinates
        if (isNaN(lng) || isNaN(lat)) {
          console.error('Invalid coordinates for cluster zoom:', { lng, lat });
          return;
        }
        
        // Fly to the cluster location
        mapRef.current.flyTo({
          center: [lng, lat],
          zoom: zoom
        });
        
        // After zooming, trigger the location click with a delay
        // to ensure the map has time to zoom
        if (locationName) {
          setTimeout(() => {
            onLocationClick(locationName);
          }, 500);
        }
      };
      
        window.addEventListener("zoomToCluster", handleZoomToCluster as EventListener);
      return () => {
        window.removeEventListener("zoomToCluster", handleZoomToCluster as EventListener);
      };
    }, [mapRef, onLocationClick]);

    // Route playback
    const [selectedRoute, setSelectedRoute] = useState<any>(null);
    const { data, fetchContents, fetchEntities } = useLocationData(null);

    const loadLocationData = useCallback(
      async (locationName: string) => {
        await fetchContents({ skip: 0 });
        await fetchEntities(locationName, 10, 20);
      },
      [fetchContents, fetchEntities]
    );

    function createPopupContent(locationName: string) {
      const container = document.createElement('div');
      container.className = 'popup-container';
      
      // Create location heading
      const heading = document.createElement('h3');
      heading.textContent = locationName;
      heading.className = 'popup-heading';
      container.appendChild(heading);
      
      // Create view details button
      const viewBtn = document.createElement('button');
      viewBtn.textContent = 'View Details';
      viewBtn.className = 'popup-button';
      viewBtn.setAttribute('data-location', locationName);
      container.appendChild(viewBtn);
      
      // If we have content related to this location, show it
      if (activeContents.length > 0) {
        const contentList = document.createElement('ul');
        contentList.className = 'popup-content-list';
        
        // Show up to 5 recent articles
        activeContents.slice(0, 5).forEach(content => {
          const item = document.createElement('li');
          const link = document.createElement('a');
          link.textContent = content.title || 'Untitled Article';
          link.className = 'popup-content-link';
          link.setAttribute('data-content-id', content.id || '');
          item.appendChild(link);
          contentList.appendChild(item);
        });
        
        container.appendChild(contentList);
      }
      
      return container;
    }

    const startRoute = useCallback(
      async (route) => {
        if (!mapRef.current) return;
        setIsSpinning(false);
        setIsRoutePlaying(true);

        for (const location of route.locations) {
          const { name, coordinates } = location;
          await loadLocationData(name);

          mapRef.current.flyTo({
            center: [coordinates[0], coordinates[1]],
            zoom: 5,
            speed: 0.5,
            curve: 1.42,
            easing: (t) => t * t * (3 - 2 * t),
            essential: true
          });
          await new Promise((resolve) => {
            mapRef.current!.once("moveend", resolve);
          });

          const popupContent = createPopupContent(name);
          const popup = new mapboxgl.Popup({
            closeButton: false,
            maxWidth: "none",
            className: "custom-popup-container route-popup",
          })
            .setLngLat(coordinates)
            .setHTML(popupContent.innerHTML)
            .addTo(mapRef.current);

          await new Promise((resolve) => setTimeout(resolve, 5000));
          popup.remove();
        }
        setIsRoutePlaying(false);
      },
      [loadLocationData]
    );

    // Spinning logic
    const spin = useCallback(() => {
      if (!mapRef.current || !isSpinning || isRoutePlaying) return;
      const rotationSpeed = 0.0115;
      const currentCenter = mapRef.current.getCenter();
      currentCenter.lng += rotationSpeed;
      // This is just for demonstration
      mapRef.current.setCenter([currentCenter.lng, currentCenter.lat]);
      spinningRef.current = requestAnimationFrame(spin);
    }, [isSpinning, isRoutePlaying]);

    useEffect(() => {
      if (isSpinning) {
        spin();
      } else if (spinningRef.current) {
        cancelAnimationFrame(spinningRef.current);
      }
      return () => {
        if (spinningRef.current) {
          cancelAnimationFrame(spinningRef.current);
        }
      };
    }, [isSpinning, spin]);

    /**
     * RENDER
     */
    const reloadGeoJSONData = useCallback(() => {
      // Force reload if needed
      loadGeoJSONData();
    }, [loadGeoJSONData]);

    // Keep toggling layers in sync
    useEffect(() => {
      if (!mapLoaded || !mapRef.current) return;
      eventTypes.forEach((et) => {
        toggleLayerVisibility(
          `clusters-${et.type}`,
          visibleLayers[et.type] ? "visible" : "none"
        );
        toggleLayerVisibility(
          `unclustered-point-${et.type}`,
          visibleLayers[et.type] ? "visible" : "none"
        );
        toggleLayerVisibility(
          `cluster-count-${et.type}`,
          visibleLayers[et.type] ? "visible" : "none"
        );
      });
    }, [mapLoaded, visibleLayers, eventTypes, toggleLayerVisibility]);

    // Optimize the useEffect that watches map loading conditions:
    useEffect(() => {
      if (!mapLoaded) {
        return; // Don't proceed until map is loaded
      }

      // Debounce data loading to prevent multiple rapid calls
      const loadTimer = setTimeout(() => {
        console.log(`Globe: MapLoaded: ${mapLoaded}, GeojsonLoaded: ${geojsonLoaded}, DataType: ${dataType}`);

        const shouldLoadArticles = dataType === 'articles' && !geojsonData;
        const shouldLoadEvents = dataType === 'events' && !eventGeojsonData;

        if (shouldLoadArticles || shouldLoadEvents) {
          console.log(`Globe: Loading data for ${dataType}...`);
          loadGeoJSONData(); // Calls store fetch actions
          setGeojsonLoaded(true); // Prevent re-triggering 
        } else if ((geojsonData || eventGeojsonData) && !geojsonLoaded) {
          console.log("Globe: Adding layers for existing data...");
          loadGeoJSONData(); // Add sources/layers without fetching
          setGeojsonLoaded(true);
        }
      }, 300); // 300ms debounce

      return () => clearTimeout(loadTimer);
    }, [mapLoaded, dataType, geojsonData, eventGeojsonData, geojsonLoaded]);

    // Create a function to format dates for ISO string
    // const formatDateForAPI = (date: Date | null): string | null => {
    //   if (!date) return null;
    //   return date.toISOString(); Removed as we have a new function
    // };

    // Add a function to clear date filters
    const clearDateFilters = () => {
      const { startDate: defaultStart, endDate: defaultEnd } = getDefaultDateRange();
      setStartDate(defaultStart);
      setEndDate(defaultEnd);
      setEventLimit(100);
      // Force reload data with cleared filters
      if (mapRef.current) {
        // Remove existing sources first
        eventTypes.forEach((eventType) => {
          const sourceId = `geojson-events-${eventType.type}`;
          if (mapRef.current?.getSource(sourceId)) {
            ["clusters-", "unclustered-point-", "cluster-count-"].forEach((prefix) => {
              const layerId = `${prefix}${eventType.type}`;
              if (mapRef.current?.getLayer(layerId)) {
                mapRef.current.removeLayer(layerId);
              }
            });
            mapRef.current.removeSource(sourceId);
          }
        });
        
        // Reload with cleared filters
        loadGeoJSONData();
      }
    };

    // Some extra styles
    const styles = `
      .custom-popup-container .mapboxgl-popup-content {
        background: none !important;
        padding: 0 !important;
        border-radius: 0.75rem;
        backdrop-filter: blur(3px);

      }
      .custom-popup-container .mapboxgl-popup-close-button {
        padding: 0.5rem;
        right: 0.75rem;
        top: -0.25rem;
        z-index: 10;
        color: var(--text-muted);
        transition: color 0.2s;
        background: none !important;
      }
      .custom-popup-container .mapboxgl-popup-close-button:hover {
        color: limegreen;
      }
      .custom-scrollbar {
        scrollbar-width: thin;
        scrollbar-color: var(--scrollbar-thumb) transparent;
      }
      .custom-scrollbar::-webkit-scrollbar {
        width: 0.5rem;
      }
      .custom-scrollbar::-webkit-scrollbar-track {
        background: transparent;
      }
      .custom-scrollbar::-webkit-scrollbar-thumb {
        background: var(--scrollbar-thumb);
        border-radius: 9999px;
      }
      .cluster-popup .mapboxgl-popup-content {
        max-height: 80vh;
        overflow-y: auto;
      }
      .cluster-popup {
        z-index: 5;
      }
      .hover-popup {
        z-index: 4;
      }
      .hover-popup .mapboxgl-popup-content,
      .spinning-popup .mapboxgl-popup-content {
        background: transparent !important;
        box-shadow: none !important;
      }
      .spinning-popup {
        z-index: 3;
        opacity: 0;
        animation: fadeInOut 5s forwards;
      }
      @keyframes fadeInOut {
        0% { opacity: 0; }
        10% { opacity: 1; }
        90% { opacity: 1; }
        100% { opacity: 0; }
      }
    `;

    useEffect(() => {
      if (!mapRef.current) return;

      // Immediately stop spinning on any interaction
      const disableSpin = () => {
        if (isSpinning) {
          setIsSpinning(false);
          if (spinningRef.current) {
            cancelAnimationFrame(spinningRef.current);
          }
        }
      };

      // Add listeners for all common map interaction events
      const events = ['mousedown', 'touchstart', 'dragstart', 'wheel', 'boxzoom'];
      events.forEach(event => {
        mapRef.current?.on(event, disableSpin);
      });

      // Cleanup
      return () => {
        events.forEach(event => {
          mapRef.current?.off(event, disableSpin);
        });
      };
    }, [isSpinning]);

    // Replace fetchGeoJsonData with store methods
    const fetchGeoJsonData = async () => {
      try {
        await fetchBaselineGeoJson(100);
        if (selectedEventType) {
          await fetchEventGeoJson(selectedEventType, undefined, undefined, 100);
        }
      } catch (err) {
        console.error('Error fetching GeoJSON data:', err);
      }
    };

    // Add event listeners for popup interactions
    useEffect(() => {
      const handlePopupClick = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        
        // Handle location button click
        if (target.matches('.popup-button[data-location]')) {
          const locationName = target.getAttribute('data-location');
          if (locationName) {
            handleLocationButtonClick(locationName);
          }
        }
        
        // Handle content link click
        if (target.matches('.popup-content-link[data-content-id]')) {
          const contentId = target.getAttribute('data-content-id');
          if (contentId) {
            setSelectedContentId(contentId); // Set the selected content ID
          }
        }
      };
      
      document.addEventListener('click', handlePopupClick);
      return () => document.removeEventListener('click', handlePopupClick);
    }, []);

    // Update layer visibility when visibleLayers changes
    useEffect(() => {
      if (!mapRef.current || !mapLoaded) return;
      
      // For each event type, toggle the visibility of its layers
      eventTypes.forEach((eventType) => {
        const isVisible = visibleLayers[eventType.type];
        const clusterLayerId = `clusters-${eventType.type}`;
        const pointLayerId = `unclustered-point-${eventType.type}`;
        
        // Toggle visibility of cluster layer
        if (mapRef.current?.getLayer(clusterLayerId)) {
          mapRef.current.setLayoutProperty(
            clusterLayerId,
            'visibility',
            isVisible ? 'visible' : 'none'
          );
        }
        
        // Toggle visibility of point layer
        if (mapRef.current?.getLayer(pointLayerId)) {
          mapRef.current.setLayoutProperty(
            pointLayerId,
            'visibility',
            isVisible ? 'visible' : 'none'
          );
        }
      });
    }, [visibleLayers, mapLoaded, eventTypes]);

    // Add CSS styles for popups
    useEffect(() => {
      // Create a style element
      const styleSheet = document.createElement("style");
      styleSheet.type = "text/css";
      styleSheet.id = "mapbox-popup-styles";
      
      // Add popup styles
      styleSheet.textContent = `
        /* Hover popup styles */
        .map-popup-hover {
          z-index: 10;
          pointer-events: none;
        }
        .map-popup-hover .mapboxgl-popup-content {
          background-color: rgba(255, 255, 255, 0.9);
          border-radius: 8px;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
          padding: 8px 12px;
          max-width: 250px;
          transition: all 0.2s ease;
        }
        .dark .map-popup-hover .mapboxgl-popup-content {
          background-color: rgba(30, 30, 30, 0.9);
          color: #fff;
        }
        
        /* Click popup styles */
        .map-popup-click {
          z-index: 20;
        }
        .map-popup-click .mapboxgl-popup-content {
          background-color: rgba(255, 255, 255, 0.95);
          border-radius: 12px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
          padding: 0;
          overflow: hidden;
          max-width: 350px;
        }
        .dark .map-popup-click .mapboxgl-popup-content {
          background-color: rgba(30, 30, 30, 0.95);
          color: #fff;
        }
        
        /* Popup button styles */
        .popup-view-btn {
          display: inline-block;
          padding: 4px 8px;
          background-color: rgba(59, 130, 246, 0.1);
          border-radius: 4px;
          transition: all 0.2s ease;
        }
        .popup-view-btn:hover {
          background-color: rgba(59, 130, 246, 0.2);
        }
        
        /* Custom scrollbar for popups */
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(0, 0, 0, 0.05);
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(0, 0, 0, 0.2);
          border-radius: 3px;
        }
        .dark .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2);
        }
      `;
      
      // Add the style element to the document head
      document.head.appendChild(styleSheet);
      
      // Clean up on unmount
      return () => {
        const existingStyle = document.getElementById("mapbox-popup-styles");
        if (existingStyle) {
          existingStyle.remove();
        }
      };
    }, []);

    // Keep track of the previously selected content ID for comparison
    const prevSelectedContentIdRef = useRef<string | null | undefined>(undefined);

    // Effect to update feature state based on selectedContentId
    useEffect(() => {
      // Only run if map is loaded, geojson is loaded, and selectedContentId has actually changed
      if (!mapRef.current || !mapLoaded || !geojsonLoaded || selectedContentId === prevSelectedContentIdRef.current) {
        // Update the ref even if we don't run the main logic
        prevSelectedContentIdRef.current = selectedContentId;
        return;
      }

      console.log(`Updating feature state for selectedContentId: ${selectedContentId} (previously: ${prevSelectedContentIdRef.current})`);
      prevSelectedContentIdRef.current = selectedContentId; // Update ref after check

      // Determine sources based on current data type
      const sourcesToUpdate = dataType === 'events' 
        ? eventTypes.map(et => `geojson-events-${et.type}`) 
        : ["opol-globe-articles"];

      let foundAndSelected = false;

      sourcesToUpdate.forEach(sourceId => {
        if (!mapRef.current?.getSource(sourceId)) {
          return; // Skip if source doesn't exist
        }
        
        try {
          const features = mapRef.current.querySourceFeatures(sourceId, {
            filter: ['!', ['has', 'point_count']]
          });
          
          features.forEach(feature => {
            if (feature.id === undefined) return;
            
            const contents = feature.properties?.contents;
            let isSelected = false;
            // Check if the *current* selectedContentId matches
            if (selectedContentId && Array.isArray(contents)) {
              isSelected = contents.some((content: any) => content.content_id === selectedContentId);
            }
            
            // Get current state to avoid unnecessary updates
            const currentState = mapRef.current?.getFeatureState({ source: sourceId, id: feature.id });
            
            // Always update the state for the *current* selection, but also clear old selections
            if (currentState?.selected !== isSelected) {
               mapRef.current?.setFeatureState(
                 { source: sourceId, id: feature.id },
                 { selected: isSelected }
               );
            }

            if (isSelected) {
              foundAndSelected = true;
            }
          });
        } catch (err) {
          // console.warn(`Error querying source ${sourceId} for feature state update:`, err);
        }
      });

      if (selectedContentId && !foundAndSelected) {
          console.log(`No map feature found or updated for content ID: ${selectedContentId}`);
      }

      // Also need to explicitly clear the state for the *previously* selected feature if it's different
      const prevSelectedId = prevSelectedContentIdRef.current;
      if (prevSelectedId && prevSelectedId !== selectedContentId) {
        // Find the feature corresponding to the previous ID and deselect it
        // This requires iterating through sources/features again, or a more optimized approach
        // For now, the current logic might cover it if the loop correctly sets `selected: false`
        // for features that no longer match the *new* selectedContentId. Let's monitor.
      }

    }, [selectedContentId, mapLoaded, geojsonLoaded, dataType, eventTypes]); // Keep eventTypes dependency for now as sources depend on it

    // Memoize the onFeatureClick handler passed to MapPopupManager
    const handleFeatureClick = useCallback((feature: mapboxgl.GeoJSONFeature, lngLat: mapboxgl.LngLat) => {
      const properties = feature.properties || {};
      const locationName = properties.name || properties.location_name || properties.name_en || 'Unknown Location';
      const eventType = properties.event_type; // Extract event type if available
      // console.log('MapPopupManager Click -> onLocationClick:', { locationName, eventType, properties });
      
      // Pass both location name and event type to the callback
      onLocationClick(locationName, eventType); 
    }, [onLocationClick]); // Dependency: only the function passed from parent

    // Memoize the layer IDs passed to MapPopupManager
    const memoizedLayerIds = useMemo(() => [
      'country-boundaries',
      ...(dataType === 'events' ? eventTypes
        .filter(et => visibleLayers[et.type])
        .flatMap(et => [`clusters-${et.type}`, `unclustered-point-${et.type}`])
        : ['clusters-articles', 'unclustered-point-articles']),
    ], [dataType, eventTypes, visibleLayers]); // Dependencies for layerIds

    // Add this inside the Globe component
    useEffect(() => {
      if (!mapContainerRef.current || !mapRef.current) return;
      
      const resizeObserver = new ResizeObserver(() => {
        mapRef.current?.resize();
        // Add slight delay to ensure layout stabilization
        setTimeout(() => mapRef.current?.resize(), 100);
      });

      resizeObserver.observe(mapContainerRef.current);
      return () => resizeObserver.disconnect();
    }, [mapLoaded]);

    return (
      <div style={{ position: "relative", height: "100%", width: "100%" }}>
        <div
          ref={mapContainerRef}
          className="map-container"
          style={{ height: "100%", padding: "10px", borderRadius: "12px" }}
        />
        {isLoading && (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              backgroundColor: "rgba(255, 255, 255, 0.5)",
              zIndex: 1000,
            }}
          >
            <div>
              <LottiePlaceholder />
            </div>
          </div>
        )}

        {/* Controls Popup */}
        <div className="absolute top-4 left-4 z-10">
          <Popover open={controlsOpen} onOpenChange={setControlsOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" className="p-2">
                <List className="h-5 w-5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-96 p-4 space-y-4 max-h-[80vh] overflow-y-auto custom-scrollbar">
              {/* Location Search */}
              <div className="space-y-2">
                <h3 className="font-semibold">Location Search</h3>
                <div className="flex gap-2">
                  <Input
                    className="flex-1"
                    type="text"
                    value={inputLocation}
                    onChange={(e) => setInputLocation(e.target.value)}
                    placeholder="Enter location"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleFlyToInputLocation();
                    }}
                  />
                  <Button 
                    variant="secondary" 
                    onClick={handleFlyToInputLocation} 
                    disabled={loading}
                  >
                    {loading ? "Loading..." : <Locate className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              {/* Quick Locations */}
              <div className="space-y-2">
                <h3 className="font-semibold">Quick Locations</h3>
                <div className="grid grid-cols-2 gap-2">
                  {locationButtons.map((locName) => (
                    <Button 
                      key={locName} 
                      variant="outline" 
                      onClick={() => handleLocationButtonClick(locName)}
                      className="truncate"
                    >
                      {locName}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Routes */}
              <div className="space-y-2">
                <h3 className="font-semibold">Routes</h3>
                <div className="flex gap-2">
                  <select
                    className="flex-1 p-2 rounded-md border border-input bg-background"
                    value={selectedRoute ? selectedRoute.name : ""}
                    onChange={(e) => {
                      const routeName = e.target.value;
                      const route = routes.find((r) => r.name === routeName);
                      setSelectedRoute(route);
                    }}
                  >
                    <option value="" disabled>Select a Route</option>
                    {routes.map((routeOption) => (
                      <option key={routeOption.name} value={routeOption.name}>
                        {routeOption.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    onClick={() => selectedRoute && startRoute(selectedRoute)}
                    disabled={!selectedRoute || isRoutePlaying}
                  >
                    {isRoutePlaying ? "Playing..." : "Start"}
                  </Button>
                </div>
              </div>

              {/* Map Controls */}
              <div className="space-y-2">
                <h3 className="font-semibold">Map Controls</h3>
                <div className="grid grid-cols-2 gap-2">
                  <Button 
                    variant="outline" 
                    onClick={() => setShowLegend(!showLegend)}
                  >
                    {showLegend ? "Hide Legend" : "Show Legend"}
                  </Button>
                  <Button 
                    variant="outline" 
                    onClick={() => loadGeoJSONData()}
                  >
                    Reload Data
                  </Button>
                  <Button
                    variant={isSpinning ? "secondary" : "outline"}
                    onClick={() => setIsSpinning(!isSpinning)}
                    disabled={isRoutePlaying}
                    className="col-span-2"
                  >
                    {isSpinning ? "Pause Rotation" : "Start Rotation"}
                  </Button>
                </div>
              </div>

              {/* Event Type Filters */}
              <div className="space-y-2">
                <h3 className="font-semibold">Event Filters</h3>
                <div className="grid grid-cols-2 gap-2">
                  {eventTypes.map((et) => (
                    <label key={et.type} className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        checked={visibleLayers[et.type]}
                        onChange={() =>
                          setVisibleLayers((prev) => ({
                            ...prev,
                            [et.type]: !prev[et.type],
                          }))
                        }
                        className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="text-sm">{et.type}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Date Range Filters - NEW SECTION */}
              <div className="space-y-2">
                <h3 className="font-semibold">Date Filters</h3>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-xs">Start Date</label>
                    <Input 
                      type="date" 
                      className="w-full"
                      value={startDate ? startDate.split('T')[0] : ''} // Display YYYY-MM-DD
                      onChange={(e) => {
                        const value = e.target.value; // YYYY-MM-DD
                        if (value) {
                          // Create date object from input, preserving local timezone date
                          // but setting time to start of day
                          const dateParts = value.split('-').map(Number);
                          const newStartDate = new Date(dateParts[0], dateParts[1] - 1, dateParts[2], 0, 0, 0);
                          setStartDate(formatDateForAPI(newStartDate));
                        } else {
                          setStartDate(null); // Allow clearing specific date
                        }
                      }}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs">End Date</label>
                    <Input 
                      type="date" 
                      className="w-full"
                      value={endDate ? endDate.split('T')[0] : ''} // Display YYYY-MM-DD
                      onChange={(e) => {
                        const value = e.target.value; // YYYY-MM-DD
                        if (value) {
                          // Create date object from input, preserving local timezone date
                          // but setting time to end of day
                          const dateParts = value.split('-').map(Number);
                          const newEndDate = new Date(dateParts[0], dateParts[1] - 1, dateParts[2], 23, 59, 59);
                          setEndDate(formatDateForAPI(newEndDate));
                        } else {
                          setEndDate(null); // Allow clearing specific date
                        }
                      }}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <label className="text-xs">Max Events: {eventLimit}</label>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="500"
                    step="10"
                    value={eventLimit}
                    onChange={(e) => setEventLimit(parseInt(e.target.value))}
                    className="w-full"
                  />
                </div>
                <div className="flex justify-between gap-2">
                  <Button 
                    variant="outline" 
                    className="w-full"
                    onClick={clearDateFilters}
                  >
                    Clear Filters
                  </Button>
                  <Button 
                    variant="secondary" 
                    className="w-full"
                    onClick={() => {
                      // Removes existing sources and loads data with current filters
                      loadGeoJSONData();
                    }}
                  >
                    Apply Filters
                  </Button>
                </div>
              </div>

              {/* Add this to the UI controls section where other toggles are located */}
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs">Data Source:</span>
                <div className="flex border rounded overflow-hidden">
                  <button
                    className={`px-2 py-1 text-xs ${dataType === "events" ? "bg-highlighted text-white" : "bg-transparent"}`}
                    onClick={() => setDataType("events")}
                  >
                    Events
                  </button>
                  <button
                    className={`px-2 py-1 text-xs ${dataType === "articles" ? "bg-highlighted text-white" : "bg-transparent"}`}
                    onClick={() => {
                      setDataType("articles");
                      // Reset event type selection when switching to articles
                      setSelectedEventType("");
                    }}
                  >
                    Any Articles
                  </button>
                </div>
              </div>

              {/* Only show event type selector when in events mode */}
              {dataType === "events" && (
                <div className="flex flex-col gap-1 mb-2">
                  {/* Existing event type selector */}
                </div>
              )}

              {/* Update reload button to work with current data type */}
              <button
                className="flex items-center justify-center px-2 py-1 text-xs bg-highlighted text-white rounded shadow hover:bg-highlighted-hover"
                disabled={isLoading}
                onClick={loadGeoJSONData}
              >
                <span>{isLoading ? "Loading..." : "Reload"}</span>
                {isLoading ? (
                  <span className="ml-1 animate-spin">⟳</span>
                ) : (
                  <span className="ml-1">⟳</span>
                )}
              </button>
            </PopoverContent>
          </Popover>
        </div>

        {showLegend && (
          <div>
            <MapLegend />
          </div>
        )}

        {storeError && (
          <div className="absolute top-4 right-4 bg-highlighted border border-red-400 text-red-700 px-4 py-2 rounded">
            {storeError.message}
          </div>
        )}

        {/* Add the MapPopupManager directly in the component tree */}
        {mapRef.current && mapLoaded && (
          <MapPopupManager
            map={mapRef.current}
            layerIds={memoizedLayerIds} // Use the memoized variable
            onFeatureClick={handleFeatureClick} // Pass the memoized handler
            debug={true}
          />
        )}

        {/* Add a refresh button */}
        <div className="absolute top-4 right-4 z-10">
          <button
            className="bg-white dark:bg-gray-800 text-gray-800 dark:text-white p-2 rounded-full shadow-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            onClick={() => loadGeoJSONData()}
            title="Refresh GeoJSON data"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </div>
    );
  }
);

Globe.displayName = "Globe";

export default Globe;
