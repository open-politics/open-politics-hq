// @ts-ignore
import React, { useLayoutEffect, useRef, useState, useEffect, useImperativeHandle } from 'react';
import * as am5 from "@amcharts/amcharts5";
import * as am5map from "@amcharts/amcharts5/map";
import am5geodata_worldLow from "@amcharts/amcharts5-geodata/worldLow";
import am5themes_Animated from "@amcharts/amcharts5/themes/Animated";
import axios from 'axios';
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Compass, RotateCcw, Cog } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import am5themes_Material from "@amcharts/amcharts5/themes/Material";
import { Animations } from "@amcharts/amcharts5/.internal/core/util/Animation";
import { CountriesService } from 'src/client'; // Import the CountriesService
import { useToast } from "@/components/ui/use-toast"; // Import useToast
import { OpenAPI } from 'src/client';
import MapLeged from './MapLeged';
import { Locate } from 'lucide-react';
import { MapPin } from 'lucide-react';

interface GlobeProps {
  geojsonUrl: string;
  setArticleContent: (content: string) => void;
  onLocationClick: (location: string) => void;
  isBrowseMode: boolean;
  toggleMode: () => void;
  setLegislativeData: (data: any) => void;
  setEconomicData: (data: any) => void;
  onCountryZoom: (latitude: number, longitude: number, countryName: string) => void;
}

interface DataContext {
  contents: { title: string; url: string }[];
  name: string;
}

OpenAPI.BASE = process.env.NEXT_PUBLIC_API_BASE_URL || '';

const Globe = (
  {
    ref,
    geojsonUrl,
    setArticleContent,
    onLocationClick,
    isBrowseMode,
    toggleMode,
    setLegislativeData,
    setEconomicData,
    onCountryZoom
  }
) => {
  const chartRef = useRef<am5.Root | null>(null);
  const polygonSeriesRef = useRef<am5map.MapPolygonSeries | null>(null);
  const normalPointSeriesRef = useRef<am5map.MapPointSeries | null>(null);
  const eventsPointSeriesRef = useRef<am5map.MapPointSeries | null>(null);
  const [isClient, setIsClient] = useState(false);
  const [isRotating, setIsRotating] = useState(true);
  const rotationAnimationRef = useRef<any>(null);
  const chartInstanceRef = useRef<am5map.MapChart | null>(null);
  const [zoomLevel, setZoomLevel] = useState(0.1);
  const { toast } = useToast(); 
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [isLegendVisible, setLegendVisible] = useState(true);

  const initialRotationX = 15;
  const initialRotationY = 52.5; // Set to Berlin's latitude
  const initialZoomLevel = 1.4; 

  useEffect(() => {
    setIsClient(true);
  }, []);

  const startRotationAnimation = () => {
    if (chartInstanceRef.current) {
      const rotationAnimation = chartInstanceRef.current.animate({
        key: "rotationX",
        from: chartInstanceRef.current.get("rotationX"),
        to: chartInstanceRef.current.get("rotationX") + 360,
        duration: 30000,
        loops: Infinity,
      });
      rotationAnimationRef.current = rotationAnimation;
    }
  };

  const fetchGeoJSONEventsData = async (eventTypes: string[], retries = 3) => {
    try {
      const promises = eventTypes.map(eventType => {
        console.log(`Requesting GeoJSON data for event type: ${eventType}`);
        return axios.get(`/api/v1/locations/geojson_events`, {
          params: {
            event_type: eventType
          },
          validateStatus: (status) => status < 500 // Accept only 2xx responses
        });
      });
      const results = await Promise.all(promises);
      console.log('Received results:', results);
      results.forEach((result, index) => {
        const eventType = eventTypes[index];
        const eventSeries = eventSeriesMap.get(eventType);
        if (eventSeries) {
          eventSeries.data.setAll(result.data.features.map((feature: any) => ({
            geometry: {
              type: "Point",
              coordinates: [feature.geometry.coordinates[1], feature.geometry.coordinates[0]] // Swap coordinates here
            },
            name: feature.properties.name,
            contents: feature.properties.contents,
            contentCount: feature.properties.content_count,
            events: feature.properties.contents.events
          })));
        }
      });
    } catch (error) {
      console.error('Error fetching GeoJSON events data:', error);
      if (retries > 0) {
        toast({
          title: "Fetching data failed",
          description: `Retrying... (${retries} attempts left)`,
        });
        setTimeout(() => fetchGeoJSONEventsData(eventTypes, retries - 1), 2000); 
      } else {
        toast({
          title: "Error",
          description: "Failed to fetch GeoJSON events data. Please try refreshing the page.",
          variant: "destructive",
        });
      }
    }
  };
  

  useLayoutEffect(() => {
    if (!isClient) return;
  
    const root = am5.Root.new("chartdiv", {
      useSafeResolution: false,
      tapToActivate: true,
      tapToActivateTimeout: 3000,
    });
  
    chartRef.current = root;
  
    root.setThemes([
      am5themes_Animated.new(root)
    ]);
  
    const chart = root.container.children.push(
      am5map.MapChart.new(root, {
        panX: "rotateX",
        panY: "rotateY",
        projection: am5map.geoOrthographic(),
        homeZoomLevel: initialZoomLevel,
        wheelY: "zoom",
        centerMapOnZoomOut: true,
        // maxPanOut: 0
      })
    );
    chartInstanceRef.current = chart;
  
    const backgroundSeries = chart.series.push(
      am5map.MapPolygonSeries.new(root, {})
    );
    backgroundSeries.mapPolygons.template.setAll({
      fill: am5.color(0xDCDCDC),
      fillOpacity: 0.05,
      stroke: am5.color(0x1e90ff),
      strokeWidth: 0.2,
      blur: 0.2,
    });
    backgroundSeries.data.push({
      geometry: am5map.getGeoRectangle(90, 180, -90, -180),
  
    });
  
    const polygonSeries = chart.series.push(
      am5map.MapPolygonSeries.new(root, {
        geoJSON: am5geodata_worldLow,
      })
    );
    polygonSeriesRef.current = polygonSeries;
  
    // Create separate point series for normal and events GeoJSON data
    const normalPointSeries = chart.series.push(
      am5map.MapPointSeries.new(root, {
        autoScale: true,
      })
    );
    normalPointSeriesRef.current = normalPointSeries;
  
    const event_types = [
      { type: "Elections", emoji: "🗳️", color: "#4CAF50" }, // Darker Green
      { type: "Protests", emoji: "✊", color: "#2196F3" }, // Darker Blue
      { type: "Economic", emoji: "💰", color: "#FF9800" }, // Darker Orange
      // { type: "Legal", emoji: "⚖️", color: "#FFFF00" }, // Yellow
      { type: "Social", emoji: "👥", color: "#E91E63" }, // Darker Pink
      { type: "Crisis", emoji: "🚨", color: "#F44336" }, // Darker Red
      { type: "War", emoji: "⚔️", color: "#FF5722" }, // Darker Orange-Red
      { type: "Peace", emoji: "☮️", color: "#9C27B0" }, // Darker Purple
      // { type: "Diplomacy", emoji: "🤝", color: "#008000" }, // Dark Green
      // { type: "Technology", emoji: "💻", color: "#FFC0CB" }, // Pink
      // { type: "Science", emoji: "🔬", color: "#A52A2A" }, // Brown
      // { type: "Culture", emoji: "🎨", color: "#FFD700" }, // Gold
      // { type: "Sports", emoji: "⚽", color: "#000000" }  // Black
  ];
  
    const eventSeriesMap = new Map<string, am5map.MapPointSeries>();
  
    event_types.forEach(event => {
      const eventSeries = chart.series.push(
        am5map.MapPointSeries.new(root, {
          autoScale: true,
          adjustRotation: true,
        })
      );
    
      eventSeries.bullets.push(function() {
        // Create a container to hold the label and background
        const container = am5.Container.new(root, {
          interactive: true,
          setStateOnChildren: true,
          width: 5, // Adjust as needed
          height: 5, // Adjust as needed
        });

        // Add a transparent background to capture pointer events
        const background = container.children.push(am5.Rectangle.new(root, {
          width: 1,
          height: 2,
          fill: am5.color(0xffffff),
          fillOpacity: 0, 
          strokeOpacity: 0, 
          shadowBlur: 0.2,
          tooltipText: "Location: {name}\nEvent: " + event.type,
          centerX: am5.p50,
          centerY: am5.p50,
          dx: event.type === "Elections" ? 1.9:
              event.type === "Protests" ? 2.8 :
              event.type === "Economic" ? 3.6 :
              event.type === "Social" ? 4.8 :
              event.type === "Crisis" ? 6.1 :
              event.type === "War" ? 8.1 : 1, // Different dx values for each event type
        }));

        // Add the label
        const label = container.children.push(am5.Label.new(root, {
          text: event.type === "Elections" ? "X" :
                event.type === "Protests" ? "\/" :
                event.type === "Economic" ? "$" :
                event.type === "Social" ? "O" :
                event.type === "Crisis" ? "!!" :
                event.type === "War" ? "<>" : "[…]",
          fontSize: 2, // Increased font size for better visibility
          fill: am5.color(event.color), // Use specific color for each event
          centerX: am5.p50,
          centerY: am5.p50,
          textAlign: "center",
          dx: event.type === "Elections" ? 1.9 :
              event.type === "Protests" ? 2.8 :
              event.type === "Economic" ? 3.6 :
              event.type === "Social" ? 4.8 :
              event.type === "Crisis" ? 6.1 :
              event.type === "War" ? 8.1 : 1, // Different dx values for each event type
        }));

        // Set populateText to true if using data placeholders
        label.set("populateText", true);

        // Create and configure the tooltip
        const tooltip = am5.Tooltip.new(root, {
          pointerOrientation: "down", // Adjust as needed (e.g., "left", "right", "up")
          position: "relative", // Adjust as needed (e.g., "absolute", "relative")
          getFillFromSprite: false,
          getStrokeFromSprite: true,
          autoTextColor: true,
        });

        // Event handling for click
        container.events.on("click", function(ev) {
          const dataItem = ev.target.dataItem as am5.DataItem<DataContext>;
          const contents = dataItem.dataContext.contents;
          const contentDetails = contents.map((content: any) => 
            `<a href="${content.url}" target="_blank">${content.title}</a>`
          ).join('<hr style="margin: 10px 0; border: 0; border-top: 1px solid #ccc;">');
          const content = `<div>Contents for location: <strong>${dataItem.dataContext.name}</strong><br/>${contentDetails}</div>`;
          setArticleContent(content);
          onLocationClick(dataItem.dataContext.name);
        });

        // Event handling for hover
        container.events.on("pointerover", function() {
          label.set("fill", am5.color(0x0000ff));
        });

        container.events.on("pointerout", function() {
          label.set("fill", am5.color(event.color));
        });

        return am5.Bullet.new(root, {
          sprite: container,
        });
      });
    
      eventSeriesMap.set(event.type, eventSeries);
    });
  
    const fetchGeoJSONData = async (retries = 3) => {
      try {
        const response = await axios.get('/api/v1/locations/geojson/');
        const data = response.data;
        console.log('GeoJSON data fetched successfully:', data);
        normalPointSeries.data.setAll(data.features.map((feature: any) => ({
          geometry: {
            type: "Point",
            coordinates: [feature.geometry.coordinates[1], feature.geometry.coordinates[0]] // Swap coordinates here
          },
          name: feature.properties.name,
          contents: feature.properties.contents,
          contentCount: feature.properties.content_count,
          events: feature.properties.contents.events
        })));
      } catch (error) {
        console.error('Error fetching GeoJSON data:', error);
        if (retries > 0) {
          toast({
            title: "Fetching data failed",
            description: `Retrying... (${retries} attempts left)`,
          });
          setTimeout(() => fetchGeoJSONData(retries - 1), 2000); 
        } else {
          toast({
            title: "Error",
            description: "Failed to fetch GeoJSON data. Please try refreshing the page.",
            variant: "destructive",
          });
        }
      }
    };
  
    const fetchGeoJSONEventsData = async (eventTypes: string[], retries = 3) => {
      try {
        const promises = eventTypes.map(eventType => {
          console.log(`Requesting GeoJSON data for event type: ${eventType}`);
          return axios.get(`/api/v1/locations/geojson_events`, {
            params: {
              event_type: eventType
            },
            validateStatus: (status) => status < 500 // Accept only 2xx responses
          });
        });
        const results = await Promise.all(promises);
        console.log('Received results:', results);
        results.forEach((result, index) => {
          const eventType = eventTypes[index];
          const eventSeries = eventSeriesMap.get(eventType);
          if (eventSeries) {
            eventSeries.data.setAll(result.data.features.map((feature: any) => ({
              geometry: {
                type: "Point",
                coordinates: [feature.geometry.coordinates[1], feature.geometry.coordinates[0]] // Swap coordinates here
              },
              name: feature.properties.name,
              contents: feature.properties.contents,
              contentCount: feature.properties.content_count,
              events: feature.properties.contents.events
            })));
          }
        });
      } catch (error) {
        console.error('Error fetching GeoJSON events data:', error);
        if (retries > 0) {
          toast({
            title: "Fetching data failed",
            description: `Retrying... (${retries} attempts left)`,
          });
          setTimeout(() => fetchGeoJSONEventsData(eventTypes, retries - 1), 2000); 
        } else {
          toast({
            title: "Error",
            description: "Failed to fetch GeoJSON events data. Please try refreshing the page.",
            variant: "destructive",
          });
        }
      }
    };
    
  
    fetchGeoJSONData();
    fetchGeoJSONEventsData(event_types.map(event => event.type));
  
    normalPointSeries.bullets.push(function() {
      const circle = am5.Circle.new(root, { // Changed from am5.Label to am5.Circle
        radius: 0.8, // Set a radius for the circle
        fill: am5.color(0xff0000), // Red color
        fillOpacity: 0.65, // 0.75 opacity
        tooltipText: "{name}\n{contents[0].title}",
        centerX: am5.p50,
        centerY: am5.p50,
      });
  
      circle.events.on("click", function(ev) {
        const dataItem = ev.target.dataItem as am5.DataItem<DataContext>;
        const contents = dataItem.dataContext.contents;
        const contentDetails = contents.map((content: any) => `<a href="${content.url}" target="_blank">${content.title}</a>`).join('<hr style="margin: 10px 0; border: 0; border-top: 1px solid #ccc;">');
        const content = `<div>Contents for location: <strong>${dataItem.dataContext.name}</strong><br/>${contentDetails}</div>`;
        setArticleContent(content);
        onLocationClick(dataItem.dataContext.name);
      });
  
      circle.states.create("hover", {
        fill: am5.color(0x0000ff),
        fillOpacity: 1,
        tooltipText: "{name}\n{contents[0].title}",
      });
  
      return am5.Bullet.new(root, {
        sprite: circle
      });
    });
  
    polygonSeries.mapPolygons.template.setAll({
      tooltipText: "{name}",
      toggleKey: "active",
      interactive: true,
      fill: am5.color(0xADD8E6), // Changed to light blue
      fillOpacity: 0.95, // Adjusted opacity for a techy effect
      stroke: am5.color(0x0e1a36), 
      strokeWidth: 0.45,
    });
  
    polygonSeries.mapPolygons.template.states.create("hover", {
      fill: am5.color(0x1E40AF),
    });
  
    polygonSeries.mapPolygons.template.states.create("active", {
      fill: am5.color(0x38BDF8),
    });
  
    let previousPolygon: am5map.MapPolygon | null = null;
  
    polygonSeries.mapPolygons.template.on("active", async (active, target) => {
      if (!target) return;
  
      if (previousPolygon && previousPolygon !== target) {
        previousPolygon.set("active", false);
      }
      if (target.get("active")) {
        const centroid = target.geoCentroid();
        if (centroid) {
          chart.animate({ key: "rotationX", to: -centroid.longitude, duration: 1500, easing: am5.ease.inOut(am5.ease.cubic) });
          chart.animate({ key: "rotationY", to: -centroid.latitude, duration: 1500, easing: am5.ease.inOut(am5.ease.cubic) });
        }

  
          // chart.animate({ 
          //   key: "rotationX", 
          //   to: -centroid.longitude, 
          //   duration: 1500, 
          //   easing: am5.ease.inOut(am5.ease.cubic) 
          // });
          // chart.animate({ 
          //   key: "rotationY", 
          //   to: -centroid.latitude, 
          //   duration: 1500, 
          //   easing: am5.ease.inOut(am5.ease.cubic) 
          // });
          // chart.animate({ 
          //   key: "zoomLevel", 
          //   to: targetZoom, 
          //   duration: 1500, 
          //   easing: am5.ease.inOut(am5.ease.cubic) 
          // });
        // }
  
        const locationName = target.dataItem?.dataContext?.name;
        if (centroid && locationName) {
          await handleLocationSelection(centroid.latitude, centroid.longitude, locationName);
        }
      }
      previousPolygon = target;
    });
  
    polygonSeries.events.on("datavalidated", function() {
      chart.goHome();
    });
  
    startRotationAnimation();
  
    return () => {
      root.dispose();
    };
  }, [isClient]);

  useImperativeHandle(ref, () => ({
    loadGeoJSONEvents: (eventType: string) => {
      fetchGeoJSONEventsData([eventType]);
    },
    zoomToLocation: (latitude: number, longitude: number, countryName: string) => {
      handleCountryZoom(latitude, longitude, countryName);
    }
  }));

  const handleCountryZoom = (latitude: number, longitude: number, countryName: string) => {
    if (chartInstanceRef.current) {
      chartInstanceRef.current.animate({ key: "rotationX", to: -longitude, duration: 1500, easing: am5.ease.inOut(am5.ease.cubic) });
      chartInstanceRef.current.animate({ key: "rotationY", to: -latitude, duration: 1500, easing: am5.ease.inOut(am5.ease.cubic) });
      // chartInstanceRef.current.zoomToGeoPoint({ latitude, longitude }, 1.5);
      if (rotationAnimationRef.current) {
        rotationAnimationRef.current.stop();
      }
    }
  };

  const fetchWikipediaContent = async (countryName: string) => {
    try {
      const response = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${countryName}`);
      const data = await response.json();
      return data.extract ? `<div><strong>Wikipedia</strong><br>${data.extract}</div>` : `<div><strong>${countryName}</strong>: No information available.</div>`;
    } catch (error) {
      return `<div><strong>${countryName}</strong>: Error fetching information.</div>`;
    }
  };

  const handleLocationSelection = async (latitude, longitude, locationName) => {
    const content = await fetchWikipediaContent(locationName);
    setArticleContent(content);
    onLocationClick(locationName);
    handleCountryZoom(latitude, longitude, locationName);
    
    const legislativeDataUrl = `/api/v1/locations/legislation/${locationName}`;
    try {
      const legislativeResponse = await axios.get(legislativeDataUrl);
      setLegislativeData(legislativeResponse.data);
    } catch (error) {}

    // const economicDataUrl = `/api/v1/locations/econ_data/${locationName}`;
    // try {
    //   const economicResponse = await axios.get(economicDataUrl);
    //   setEconomicData(economicResponse.data);
    // } catch (error) {}
  };

  const handlePlayPause = () => {
    if (rotationAnimationRef.current) {
      if (isRotating) {
        rotationAnimationRef.current.pause();
      } else {
        rotationAnimationRef.current.play();
      }
      setIsRotating(!isRotating);
    } else {
      startRotationAnimation();
      setIsRotating(true);
    }
  };

  useEffect(() => {
    if (selectedEvents.length > 0) {
      fetchGeoJSONEventsData(selectedEvents);
    }
  }, [selectedEvents]);

  const handleEventChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const { value, checked } = event.target;
    setSelectedEvents(prev =>
      checked ? [...prev, value] : prev.filter(eventType => eventType !== value)
    );
  };

  const handleHome = () => {
    if (chartInstanceRef.current) {
      if (rotationAnimationRef.current) {
        rotationAnimationRef.current.stop();
      }
      chartInstanceRef.current.animate({ key: "rotationX", to: 0, duration: 1500, easing: am5.ease.inOut(am5.ease.cubic) });
      chartInstanceRef.current.animate({ key: "rotationY", to: 0, duration: 1500, easing: am5.ease.inOut(am5.ease.cubic) });
      chartInstanceRef.current.zoomToGeoPoint({ latitude: 0, longitude: 0 }, initialZoomLevel);
      setTimeout(() => {
        if (isRotating) {
          startRotationAnimation();
        }
      }, 1600);
    }
  };

  const handleResume = () => {
    if (chartInstanceRef.current) {
      chartInstanceRef.current.goHome();
      if (rotationAnimationRef.current) {
        rotationAnimationRef.current.stop();
      }
      setTimeout(() => {
        if (isRotating) {
          startRotationAnimation();
        }
      }, 1600);
    }
  };

  const handleZoomChange = (value: number[]) => {
    const zoomValue = value[0];
    setZoomLevel(zoomValue);
    if (chartInstanceRef.current) {
      chartInstanceRef.current.zoomToGeoPoint({ latitude: initialRotationY, longitude: initialRotationX }, zoomValue);
    }
  };

  const getWindowWidth = () => {
    if (typeof window !== 'undefined') {
      return window.innerWidth;
    }
    return 0;
  };

  if (!isClient) return null;

  return (
    <div className="relative flex flex-col items-center">
      <div id="chartdiv" className="w-full h-96 sm:h-128 mt-16 relative z-0">
          <div className="absolute top-0 right-0 z-20 w-full">
            <Button 
              className="text-pink-400 w-14 h-12" 
              variant="outline" 
              onClick={() => setLegendVisible(prev => !prev)}
            >
              <div className="relative">
                <MapPin className="w-6 h-6" />
              </div>
            </Button>
            {!isLegendVisible && (
              <div className="absolute left-0 mt-2 shadow-lg rounded-lg p-4 bg-transparent backdrop-blur-lg">
                <MapLeged />
              </div>
            )}
          </div>


        <Popover>
          <PopoverTrigger asChild>
            <Button className="bg-background absolute bottom-0 left-0 w-14 h-12 z-20 rounded-tl-none rounded-bl-none rounded-tr-md rounded-br-md" variant="outline">
              <div className="relative">
                <Cog className="text-gray-800 dark:text-gray-200 hover:text-gray-600 dark:hover:text-gray-400 transition-colors duration-200" />
              </div>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="flex flex-col items-center">
            <Button className='mt-2 w-full' variant="outline" onClick={handleHome} title="Reset Globe Position">
              <RotateCcw className={`${getWindowWidth() <= 768 ? "w-4 h-4" : "w-6 h-6"}`} />
              <span className="ml-2">Reset View</span>
            </Button>
            <Button className='mt-2 w-full' variant="outline" onClick={handleResume} title="Resume Globe Rotation">
              <Compass className={`${getWindowWidth() <= 768 ? "w-4 h-4" : "w-6 h-6"}`} />
              <span className="ml-2">Resume Rotation</span>
            </Button>
            <div className="flex items-center mt-2 w-full justify-center">
              <span className="text-white bg-transparent mr-2">Zoom:</span>
              <Slider
                value={[zoomLevel]}
                onValueChange={handleZoomChange}
                min={0.4}
                max={3}
                step={0.35}
                className="w-full"
              />
              <span className="text-white bg-transparent ml-2">-  +</span>
            </div>
            <div className="flex flex-col items-start mt-2 w-full">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  value="Elections"
                  onChange={handleEventChange}
                  className="mr-2"
                />
                Elections
              </label>
              <label className="flex items-center">
                <input
                  type="checkbox"
                  value="Protests"
                  onChange={handleEventChange}
                  className="mr-2"
                />
                Protests
              </label>
              {/* Add more checkboxes as needed */}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
};

export default Globe;