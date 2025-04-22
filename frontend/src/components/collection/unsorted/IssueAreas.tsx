import React, { useState, useMemo, useCallback, useEffect } from "react";
import { useLayoutStore } from '@/zustand_stores/storeLayout'; // Import Zustand store
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { CalendarDays } from 'lucide-react';
import { Table, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import EconomicDataChart from './chart';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useLocationData } from "@/hooks/useLocationData";
import DotLoader from 'react-spinners/DotLoader';
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import EntitiesView from "./EntitiesView";
import WikipediaView from './WikipediaView';
import ArticlesView from './ContentsView';
import DataTable from "./DataTable";
import Results from '@/components/collection/unsorted/Results';
import { useArticleTabNameStore } from '@/hooks/useArticleTabNameStore';
import axios from 'axios';
import Image from 'next/image';
import ContentsView from './ContentsView';
import { useGeoDataStore } from '@/zustand_stores/storeGeodata';

// Entity interface that matches the one expected by EntitiesView
interface Entity {
  id: string;
  name: string;
  entity_type: string;
  locations: any[];
  article_count?: number;
  total_frequency?: number;
  relevance_score?: number;
}

interface IssueAreasProps {
  locationName: string;
  results: any;
  summary: string;
  includeSummary: boolean;
  highlightedEventType?: string;
}

export function IssueAreas({ locationName, results, summary, includeSummary, highlightedEventType }: IssueAreasProps) {
  const { data, isLoading, error, fetchContents, resetContents, fetchEconomicData } = useLocationData(locationName);
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('all');
  const [selectedIndicators, setSelectedIndicators] = useState(['GDP', 'GDP_GROWTH']);
  const { toast } = useToast();
  const { activeTab, setActiveTab } = useArticleTabNameStore(); // Use Zustand store
  const [isMobile, setIsMobile] = useState(false);
  const [backgroundImage, setBackgroundImage] = useState<string | null>(null);
  const { activeContents, activeContentLoading, selectedContentId } = useGeoDataStore();

  // Fetch image from Wikipedia
  useEffect(() => {
    if (locationName) {
      axios.get(`https://en.wikipedia.org/api/rest_v1/page/summary/${locationName}`)
        .then(response => {
          const imageUrl = response.data.thumbnail?.source;
          if (imageUrl) {
            setBackgroundImage(imageUrl);
          }
        })
        .catch(error => {
          console.error('Error fetching image:', error);
        });
    }
  }, [locationName]);

  const filteredLegislativeData = useMemo(() => {
    if (!data?.legislativeData) return [];
    return data.legislativeData.filter(item => {
      const matchesStatus = statusFilter === 'all' || item.label === statusFilter;
      const itemDate = new Date(item.date);
      const now = new Date();
      const thirtyDaysAgo = new Date(now.setDate(now.getDate() - 30));
      const ninetyDaysAgo = new Date(now.setDate(now.getDate() - 90));
      const matchesDate = 
        dateFilter === 'all' ||
        (dateFilter === 'last30' && itemDate >= thirtyDaysAgo) ||
        (dateFilter === 'last90' && itemDate >= ninetyDaysAgo);
      return matchesStatus && matchesDate;
    });
  }, [data?.legislativeData, statusFilter, dateFilter]);

  const legislationColumns = useMemo<ColumnDef<any>[]>(
    () => [
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <div className="flex items-center">
            {row.original.status && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <span
                      className={`flex h-3 w-3 mr-2 rounded-full ${
                        row.original.label === "red"
                          ? "bg-red-500"
                          : row.original.label === "yellow"
                          ? "bg-yellow-500"
                          : row.original.label === "green"
                          ? "bg-green-500"
                          : "bg-gray-500"
                      }`}
                    />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{row.original.status}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        ),
      },
      {
        accessorKey: "law",
        header: "Law",
        cell: ({ row }) => (
          <HoverCard>
            <HoverCardTrigger asChild>
              <span className="cursor-pointer">
                {row.original.href ? (
                  <a 
                    href={row.original.href} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-inherit hover:underline"
                  >
                    {row.original.law}
                  </a>
                ) : (
                  row.original.law
                )}
              </span>
            </HoverCardTrigger>
            <HoverCardContent className="w-80">
              <div className="space-y-1">
                <h4 className="text-sm font-semibold">{row.original.law}</h4>
                <p className="text-sm">
                  Status: {row.original.status}
                </p>
                <p className="text-sm">
                  Initiative: {row.original.initiative}
                </p>
                <div className="flex items-center pt-2">
                  <CalendarDays className="mr-2 h-4 w-4 opacity-70" />
                  <span className="text-xs text-muted-foreground">
                    Date: {row.original.date}
                  </span>
                </div>
                <Button variant='outline'>
                  <a href={row.original.href} target="_blank" rel="noopener noreferrer">
                    View
                  </a>
                </Button>
              </div>
            </HoverCardContent>
          </HoverCard>
        ),
      },
      {
        accessorKey: "date",
        header: "Date",
      },
    ],
    []
  );

  const availableIndicators = useMemo(() => {
    if (!data?.economicData || data.economicData.length === 0) return [];
    return Object.keys(data.economicData[0]).filter(key => key !== 'name');
  }, [data?.economicData]);

  const toggleIndicator = useCallback((indicator: string) => {
    setSelectedIndicators(prev => 
      prev.includes(indicator)
        ? prev.filter(i => i !== indicator)
        : [...prev, indicator]
    );
  }, []);

  useEffect(() => {
    if (error.legislative || error.economic || error.leaderInfo || error.contents) {
      toast({
        title: "Error",
        description: "Failed to fetch some data. Please try again later.",
        variant: "destructive",
      });
    }
  }, [error, toast]);


  const handleFetchEconomicData = useCallback(() => {
    if (!data.economicData || data.economicData.length === 0) {
      fetchEconomicData();
    }
  }, [data.economicData, fetchEconomicData]);

  // Update the useEffect to only set initial tab state
  useEffect(() => {
    if (results?.tavilyResults && summary && !activeTab) {
      setActiveTab('summary');
    } else if (!activeTab) {
      setActiveTab('articles');
    }
  }, [results, summary, activeTab, setActiveTab]);

  // Add a check for showing summary content
  const showSummaryContent = results?.tavilyResults && summary;

  // Adapter function to convert fetchContents to the expected signature
  const handleFetchContents = useCallback((searchQuery: string) => {
    fetchContents({ skip: 0 });
  }, [fetchContents]);

  // Add this effect to handle when a specific content is selected
  useEffect(() => {
    if (selectedContentId) {
      // Automatically switch to the articles tab when a content is selected
      setActiveTab('articles');
    }
  }, [selectedContentId, setActiveTab]);

  return (
    <div className="h-full flex flex-col">
      <div className="flex justify-between mb-2 flex-shrink-0">
        <span className="text-green-500 font-medium ml-2">{locationName}</span>
      </div>
      <Tabs 
        value={activeTab} 
        onValueChange={(value) => {
          setActiveTab(value);
        }} 
        className="w-full flex flex-col flex-grow"
      >
        <TabsList className="flex-shrink-0 max-w-[80%] md:max-w-[calc(100%-60px)] overflow-x-auto flex justify-start scrollbar-hide bg-transparent">
          <TabsTrigger value="articles" className="scroll-snap-align-start">Articles</TabsTrigger>
          {data.locationMetadata.isOECDCountry && (
            <TabsTrigger 
              value="economic-data" 
              className="scroll-snap-align-start" 
              onClick={handleFetchEconomicData}
            >
              Economic Data
            </TabsTrigger>
          )}
          <TabsTrigger value="leader-info" className="scroll-snap-align-start">Entities</TabsTrigger>
          {data.locationMetadata.isLegislativeEnabled && (
            <TabsTrigger value="legislative" className="scroll-snap-align-start">
              Legislative
            </TabsTrigger>
          )}
          <TabsTrigger value="wikipedia" className="scroll-snap-align-start">Wikipedia</TabsTrigger>
          {showSummaryContent && (
            <TabsTrigger value="summary" className="scroll-snap-align-start">
              Summary
            </TabsTrigger>
          )}
        </TabsList>
        <div className="flex-grow overflow-y-auto scrollbar-hide mt-2">
          <TabsContent value="articles" className="">
            <Card className="h-auto w-full flex flex-col relative transition-transform duration-200 bg-transparent shadow-none border-none">
              <CardContent className="flex-grow p-4 px-1 pt-7 relative">
                {/* Image Section */}
                {backgroundImage && (
                  <div className="absolute -top-0 right-1 w-40 h-20">
                    <img 
                      src={backgroundImage} 
                      alt={locationName} 
                      className="w-full h-full object-cover rounded-md border border-gray-300 shadow-md" 
                    />
                  </div>
                )}
                {/* Articles Content */}
                <div className="">
                  <ContentsView 
                    locationName={locationName} 
                    contents={activeContents.length > 0 ? activeContents : data.contents}
                    isLoading={activeContentLoading || isLoading.contents}
                    error={error.contents}
                    fetchContents={handleFetchContents}
                    resetContents={resetContents}
                    highlightedEventType={highlightedEventType}
                    loadMore={() => fetchContents({ skip: data.contents.length })}
                    selectedContentId={selectedContentId}
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          {data.locationMetadata.isLegislativeEnabled && (
            <TabsContent value="legislative" className="">
              <Card className="bg-transparent shadow-none border-none">
                <CardHeader>
                  <CardTitle>Legislation</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex space-x-2">
                      <Select value={statusFilter} onValueChange={setStatusFilter}>
                        <SelectTrigger className="w-[180px]">
                          <SelectValue placeholder="Filter by status" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Statuses</SelectItem>
                          <SelectItem value="red">Red</SelectItem>
                          <SelectItem value="yellow">Yellow</SelectItem>
                          <SelectItem value="green">Green</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select value={dateFilter} onValueChange={setDateFilter}>
                        <SelectTrigger className="w-[180px]">
                          <SelectValue placeholder="Filter by date" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Time</SelectItem>
                          <SelectItem value="last30">Last 30 Days</SelectItem>
                          <SelectItem value="last90">Last 90 Days</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {isLoading.legislative || isLoading.entities || isLoading.leaderInfo || isLoading.articles ? (
                       <div className="flex flex-col items-center justify-center h-full">
                         <DotLoader color="#000" size={50} />
                         <p className="mt-4">Legislative data is loading...</p>
                       </div>
                    ) : error.legislative ? (
                      <p>No legislative data available for this location. Currently only available for Germany.</p>
                    ) : filteredLegislativeData.length > 0 ? (
                      <DataTable columns={legislationColumns} data={filteredLegislativeData} />
                    ) : (
                      <p>No legislative data available for this location. Currently only available for Germany.</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          )}
          <TabsContent value="economic-data" className="">
            <Card className="bg-transparent shadow-none border-none">
              <CardHeader>
                <CardTitle>Economic Data</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {isLoading.economic ? (
                  <div className="flex flex-col items-center justify-center h-full">
                    <DotLoader color="#000" size={50} />
                    <p className="mt-4">Economic data is loading...</p>
                  </div>
                ) : error.economic ? (
                  <p>Failed to load economic data.</p>
                ) : data?.economicData && data.economicData.length > 0 ? (
                  <>
                    <div className="mb-4">
                      <div className="flex flex-wrap gap-2">
                        {availableIndicators.map(indicator => (
                          <Button 
                            key={indicator}
                            variant={selectedIndicators.includes(indicator) ? "default" : "outline"}
                            onClick={() => toggleIndicator(indicator)}
                          >
                            {indicator}
                          </Button>
                        ))}
                      </div>
                    </div>
                    <EconomicDataChart data={data.economicData} selectedIndicators={selectedIndicators} />
                  </>
                ) : (
                  <Button onClick={handleFetchEconomicData}>Load Economic Data</Button>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="leader-info" className="">
            <Card className="bg-transparent shadow-none border-none">
              <CardHeader>
                <CardTitle>Entities</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading.leaderInfo || isLoading.entities ? (
                  <div className="flex flex-col items-center justify-center h-full">
                    <DotLoader color="#000" size={50} />
                    <p className="mt-4">Loading information...</p>
                  </div>
                ) : error.entities ? (
                  <p>Failed to load entity information.</p>
                ) : (
                  <EntitiesView 
                    leaderInfo={error.leaderInfo ? null : data.leaderInfo}
                    entities={data.entities as Entity[] | null} 
                  />
                )}
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="wikipedia" className="">
            <Card className="bg-transparent shadow-none border-none">
              <CardHeader>
                <CardTitle>Wikipedia</CardTitle>
              </CardHeader>
              <CardContent>
                <WikipediaView locationName={locationName} />
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="summary" className="">
            <Card className="bg-transparent shadow-none border-none">
              <CardHeader>
                <CardTitle>Summary</CardTitle>
              </CardHeader>
              <CardContent>
                {showSummaryContent ? (
                  <Results results={results} summary={summary} includeSummary={includeSummary} />
                ) : (
                  <p>No search results available. They will show up if you use the main search bar.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
