import React, { useState, useEffect } from 'react';
import { IssueAreas } from './IssueAreas';
import { Button } from '@/components/ui/button';
import { CircleX } from 'lucide-react';

interface LocationDetailPanelProps {
  location: string | null;
  toggleVisibility: () => void;
  results: any; // Add appropriate type based on your data structure
  summary: string;
}

const LocationDetailPanel: React.FC<LocationDetailPanelProps> = ({
  location,
  toggleVisibility,
  results,
  summary,
}) => {
  const [searchTerm, setSearchTerm] = useState(location || '');

  // Update searchTerm when location changes
  useEffect(() => {
    setSearchTerm(location || '');
  }, [location]);

  return (
    <div className="h-full bg-background/90 backdrop-blur-lg supports-[backdrop-filter]:bg-background/90 flex flex-col relative z-50 rounded-lg p-2">
      <Button onClick={toggleVisibility} className="absolute top-2 right-2 size-8 p-2 z-10">
        <CircleX size={24} />
      </Button>
      <div className="flex-1 overflow-hidden md:mt-0">
        { (searchTerm || results) && ( 
          <IssueAreas 
            locationName={searchTerm || ''}
            results={results}
            summary={summary}
            includeSummary={true}
          />
        )}
      </div>
    </div>
  );
};

export default LocationDetailPanel;
