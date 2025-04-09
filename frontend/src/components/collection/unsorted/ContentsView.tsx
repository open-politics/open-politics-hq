import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ContentCard } from './ContentCard';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import DotLoader from 'react-spinners/DotLoader';
import { useBookMarkStore } from '@/zustand_stores/storeBookmark';
import { addDays, format } from "date-fns";
import { DateRange } from "react-day-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { 
  CalendarDays, 
  Loader2, 
  FileDown, 
  Filter, 
  X, 
  Plus, 
  Info, 
  HelpCircle,
  Search,
  SlidersHorizontal,
  CheckSquare,
  Square,
  FolderOpen,
  FolderDown,
  BrainCircuit
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ClassifiableContent, ClassificationScheme } from '@/lib/classification/types';
import { useWorkspaceStore } from '@/zustand_stores/storeWorkspace';
import { ContentCardProps } from './ContentCard';
import { useClassificationSystem } from '@/hooks/useClassificationSystem';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/use-toast";

interface ContentsViewProps {
  locationName: string;
  contents: any[];
  isLoading: boolean;
  error: Error | null | unknown;
  fetchContents: (searchQuery: string) => void;
  loadMore: () => void;
  resetContents: () => void;
  highlightedEventType?: string;
  selectedContentId?: string | null;
}

interface ContentEvaluation {
  content_id: string;
  rhetoric: string;
  sociocultural_interest: number | null;
  global_political_impact: number | null;
  regional_political_impact: number | null;
  global_economic_impact: number | null;
  regional_economic_impact: number | null;
  event_type: string | null;
  event_subtype: string | null;
  keywords: string[] | null;
  categories: string[] | null;
}

interface Content {
  id: string;
  title: string | null;
  text_content: string | null;
  url: string;
  source: string | null;
  insertion_date: string;
  content_type?: string;
  content_language?: string | null;
  author?: string | null;
  publication_date?: string | null;
  top_image?: string | null;
  evaluation?: ContentEvaluation | null;
  entities?: any[];
  tags?: string[];
  [key: string]: any; 
}

interface ContentFilter {
  field: string;
  operator: 'equals' | 'contains' | 'range';
  value: any;
}

export function ContentsView({
  locationName,
  contents = [],
  isLoading,
  error,
  fetchContents,
  loadMore,
  resetContents,
  highlightedEventType,
  selectedContentId,
}: ContentsViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: addDays(new Date(), -365),
    to: new Date()
  });
  const [sortBy, setSortBy] = useState<string>("date");
  const { bookmarks, addBookmark, removeBookmark } = useBookMarkStore();
  const [selectedEventType, setSelectedEventType] = useState(highlightedEventType || 'all');
  const [selectedContents, setSelectedContents] = useState<Content[]>([]);
  const [selectedSchemeId, setSelectedSchemeId] = useState<number | null>(null);
  const { activeWorkspace } = useWorkspaceStore();
  
  // Use the consolidated classification system hook to load schemes once
  const { 
    schemes,
    isLoadingSchemes,
    isClassifying, 
    batchClassify,
    loadSchemes
  } = useClassificationSystem({
    autoLoadSchemes: true, // Load schemes automatically on mount
    useCache: true // Use caching to prevent redundant API calls
  });

  const [filters, setFilters] = useState<ContentFilter[]>([]);
  const [viewMode, setViewMode] = useState<'browse' | 'select'>('browse');
  const [selectionMode, setSelectionMode] = useState<'classification' | 'import'>('classification');
  const [showFilters, setShowFilters] = useState(false);
  const [activeTab, setActiveTab] = useState<'search' | 'filters' | 'actions'>('search');

  const selectedContentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelectedEventType(highlightedEventType || 'all');
  }, [highlightedEventType]);

  useEffect(() => {
    console.log('Full content example:', contents[0]);
    console.log('Available fields:', contents[0] ? Object.keys(contents[0]) : []);
  }, [contents]);

  useEffect(() => {
    if (selectedContents.length > 0 && activeTab !== 'actions') {
      setActiveTab('actions');
    }
  }, [selectedContents.length]);

  useEffect(() => {
    if (activeWorkspace?.uid) {
      // Load schemes using the new hook
      loadSchemes();
    }
  }, [activeWorkspace?.uid, loadSchemes]);

  useEffect(() => {
    if (selectedContentId && selectedContentRef.current) {
      selectedContentRef.current.scrollIntoView({ 
        behavior: 'smooth', 
        block: 'center' 
      });
    }
  }, [selectedContentId]);

  const getContentDate = (content: any): Date | null => {
    const dateString = content.publication_date || content.insertion_date || content.created_at;
    if (!dateString) return null;
    
    const parsed = new Date(dateString);
    return isNaN(parsed.getTime()) ? null : parsed;
  };

  const filteredAndSortedContents = contents
    .filter(content => {
      const matchesSearch = !searchQuery || 
        content.title?.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesEventType = selectedEventType === 'all' || 
        content.evaluation?.event_type === selectedEventType;

      if (!dateRange?.from || !dateRange?.to) return matchesSearch && matchesEventType;

      const contentDate = getContentDate(content);
      if (!contentDate) return matchesSearch && matchesEventType;

      const isInDateRange = contentDate >= dateRange.from && 
                            contentDate <= addDays(dateRange.to, 1);

      return matchesSearch && isInDateRange && matchesEventType;
    })
    .sort((a, b) => {
      const dateA = getContentDate(a);
      const dateB = getContentDate(b);

      if (!dateA && !dateB) return 0;
      if (!dateA) return 1;
      if (!dateB) return -1;

      return dateB.getTime() - dateA.getTime();
    });

  const groupedContents = useMemo(() => {
    return filteredAndSortedContents.reduce((groups: Record<string, any[]>, content) => {
      const date = getContentDate(content);
      const dateKey = date 
        ? format(date, "MMM dd, yyyy")
        : "Recent";
      
      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(content);
      return groups;
    }, {});
  }, [filteredAndSortedContents]);

  const availableEventTypes = useMemo(() => {
    const types = new Set<string>();
    contents.forEach((content) => {
      if (content.evaluation && content.evaluation.event_type) {
        types.add(content.evaluation.event_type);
      }
    });
    return Array.from(types);
  }, [contents]);

  const handleSearch = () => {
    resetContents();
    fetchContents(searchQuery);
  };

  const handleBookmarkAll = () => {
    contents.forEach(content => {
      addBookmark({
        id: content.id,
        title: content.title,
        text_content: content.text_content?.slice(0, 350) || '',
        url: content.url,
        source: content.source,
        insertion_date: content.insertion_date,
        content_type: content.content_type || 'article',
        content_language: content.content_language || null,
        author: content.author || null,
        publication_date: content.publication_date || null,
        top_image: content.top_image || null,
        entities: content.entities || [],
        tags: content.tags || [],
        evaluation: content.evaluation || null,
      }, activeWorkspace?.uid);
    });
  };

  const handleUnbookmarkAll = () => {
    contents.forEach(content => {
      removeBookmark(content.url);
    });
  };

  const allBookmarked = contents.every(content => bookmarks.some(bookmark => bookmark.url === content.url));

  const handleDatePreset = (days: number) => {
    setDateRange({
      from: addDays(new Date(), -days),
      to: new Date()
    });
  };

  const handleDateRangeChange = (newDateRange: DateRange | undefined) => {
    setDateRange(newDateRange);
    resetContents();
    fetchContents(searchQuery);
  };

  const toggleContentSelection = (content: Content) => {
    if (selectedContents.some(c => c.url === content.url)) {
      setSelectedContents(selectedContents.filter(c => c.url !== content.url));
    } else {
      setSelectedContents([...selectedContents, content]);
      
      if (viewMode !== 'select') {
        setViewMode('select');
      }
    }
  };

  const handleBatchClassify = async () => {
    if (!selectedSchemeId || selectedContents.length === 0) {
      return;
    }

    const classifiableContents: ClassifiableContent[] = selectedContents.map(content => {
      let contentId = 0;
      try {
        if (content.id) {
          const parsed = parseInt(content.id);
          if (!isNaN(parsed) && parsed > 0) {
            contentId = parsed;
          }
        }
      } catch (e) {
        console.warn(`Invalid content ID: ${content.id}, will create new document`);
      }

      return {
        id: contentId,
        title: content.title || 'Untitled Content',
        text_content: content.text_content || '',
        url: content.url || '',
        source: content.source || '',
        content_type: content.content_type || 'article',
        insertion_date: content.insertion_date || new Date().toISOString(),
        author: content.author || null,
        publication_date: content.publication_date || null,
        top_image: content.top_image || null
      };
    });
    
    console.log(`Starting batch classification of ${classifiableContents.length} items with scheme ID ${selectedSchemeId}`);
    
    try {
      // Generate a unique run name with timestamp for better tracking
      const runName = `Batch classification - ${new Date().toLocaleString()}`;
      
      // Use the batchClassify method from the hook
      const results = await batchClassify(
        classifiableContents,
        selectedSchemeId,
        runName
      );
      
      console.log(`Batch classification completed with ${results.length} results`);
      
      // Show a more detailed success message
      toast({
        title: "Classification Complete",
        description: `Successfully classified ${results.length} of ${classifiableContents.length} items with run name: "${runName}"`,
        variant: "default",
      });
      
      // If we have results, clear the selections and notify the user they can view the results
      if (results.length > 0) {
        clearAllSelections();
        
        // Add a second toast with instructions on how to view the results
        toast({
          title: "View Classification Results",
          description: "You can view the classification results by opening each content item or using the Classification Results page.",
          variant: "default",
          duration: 5000,
        });
      }
    } catch (error: any) {
      console.error("Error during batch classification:", error);
      
      toast({
        title: "Classification Failed",
        description: error instanceof Error ? error.message : "An unknown error occurred during classification.",
        variant: "destructive",
      });
    }
  };

  const handleBulkImport = async () => {
    if (selectedContents.length === 0) return;
    
    const importingContents = [...selectedContents];
    
    for (const content of importingContents) {
      const formattedTags = Array.isArray(content.tags) 
        ? content.tags.map(tag => {
            if (typeof tag === 'string') {
              return { id: tag, name: tag };
            }
            return tag;
          })
        : [];
      
      const formattedEvaluation = content.evaluation 
        ? {
            content_id: content.evaluation.content_id || content.id,
            rhetoric: content.evaluation.rhetoric || '',
            sociocultural_interest: content.evaluation.sociocultural_interest !== undefined 
              ? content.evaluation.sociocultural_interest 
              : null,
            global_political_impact: content.evaluation.global_political_impact !== undefined 
              ? content.evaluation.global_political_impact 
              : null,
            regional_political_impact: content.evaluation.regional_political_impact !== undefined 
              ? content.evaluation.regional_political_impact 
              : null,
            global_economic_impact: content.evaluation.global_economic_impact !== undefined 
              ? content.evaluation.global_economic_impact 
              : null,
            regional_economic_impact: content.evaluation.regional_economic_impact !== undefined 
              ? content.evaluation.regional_economic_impact 
              : null,
            event_type: content.evaluation.event_type || null,
            event_subtype: content.evaluation.event_subtype || null,
            keywords: content.evaluation.keywords || null,
            categories: content.evaluation.categories || null
          } as ContentEvaluation
        : null;
      
      await addBookmark({
        id: content.id,
        title: content.title,
        text_content: content.text_content?.slice(0, 350) || '',
        url: content.url,
        source: content.source,
        insertion_date: content.insertion_date,
        content_type: content.content_type || 'article',
        content_language: content.content_language || null,
        author: content.author || null,
        publication_date: content.publication_date || null,
        top_image: content.top_image || null,
        entities: content.entities || [],
        tags: formattedTags,
        evaluation: formattedEvaluation,
      }, activeWorkspace?.uid);
    }
    
    setSelectedContents([]);
  };

  const selectAllVisible = () => {
    setSelectedContents(filteredAndSortedContents);
  };

  const clearAllSelections = () => {
    setSelectedContents([]);
  };

  const addFilter = () => {
    setFilters([...filters, { field: 'title', operator: 'contains', value: '' }]);
  };

  const updateFilter = (index: number, filter: ContentFilter) => {
    const newFilters = [...filters];
    newFilters[index] = filter;
    setFilters(newFilters);
  };

  const removeFilter = (index: number) => {
    setFilters(filters.filter((_, i) => i !== index));
  };

  const applyFilters = (contents: Content[]) => {
    if (filters.length === 0) return contents;
    
    return contents.filter(content => {
      return filters.every(filter => {
        const value = content[filter.field];
        
        switch (filter.operator) {
          case 'equals':
            return value === filter.value;
          case 'contains':
            return typeof value === 'string' && value.toLowerCase().includes(filter.value.toLowerCase());
          case 'range':
            if (Array.isArray(filter.value) && filter.value.length === 2) {
              const [min, max] = filter.value;
              return value >= min && value <= max;
            }
            return true;
          default:
            return true;
        }
      });
    });
  };

  const filteredContents = useMemo(() => {
    return applyFilters(filteredAndSortedContents);
  }, [filteredAndSortedContents, filters]);

  const displayContents = useMemo(() => {
    if (showFilters) {
      return filteredContents;
    }
    return filteredAndSortedContents;
  }, [showFilters, filteredContents, filteredAndSortedContents]);

  if (error) {
    return <div className="text-red-500">{(error instanceof Error ? error.message : 'An unknown error occurred') as React.ReactNode}</div>;
  }

  return (
    <div className="space-y-4 flex flex-col h-full">
      <svg width="0" height="0" className="absolute">
        <linearGradient id="shimmer" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#7AEFFF" />
          <stop offset="50%" stopColor="#7CFF7A" />
          <stop offset="100%" stopColor="#FEEC90" />
        </linearGradient>
      </svg>
      
      <div className="flex items-center justify-between mb-4">
        {/* <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">{locationName}</h2>
          
        </div> */}
        
        <div className="flex items-center gap-2">
          {selectedContents.length > 0 && (
            <Badge variant="secondary" className="flex items-center gap-1">
              <CheckSquare className="h-4 w-4" />
              <span>{selectedContents.length} selected</span>
              <Button 
                variant="ghost" 
                size="icon"
                className="h-5 w-5 ml-1 p-0"
                onClick={clearAllSelections}
              >
                <X className="h-3 w-3" />
              </Button>
            </Badge>
          )}
          
            <Badge variant="outline" className="ml-2">
              {contents.length} items
            </Badge>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon">
                  <HelpCircle className="h-5 w-5 text-muted-foreground" />
                </Button>
              </TooltipTrigger>
              <TooltipContent className="max-w-[300px]">
                <div className="space-y-2">
                  <h4 className="font-medium">Content Management</h4>
                  <p className="text-sm">
                    Browse, filter, and select content for classification or import to your workspace.
                  </p>
                  <ul className="text-xs space-y-1 mt-2">
                    <li className="flex items-center gap-1">
                      <Search className="h-3 w-3 inline" />
                      <span><strong>Search:</strong> Find specific content</span>
                    </li>
                    <li className="flex items-center gap-1">
                      <Filter className="h-3 w-3 inline" />
                      <span><strong>Filters:</strong> Apply advanced filtering</span>
                    </li>
                    <li className="flex items-center gap-1">
                      <SlidersHorizontal className="h-3 w-3 inline" />
                      <span><strong>Actions:</strong> Classify or import content</span>
                    </li>
                  </ul>
                </div>
              </TooltipContent>
            </Tooltip>
        </div>
      </div>
      
      <div className="border rounded-lg bg-card mb-4 overflow-hidden">
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'search' | 'filters' | 'actions')} className="w-full">
          <div className="flex items-center justify-between px-4 py-2 bg-muted/10 border-b">
            <TabsList className="bg-transparent">
              <TabsTrigger value="search" className="data-[state=active]:bg-background">
                <Search className="h-4 w-4 mr-2" />
                Search
              </TabsTrigger>
              <TabsTrigger value="filters" className="data-[state=active]:bg-background">
                <Filter className="h-4 w-4 mr-2" />
                Filters
              </TabsTrigger>
              <TabsTrigger value="actions" className="data-[state=active]:bg-background">
                <SlidersHorizontal className="h-4 w-4 mr-2" />
                Actions
              </TabsTrigger>
            </TabsList>
            
            <div className="flex items-center gap-2">
              <Button 
                variant="outline" 
                size="sm"
                className="flex items-center gap-1"
                onClick={selectAllVisible}
                disabled={filteredContents.length === 0}
              >
                <CheckSquare className="h-3 w-3" />
                <span className="text-xs">Select All</span>
              </Button>
              
              {selectedContents.length > 0 && (
                <Button 
                  variant="ghost" 
                  size="sm"
                  className="flex items-center gap-1"
                  onClick={clearAllSelections}
                >
                  <X className="h-3 w-3" />
                  <span className="text-xs">Clear</span>
                </Button>
              )}
            </div>
          </div>
          
          <TabsContent value="search" className="p-4 space-y-4">
            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center gap-2">
                <Search className="h-4 w-4 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={`Search ${locationName}`}
                  className="flex-1"
                />
              </div>
              <Button 
                variant="default" 
                onClick={() => {
                  resetContents();
                  fetchContents(searchQuery);
                }}
              >
                Search
              </Button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Date Range</label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleDateRangeChange({
                      from: addDays(new Date(), -3),
                      to: new Date()
                    })}
                  >
                    Last 3 days
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleDateRangeChange({
                      from: addDays(new Date(), -7),
                      to: new Date()
                    })}
                  >
                    Last 7 days
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleDateRangeChange({
                      from: addDays(new Date(), -30),
                      to: new Date()
                    })}
                  >
                    Last month
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleDateRangeChange(undefined)}
                  >
                    All
                  </Button>
                </div>
                
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2 mt-2"
                    >
                      <CalendarDays className="h-4 w-4" />
                      <span>
                        {dateRange?.from ? (
                          dateRange.to ? (
                            <>
                              {format(dateRange.from, "MMM dd, yyyy")} - {format(dateRange.to, "MMM dd, yyyy")}
                            </>
                          ) : (
                            format(dateRange.from, "MMM dd, yyyy")
                          )
                        ) : (
                          "Select date range"
                        )}
                      </span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="range"
                      defaultMonth={dateRange?.from}
                      selected={dateRange}
                      onSelect={handleDateRangeChange}
                      numberOfMonths={2}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              
              <div className="space-y-2">
                <label className="text-sm font-medium">Sort & Filter</label>
                <div className="flex flex-col gap-2">
                  <Select
                    value={selectedEventType}
                    onValueChange={(value) => {
                      setSelectedEventType(value);
                      resetContents();
                      fetchContents(searchQuery);
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <div className="flex items-center gap-2">
                        <BrainCircuit className="h-4 w-4" />
                        <span>{selectedEventType === 'all' ? 'All Event Types' : selectedEventType}</span>
                      </div>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Event Types</SelectItem>
                      {availableEventTypes.map((eventType) => (
                        <SelectItem key={eventType} value={eventType}>
                          {eventType}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  
                  <Select
                    value={sortBy}
                    onValueChange={setSortBy}
                  >
                    <SelectTrigger className="w-full">
                      <div className="flex items-center gap-2">
                        <SlidersHorizontal className="h-4 w-4" />
                        <span>Sort by: {sortBy}</span>
                      </div>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="date">Date</SelectItem>
                      <SelectItem value="title">Title</SelectItem>
                      <SelectItem value="source">Source</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </TabsContent>
          
          <TabsContent value="filters" className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <Filter className="h-4 w-4" />
                <span>Advanced Filters</span>
              </h3>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="max-w-xs">
                      Filter content based on different criteria. Content will be shown only if it matches all filters.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            {filters.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <Filter className="h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">No filters added yet</p>
                <Button onClick={addFilter} variant="outline" size="sm" className="mt-2">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Filter
                </Button>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  {filters.map((filter, index) => (
                    <div key={index} className="flex gap-2 items-center flex-wrap p-2 border rounded-md bg-muted/10">
                      <Select
                        value={filter.field}
                        onValueChange={value => updateFilter(index, { ...filter, field: value })}
                      >
                        <SelectTrigger className="w-[180px]">
                          <SelectValue placeholder="Select field" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="title">Title</SelectItem>
                          <SelectItem value="text_content">Content</SelectItem>
                          <SelectItem value="source">Source</SelectItem>
                          <SelectItem value="author">Author</SelectItem>
                        </SelectContent>
                      </Select>

                      <Select
                        value={filter.operator}
                        onValueChange={value => updateFilter(index, { 
                          ...filter, 
                          operator: value as 'equals' | 'contains' | 'range',
                          value: value === 'range' ? [0, 100] : ''
                        })}
                      >
                        <SelectTrigger className="w-[120px]">
                          <SelectValue placeholder="Operator" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="equals">Equals</SelectItem>
                          <SelectItem value="contains">Contains</SelectItem>
                          <SelectItem value="range">Range</SelectItem>
                        </SelectContent>
                      </Select>

                      {filter.operator === 'range' ? (
                        <div className="flex gap-2">
                          <Input
                            type="number"
                            value={Array.isArray(filter.value) ? filter.value[0] || '' : ''}
                            onChange={e => updateFilter(index, {
                              ...filter,
                              value: [parseFloat(e.target.value) || 0, Array.isArray(filter.value) ? filter.value[1] || 0 : 0]
                            })}
                            className="w-[100px]"
                            placeholder="Min"
                          />
                          <Input
                            type="number"
                            value={Array.isArray(filter.value) ? filter.value[1] || '' : ''}
                            onChange={e => updateFilter(index, {
                              ...filter,
                              value: [Array.isArray(filter.value) ? filter.value[0] || 0 : 0, parseFloat(e.target.value) || 0]
                            })}
                            className="w-[100px]"
                            placeholder="Max"
                          />
                        </div>
                      ) : (
                        <Input
                          value={filter.value || ''}
                          onChange={e => updateFilter(index, { 
                            ...filter, 
                            value: e.target.value 
                          })}
                          className="flex-1"
                          placeholder={filter.operator === 'contains' ? "Search text..." : "Value"}
                        />
                      )}

                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeFilter(index)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between pt-2">
                  <Button onClick={addFilter} variant="outline" size="sm">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Filter
                  </Button>
                  
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">
                      {filteredContents.length} items match filters
                    </Badge>
                    <Button 
                      variant="default" 
                      size="sm"
                      onClick={selectAllVisible}
                      disabled={filteredContents.length === 0}
                    >
                      Select All Matching
                    </Button>
                  </div>
                </div>
              </>
            )}
          </TabsContent>
          
          <TabsContent value="actions" className="p-4 space-y-4">
            {selectedContents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <CheckSquare className="h-10 w-10 text-muted-foreground mb-3" />
                <h3 className="text-base font-medium">No items selected</h3>
                <p className="text-sm text-muted-foreground mt-1 max-w-md">
                  Select items from the list below to classify or import them to your workspace.
                </p>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="mt-4"
                  onClick={selectAllVisible}
                  disabled={filteredContents.length === 0}
                >
                  <CheckSquare className="h-4 w-4 mr-2" />
                  Select All Items
                </Button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium flex items-center gap-2">
                      <BrainCircuit className="h-4 w-4" />
                      <span>Classification</span>
                    </h3>
                    <div className="p-3 border rounded-md bg-muted/5">
                      <div className="space-y-3">
                        <Select
                          value={selectedSchemeId?.toString() || ''}
                          onValueChange={(value) => setSelectedSchemeId(parseInt(value))}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select classification scheme" />
                          </SelectTrigger>
                          <SelectContent>
                            {schemes.map((scheme) => (
                              <SelectItem key={scheme.id} value={scheme.id.toString()}>
                                {scheme.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        
                        <Button
                          className="w-full bg-gradient-to-r from-[#7AEFFF] via-[#7CFF7A] to-[#FEEC90] hover:opacity-90 text-black"
                          onClick={handleBatchClassify}
                          disabled={!selectedSchemeId || isClassifying || selectedContents.length === 0}
                        >
                          {isClassifying ? (
                            <div className="flex items-center">
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              Classifying...
                            </div>
                          ) : (
                            <div className="flex items-center">
                              <BrainCircuit className="h-4 w-4 mr-2" />
                              Classify {selectedContents.length} Items
                            </div>
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium flex items-center gap-2">
                      <FolderDown className="h-4 w-4" />
                      <span>Workspace Import</span>
                    </h3>
                    <div className="p-3 border rounded-md bg-muted/5">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm">Current workspace:</span>
                          <Badge variant="outline">{activeWorkspace?.name || 'None'}</Badge>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-2">
                          <Button 
                            variant="outline" 
                            className="w-full"
                            onClick={handleBulkImport}
                            disabled={selectedContents.length === 0}
                          >
                            <FolderDown className="h-4 w-4 mr-2" />
                            Import Selected
                          </Button>
                          
                          <Button 
                            variant={allBookmarked ? "destructive" : "outline"}
                            className="w-full"
                            onClick={allBookmarked ? handleUnbookmarkAll : handleBookmarkAll}
                          >
                            {allBookmarked ? (
                              <>
                                <X className="h-4 w-4 mr-2" />
                                Remove All
                              </>
                            ) : (
                              <>
                                <FolderDown className="h-4 w-4 mr-2" />
                                Import All
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="mt-4 pt-4 border-t">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-medium">Selected Items ({selectedContents.length})</h4>
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={clearAllSelections}
                    >
                      Clear Selection
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2 max-h-[150px] overflow-y-auto p-2 border rounded-md bg-muted/5">
                    {selectedContents.map((content) => (
                      <div 
                        key={content.url} 
                        className="flex items-center gap-2 bg-muted/20 rounded-md px-3 py-1 text-sm"
                      >
                        <span className="font-medium truncate max-w-[200px]">
                          {content.title || 'Untitled'}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 p-0"
                          onClick={() => toggleContentSelection(content)}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>
      

      {isLoading && contents.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12">
          <DotLoader color="#000" size={40} />
          <p className="mt-4 text-muted-foreground">Loading content...</p>
        </div>
      )}
      
      {!isLoading && contents.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <FileDown className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">No content found</h3>
          <p className="text-muted-foreground mt-2 max-w-md">
            Try adjusting your search query or filters to find content.
          </p>
        </div>
      )}
      
      {contents.length > 0 && (
        <div className="flex-grow">
          {displayContents.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-8 border rounded-lg bg-muted/5">
              <Info className="h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-muted-foreground">No contents found matching your criteria.</p>
              {showFilters && filters.length > 0 && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="mt-4"
                  onClick={() => setFilters([])}
                >
                  Clear Filters
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {Object.entries(
                showFilters 
                  ? { "Filtered Results": displayContents } 
                  : groupedContents
              ).map(([date, groupContents]) => (
                <div key={date} className="space-y-2">
                  <h2 className="text-lg font-medium sticky top-0 bg-background/80 backdrop-blur-sm p-2 z-10">
                    {date}
                  </h2>
                  <div className="grid grid-cols-1 gap-4">
                    {(groupContents as Content[]).map((content: Content) => (
                      <div 
                        key={content.url} 
                        ref={content.id === selectedContentId ? selectedContentRef : null}
                        className="relative group"
                      >
                        <div 
                          className={cn(
                            "absolute top-2 left-2 z-30 p-1.5 rounded-md transition-all",
                            selectedContents.some(c => c.url === content.url) 
                              ? selectionMode === 'classification'
                                ? "bg-gradient-to-r from-[#7AEFFF]/30 via-[#7CFF7A]/30 to-[#FEEC90]/30 border border-[#7CFF7A]/50" 
                                : "bg-blue-500/20 border border-blue-500/30"
                              : "bg-background/80 opacity-0 group-hover:opacity-100 border border-muted"
                          )}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleContentSelection(content);
                          }}
                        >
                          {selectionMode === 'classification' ? (
                            <div className={cn(
                              selectedContents.some(c => c.url === content.url) 
                                ? "animate-shimmer-once" 
                                : ""
                            )}>
                              {selectedContents.some(c => c.url === content.url) ? (
                                <CheckSquare 
                                  className={cn(
                                    "h-5 w-5",
                                    selectedContents.some(c => c.url === content.url) 
                                      ? "text-primary" 
                                      : "text-muted-foreground"
                                  )} 
                                />
                              ) : (
                                <Square 
                                  className={cn(
                                    "h-5 w-5",
                                    "text-muted-foreground"
                                  )} 
                                />
                              )}
                            </div>
                          ) : (
                            <FolderOpen 
                              className={cn(
                                "h-5 w-5",
                                selectedContents.some(c => c.url === content.url) 
                                  ? "text-blue-600" 
                                  : "text-muted-foreground"
                              )} 
                            />
                          )}
                        </div>
                        
                        <ContentCard
                          key={content.url}
                          {...content as unknown as ContentCardProps}
                          isHighlighted={content.id === selectedContentId}
                          preloadedSchemes={schemes}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          
          {!isLoading && contents.length >= 20 && !showFilters && (
            <Button onClick={loadMore} className="w-full mt-4">Load More</Button>
          )}
          {isLoading && contents.length > 0 && (
            <div className="flex justify-center mt-4">
              <DotLoader color="#000" size={30} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ContentsView;
