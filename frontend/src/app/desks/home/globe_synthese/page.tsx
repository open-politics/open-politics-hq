// pages/GlobePage.tsx

'use client';
import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '@/components/ui/use-toast';
import Globe from '@/components/collection/globes/index';
import Search from '@/components/collection/unsorted/Search';
import LocationDetailPanel from '@/components/collection/unsorted/LocationDetailPanel';
import { useLayoutStore } from '@/zustand_stores/storeLayout';
import { useArticleTabNameStore } from '@/hooks/useArticleTabNameStore';
import { useGeoDataStore } from '@/zustand_stores/storeGeodata';

const GlobePage = () => {
  const [results, setResults] = useState(null);
  const [summary, setSummary] = useState<string>('');
  const [hasClicked, setHasClicked] = useState(false);
  const globeRef = useRef<any>(null);
  const [isVisible, setIsVisible] = useState(false);
  const { toast } = useToast();
  const { setActiveTab: layoutSetActiveTab } = useLayoutStore();
  const { setActiveTab: articleSetActiveTab } = useArticleTabNameStore();
  const { selectedLocation, setSelectedLocation } = useGeoDataStore();

  const handleLocationClick = (locationName: string) => {
    setSelectedLocation(locationName);
    setIsVisible(true);
    setHasClicked(true);

    // Switch to articles tab
    layoutSetActiveTab('articles');
    articleSetActiveTab('articles');
  };

  const handleSearch = (searchResults: any) => {
    setResults(searchResults);
    setIsVisible(true);
    setHasClicked(true);

    // Switch to summary tab
    layoutSetActiveTab('summary');
    articleSetActiveTab('summary');

    toast({
      title: 'Search Completed',
      description: 'Your search results are now available.',
    });
  };

  const toggleVisibility = () => {
    setIsVisible(false);
    setHasClicked(false);
    setSelectedLocation(null);
    layoutSetActiveTab('');
    setResults(null);
  };

  return (
    <div className="h-screen w-full relative">
      <div className="flex h-full flex-col">
        {/* Globe Section */}
        <div className="relative flex-1 h-full overflow-hidden">
          <div className="h-full">
            <Globe
              ref={globeRef}
              onLocationClick={handleLocationClick}
            />
          </div>

          {/* Search Bar */}
          <div className="absolute top-3/4 mb-2 left-1/2 transform -translate-x-1/2 w-3/4 z-20">
            <Search setResults={handleSearch} globeRef={globeRef} />
          </div>
        </div>

        {/* Details Panel */}
        <AnimatePresence>
          {hasClicked && (
            <motion.div
              className="fixed inset-0 z-50 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/85 flex justify-center items-center"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <motion.div
                className="bg-transparent rounded-lg w-full h-full overflow-hidden"
                initial={{ scale: 0.8 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0.8 }}
                transition={{ duration: 0.3 }}
              >
                <div className="overflow-y-auto h-full">
                  <LocationDetailPanel
                    location={selectedLocation}
                    isVisible={isVisible}
                    toggleVisibility={toggleVisibility}
                    results={results}
                    summary={summary}
                  />
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default GlobePage;
