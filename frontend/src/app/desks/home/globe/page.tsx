'use client'
import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '@/components/ui/use-toast';
import { RefreshCcw } from 'lucide-react';
import Globe from '@/components/collection/unsorted/gGlobe';
import Search from '@/components/collection/unsorted/Search';
import LocationDetailPanel from '@/components/collection/unsorted/LocationDetailPanel';
import { BookmarkedArticles } from '@/components/collection/unsorted/BookMarkedArticles';
import { useLayoutStore } from '@/zustand_stores/storeLayout';
import { useArticleTabNameStore } from '@/hooks/useArticleTabNameStore';
import { Announcement } from '@/components/collection/unsorted/announcement';
import { FileText } from 'lucide-react';
import DocumentsOverlay from '@/components/collection/workspaces/documents/DocumentsOverlay';
import { useDocumentStore } from '@/zustand_stores/storeDocuments';

const GlobePage = () => {
  const geojsonUrl = '/api/v1/locations/geojson/';
  const [results, setResults] = useState(null);
  const [summary, setSummary] = useState<string>('');
  const [location, setLocation] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState<string>(new Date().toLocaleString());
  const [isBrowseMode, setIsBrowseMode] = useState(true);
  const [hasSearched, setHasSearched] = useState(false);
  const [hasClicked, setHasClicked] = useState(false);
  const globeRef = useRef<any>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [windowWidth, setWindowWidth] = useState<number>(0);
  const { toast } = useToast();
  const [locationKey, setLocationKey] = useState<number>(0);
  const [isMobile, setIsMobile] = useState(false);
  const { setActiveTab: layoutSetActiveTab } = useLayoutStore();
  const { setActiveTab: articleSetActiveTab } = useArticleTabNameStore();
  const [isLoading, setIsLoading] = useState(true);
  const [isDocumentsOpen, setIsDocumentsOpen] = useState(false);
  const { documents } = useDocumentStore();

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date().toLocaleString());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const handleEscKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsVisible(false);
        setHasClicked(false);
        setHasSearched(false); // Reset hasSearched when pressing Escape
      }
      if ((event.key === 'b' || event.key === 'B') && event.ctrlKey) {
        setIsVisible(true);
        setHasClicked(true);
      }
    };

    window.addEventListener('keydown', handleEscKey);

    return () => {
      window.removeEventListener('keydown', handleEscKey);
    };
  }, []);

  useEffect(() => {
    // Simulate loading time for geojson data
    const loadingTimer = setTimeout(() => {
      setIsLoading(false); // Set loading to false after 3.5 seconds
    }, 3500);

    return () => clearTimeout(loadingTimer);
  }, []);

  const handleLocationClick = async (locationName: string) => {
    setLocation(locationName);
    setIsVisible(true);
    setHasClicked(true);
    setLocationKey(prevKey => prevKey + 1);
    
    // Always switch to articles tab when clicking a location
    layoutSetActiveTab('articles');
    articleSetActiveTab('articles');
  };

  const handleSearch = (searchResults: any) => {
    setResults(searchResults);
    setIsBrowseMode(false);
    setHasSearched(true);
    setIsVisible(true);
    setHasClicked(true);
    
    // Explicitly set to summary tab after search
    layoutSetActiveTab('summary');
    articleSetActiveTab('summary');

    toast({
      title: "Search Completed",
      description: "Your search results are now available.",
    });

    if (isMobile) {
      setTimeout(() => {
        window.scrollTo({ top: 100, behavior: 'smooth' });
      }, 100);
    }
  };

  const handleLocationZoom = (latitude: number, longitude: number, locationName: string) => {
    if (globeRef.current) {
      globeRef.current.zoomToLocation(latitude, longitude, locationName);
    }
  };

  const handleSummary = (summary: string) => {
    setSummary(summary);
  };

  const toggleVisibility = () => {
    setIsVisible(false); // Hide the panel
    setHasClicked(false); // Reset the clicked state
    setLocation(null); // Optionally reset the location if needed
    layoutSetActiveTab(''); // Reset active tab if necessary
    setHasSearched(false); // Reset hasSearched to revert layout to single column
  };

  const handleReload = () => {
    window.location.reload(); // Reload the page
  };

  return (
    <div className="h-full w-full relative">
      {isLoading ? (
        <div className="flex items-center justify-center h-full">
          <div className="loader"></div>
        </div>
      ) : (
        <>
          {/* Main Content Area */}
          <div className="flex h-full flex-col md:flex-row">
            {/* Globe Section */}
            <div className="relative flex-1 overflow-hidden p-2 shadow-lg">
              <div className="h-full">
                <Globe
                  ref={globeRef}
                  geojsonUrl={geojsonUrl}
                  onLocationClick={handleLocationClick}
                />
              </div>
              
              {/* Search Bar */}
              <div className="fixed bottom-0 md:bottom-4 w-[100vw] md:max-w-[40vw] z-20 md:ml-2">
                <Search
                  setResults={handleSearch}
                  setSummary={handleSummary}
                  globeRef={globeRef}
                />
              </div>
            </div>
          </div>

          {/* Overlay Detail Panel */}
          <AnimatePresence>
            {hasClicked && isVisible && (
              <motion.div
                initial={{ opacity: 0 }}
                className="absolute top-0 bottom-0 -left-2 md:right-0 w-full sm:w-3/4 lg:w-1/2 md-0 md:m-4 z-50"
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
              >
                <motion.div
                  className="rounded-lg w-full h-full shadow-lg"
                  initial={{ scale: 0.9 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0.9 }}
                  transition={{ duration: 0.3 }}
                >
                  <div className="h-full">
                    <LocationDetailPanel
                      key={locationKey}
                      location={location}
                      toggleVisibility={toggleVisibility}
                      results={results}
                      summary={summary}
                    />
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Add the DocumentsOverlay component */}
          <DocumentsOverlay
            open={isDocumentsOpen}
            onClose={() => setIsDocumentsOpen(false)}
            onDocumentSelect={() => {}}
          />

          {/* Add a button to open the documents overlay */}
          <button
            onClick={() => setIsDocumentsOpen(true)}
            className="fixed bottom-4 right-4 p-3 bg-highlighted rounded-full shadow-lg transition-colors flex items-center gap-2"
          >
            <FileText className="w-6 h-6" />
            {documents.length > 0 && (
              <span className="bg-highlighted text-white text-xs px-1.5 py-0.5 rounded-full">
                {documents.length}
              </span>
            )}
          </button>
        </>
      )}
    </div>
  );
};

export default GlobePage;

<style jsx>{`
  .loader {
    border: 4px solid rgba(0, 0, 0, 0.1);
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border-left-color: #3498db;
    animation: spin 1s ease infinite;
  }

  @keyframes spin {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
  }
`}</style>