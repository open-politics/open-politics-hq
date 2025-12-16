'use client';

import React, { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Search, ExternalLink, Plus, CheckCircle, AlertCircle, FileText, Image as ImageIcon, Clock, Sparkles, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { useSourceStore } from '@/zustand_stores/storeSources';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { useProvidersStore } from '@/zustand_stores/storeProviders';
import useAuth from '@/hooks/useAuth';
import { SearchService, AssetRead } from '@/client';
import { formatDistanceToNowStrict } from 'date-fns';

interface SearchResult {
  title: string;
  url: string;
  content: string;
  score?: number;
  raw_content?: string;
  favicon?: string;
  raw?: {
    tavily_images?: Array<{
      url: string;
      description?: string;
    }>;
    tavily_answer?: string;
    [key: string]: any;
  };
  [key: string]: unknown; // Allow additional properties from the API response
}

interface SearchComponentProps {
  onAssetsCreated?: (assets: any[]) => void;
  defaultProvider?: string;
  showAssetCreation?: boolean;
  className?: string;
}

export default function SearchComponent({ 
  onAssetsCreated, 
  defaultProvider = 'tavily',
  showAssetCreation = true,
  className = ''
}: SearchComponentProps) {
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState(defaultProvider);
  const [maxResults, setMaxResults] = useState(10);
  const [isSearching, setIsSearching] = useState(false);
  const [isCreatingAssets, setIsCreatingAssets] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [selectedResults, setSelectedResults] = useState<Set<number>>(new Set());
  const [viewingArticle, setViewingArticle] = useState<number | null>(null);
  const [viewingAsAsset, setViewingAsAsset] = useState<number | null>(null);
  
  const { createSource } = useSourceStore();
  const { activeInfospace } = useInfospaceStore();
  const { apiKeys } = useProvidersStore();
  const { isLoggedIn } = useAuth();

  // Debug: Log button state on every render
  console.log('SearchComponent render - Button state:', {
    selectedResultsSize: selectedResults.size,
    searchResultsLength: searchResults.length,
    isCreatingAssets,
    buttonDisabled: selectedResults.size === 0 || isCreatingAssets,
    showAssetCreation
  });

  const searchProviders = [
    { value: 'tavily', label: 'Tavily (Recommended)', description: 'AI-powered web search' },
    { value: 'searxng', label: 'SearXNG', description: 'Privacy-focused metasearch' },
    { value: 'exa', label: 'Exa', description: 'Neural search engine' }
  ];

  const handleSearch = useCallback(async () => {
    if (!query.trim()) {
      toast.error('Please enter a search query');
      return;
    }

    if (!isLoggedIn) {
      toast.error('Please log in to perform searches');
      return;
    }

    if (!activeInfospace) {
      toast.error('Please select an active infospace');
      return;
    }

    setIsSearching(true);
    setSearchResults([]);
    setSelectedResults(new Set());

    try {
      // Use the SearchService from the generated SDK with API key
      const response = await SearchService.searchAndIngest({
        requestBody: {
          query,
          provider,
          limit: maxResults,
          infospace_id: activeInfospace.id,
          scrape_content: false,  // Just search first, don't create assets yet
          create_assets: false,   // Only search, don't create assets
          api_key: apiKeys[provider] || undefined  // Pass the API key for the selected provider
        }
      });

      setSearchResults((response.results || []) as SearchResult[]);
      
      toast.success(`Found ${response.results_found || 0} results`);
    } catch (error) {
      console.error('Search error:', error);
      toast.error(`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsSearching(false);
    }
  }, [query, provider, maxResults, activeInfospace]);

  const handleResultToggle = (index: number) => {
    console.log('handleResultToggle called with index:', index);
    const newSelected = new Set(selectedResults);
    if (newSelected.has(index)) {
      newSelected.delete(index);
      console.log('Removed index', index, 'from selection');
    } else {
      newSelected.add(index);
      console.log('Added index', index, 'to selection');
    }
    console.log('New selected set:', Array.from(newSelected));
    setSelectedResults(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedResults.size === searchResults.length) {
      setSelectedResults(new Set());
    } else {
      setSelectedResults(new Set(searchResults.map((_, i) => i)));
    }
  };

  const handleCreateAssets = useCallback(async () => {
    console.log('handleCreateAssets called', { 
      selectedResultsSize: selectedResults.size, 
      isLoggedIn, 
      activeInfospace: activeInfospace?.id 
    });
    
    if (selectedResults.size === 0) {
      toast.error('Please select at least one result to create assets');
      return;
    }

    if (!isLoggedIn) {
      toast.error('Please log in to create assets');
      return;
    }

    if (!activeInfospace) {
      toast.error('Please select an active infospace');
      return;
    }

    console.log('Starting asset creation...');
    setIsCreatingAssets(true);

    try {
      // Collect URLs from selected results
      const urlsToCreate: string[] = [];
      selectedResults.forEach(index => {
        if (searchResults[index]) {
          urlsToCreate.push(searchResults[index].url);
        }
      });

      if (urlsToCreate.length === 0) {
        toast.error('No valid URLs found in selected results');
        return;
      }

      // Collect full search result data for selected results
      const selectedSearchResults: any[] = [];
      selectedResults.forEach(index => {
        if (searchResults[index]) {
          selectedSearchResults.push(searchResults[index]);
        }
      });

      console.log('About to call SearchService.createAssetsFromResults with:', {
        selectedSearchResultsCount: selectedSearchResults.length,
        infospaceId: activeInfospace.id,
        query,
        provider
      });

      console.log('SearchService available?', !!SearchService);
      console.log('SearchService.createAssetsFromResults available?', !!SearchService.createAssetsFromResults);

      // Use the SearchService from the generated SDK
      const result = await SearchService.createAssetsFromResults({
        requestBody: {
          search_results: selectedSearchResults,
          infospace_id: activeInfospace.id,
          search_metadata: {
            query,
            provider,
            timestamp: new Date().toISOString()
          }
        }
      });

      console.log('SearchService.createAssetsFromResults result:', result);
      
      toast.success(`Created ${result.assets_created} assets from ${urlsToCreate.length} selected results`);
      
      if (onAssetsCreated && result.asset_ids) {
        // Pass the created asset IDs to callback
        onAssetsCreated(result.asset_ids.map((id: number) => ({ id })));
      }
      
      // Clear selections
      setSelectedResults(new Set());
      
    } catch (error) {
      console.error('Asset creation error:', error);
      console.error('Error details:', {
        name: error?.name,
        message: error?.message,
        stack: error?.stack,
        cause: error?.cause
      });
      toast.error(`Failed to create assets: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      console.log('Asset creation finished, setting isCreatingAssets to false');
      setIsCreatingAssets(false);
    }
  }, [selectedResults, searchResults, query, provider, activeInfospace, onAssetsCreated, isLoggedIn]);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Search className="h-5 w-5" />
          Search & Ingest
        </CardTitle>
        <CardDescription>
          Search the web and create assets from the results
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Search Configuration */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2 space-y-2">
            <Label htmlFor="search-query">Search Query</Label>
            <Input
              id="search-query"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Enter your search query..."
              onKeyDown={(e) => e.key === 'Enter' && !isSearching && handleSearch()}
            />
          </div>
          
          <div className="space-y-2">
            <Label>Search Provider</Label>
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {searchProviders.map((prov) => (
                  <SelectItem key={prov.value} value={prov.value}>
                    <div>
                      <div className="font-medium">{prov.label}</div>
                      <div className="text-xs text-muted-foreground">{prov.description}</div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Label htmlFor="max-results" className="text-sm">Max Results:</Label>
            <Select value={maxResults.toString()} onValueChange={(v) => setMaxResults(parseInt(v))}>
              <SelectTrigger className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5">5</SelectItem>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="20">20</SelectItem>
                <SelectItem value="50">50</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <Button 
            onClick={handleSearch} 
            disabled={isSearching || !query.trim()}
            className="flex-1"
          >
            {isSearching ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Searching...
              </>
            ) : (
              <>
                <Search className="mr-2 h-4 w-4" />
                Search
              </>
            )}
          </Button>
        </div>

        {/* Search Results */}
        {searchResults.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-medium">Search Results</h3>
                <Badge variant="secondary">{searchResults.length} results</Badge>
              </div>
              
              {showAssetCreation && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSelectAll}
                  >
                    {selectedResults.size === searchResults.length ? 'Deselect All' : 'Select All'}
                  </Button>
                  
                  <Button
                    onClick={(e) => {
                      console.log('Create Assets button clicked!', { 
                        selectedResultsSize: selectedResults.size, 
                        isCreatingAssets,
                        disabled: selectedResults.size === 0 || isCreatingAssets 
                      });
                      handleCreateAssets();
                    }}
                    disabled={selectedResults.size === 0 || isCreatingAssets}
                    size="sm"
                  >
                    {isCreatingAssets ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      <>
                        <Plus className="mr-2 h-4 w-4" />
                        Create Assets ({selectedResults.size})
                      </>
                    )}
                  </Button>
                </div>
              )}
            </div>

            <div className="space-y-3 max-h-96 overflow-y-auto">
              {searchResults.map((result, index) => {
                const hasImages = result.raw?.tavily_images && result.raw.tavily_images.length > 0;
                const hasRawContent = result.raw_content && result.raw_content.length > 0;
                
                return (
                  <Card 
                    key={index} 
                    className={`transition-colors ${
                      selectedResults.has(index) 
                        ? 'ring-2 ring-blue-500 bg-blue-50/50 dark:bg-blue-950/20' 
                        : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <h4 className="font-medium text-sm line-clamp-2 leading-tight">
                              {result.title || 'Untitled'}
                            </h4>
                            {result.score && (
                              <Badge variant="outline" className="text-xs shrink-0">
                                {Math.round(result.score * 100)}%
                              </Badge>
                            )}
                          </div>
                          
                          <p className="text-sm text-muted-foreground line-clamp-3 mb-3 leading-relaxed">
                            {result.content}
                          </p>

                          {/* Images */}
                          {hasImages && result.raw?.tavily_images && (
                            <div className="mb-3">
                              <div className="flex gap-2 overflow-x-auto pb-2">
                                {result.raw.tavily_images.slice(0, 3).map((image, imgIndex) => (
                                  <div key={imgIndex} className="flex-shrink-0">
                                    <img
                                      src={image.url}
                                      alt={image.description || `Image ${imgIndex + 1}`}
                                      className="w-12 h-12 object-cover rounded border"
                                      onError={(e) => {
                                        const target = e.target as HTMLImageElement;
                                        target.style.display = 'none';
                                      }}
                                    />
                                  </div>
                                ))}
                                {result.raw.tavily_images.length > 3 && (
                                  <div className="flex-shrink-0 w-12 h-12 bg-muted rounded border flex items-center justify-center text-xs text-muted-foreground">
                                    +{result.raw.tavily_images.length - 3}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Action buttons */}
                          <div className="flex items-center gap-2 mb-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                setViewingArticle(index);
                              }}
                              disabled={!hasRawContent}
                              className="h-6 px-2 text-xs"
                            >
                              <FileText className="h-3 w-3 mr-1" />
                              {hasRawContent ? 'Read' : 'No Content'}
                            </Button>
                            
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                setViewingAsAsset(index);
                              }}
                              disabled={!hasRawContent}
                              className="h-6 px-2 text-xs"
                            >
                              <Eye className="h-3 w-3 mr-1" />
                              Asset View
                            </Button>
                            
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                window.open(result.url, '_blank');
                              }}
                              className="h-6 px-2 text-xs"
                            >
                              <ExternalLink className="h-3 w-3 mr-1" />
                              Open
                            </Button>
                          </div>
                          
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <div className="flex items-center gap-1">
                              {result.favicon && (
                                <img 
                                  src={result.favicon} 
                                  alt="" 
                                  className="w-3 h-3"
                                  onError={(e) => {
                                    const target = e.target as HTMLImageElement;
                                    target.style.display = 'none';
                                  }}
                                />
                              )}
                              <span>{new URL(result.url).hostname}</span>
                            </div>
                            
                            {hasRawContent && (
                              <div className="flex items-center gap-1">
                                <FileText className="h-3 w-3" />
                                Full content
                              </div>
                            )}
                            
                            {hasImages && result.raw?.tavily_images && (
                              <div className="flex items-center gap-1">
                                <ImageIcon className="h-3 w-3" />
                                {result.raw.tavily_images.length} images
                              </div>
                            )}
                          </div>
                        </div>
                        
                        {showAssetCreation && (
                          <div className="flex-shrink-0">
                            <div 
                              className="cursor-pointer"
                              onClick={() => handleResultToggle(index)}
                            >
                              {selectedResults.has(index) ? (
                                <CheckCircle className="h-5 w-5 text-blue-600" />
                              ) : (
                                <div className="h-5 w-5 border-2 border-gray-300 rounded-full hover:border-blue-400 transition-colors" />
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {searchResults.length === 0 && !isSearching && query && (
          <div className="text-center py-8 text-muted-foreground">
            <AlertCircle className="h-8 w-8 mx-auto mb-2" />
            <p>No results found for "{query}"</p>
            <p className="text-sm">Try a different search query or provider</p>
          </div>
        )}

        {/* Article Viewer Dialog */}
        {viewingArticle !== null && searchResults[viewingArticle] && (
          <Dialog open={true} onOpenChange={() => setViewingArticle(null)}>
            <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Article Content
                </DialogTitle>
              </DialogHeader>
              
              {(() => {
                const result = searchResults[viewingArticle];
                
                return (
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <div className="mb-4 p-3 bg-muted/30 rounded-lg">
                      <h3 className="font-medium mb-1">{result.title}</h3>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <a 
                          href={result.url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-blue-600 hover:underline"
                        >
                          <ExternalLink className="h-3 w-3" />
                          {new URL(result.url).hostname}
                        </a>
                      </div>
                    </div>

                    {/* Tavily Answer if available */}
                    {result.raw?.tavily_answer && (
                      <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800">
                        <div className="flex items-center gap-2 mb-2">
                          <Sparkles className="h-4 w-4 text-blue-600" />
                          <span className="font-medium text-blue-900 dark:text-blue-100">AI Summary</span>
                        </div>
                        <p className="text-sm text-blue-800 dark:text-blue-200">
                          {result.raw.tavily_answer}
                        </p>
                      </div>
                    )}

                    {/* Images */}
                    {result.raw?.tavily_images && result.raw.tavily_images.length > 0 && (
                      <div className="mb-4">
                        <h4 className="font-medium mb-2 flex items-center gap-2">
                          <ImageIcon className="h-4 w-4" />
                          Images ({result.raw.tavily_images.length})
                        </h4>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                          {result.raw.tavily_images.map((image, imgIndex) => (
                            <div key={imgIndex} className="relative group">
                              <img
                                src={image.url}
                                alt={image.description || `Image ${imgIndex + 1}`}
                                className="w-full h-32 object-cover rounded border hover:shadow-md transition-shadow cursor-pointer"
                                onClick={() => window.open(image.url, '_blank')}
                                onError={(e) => {
                                  const target = e.target as HTMLImageElement;
                                  target.parentElement!.style.display = 'none';
                                }}
                              />
                              {image.description && (
                                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity rounded flex items-end p-2">
                                  <p className="text-white text-xs">{image.description}</p>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Article Content */}
                    <div className="flex-1 min-h-0">
                      <h4 className="font-medium mb-2 flex items-center gap-2">
                        <FileText className="h-4 w-4" />
                        Full Article
                      </h4>
                      <ScrollArea className="h-96 border rounded-lg p-4">
                        {result.raw_content ? (
                          <div className="prose prose-sm max-w-none dark:prose-invert">
                            <div className="whitespace-pre-wrap text-sm leading-relaxed">
                              {result.raw_content}
                            </div>
                          </div>
                        ) : (
                          <div className="text-center text-muted-foreground py-8">
                            <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                            <p>No full content available for this article</p>
                            <p className="text-xs mt-1">Try opening the original URL</p>
                          </div>
                        )}
                      </ScrollArea>
                    </div>

                    <div className="mt-4 flex justify-end gap-2">
                      <Button
                        variant="outline"
                        onClick={() => window.open(result.url, '_blank')}
                      >
                        <ExternalLink className="h-4 w-4 mr-2" />
                        Open Original
                      </Button>
                      <Button onClick={() => setViewingArticle(null)}>
                        Close
                      </Button>
                    </div>
                  </div>
                );
              })()}
            </DialogContent>
          </Dialog>
        )}

        {/* Asset Detail View Dialog */}
        {viewingAsAsset !== null && (
          <Dialog open={true} onOpenChange={() => setViewingAsAsset(null)}>
            <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col p-0">
              <DialogHeader className="px-6 py-4 border-b">
                <DialogTitle className="flex items-center gap-2">
                  <Eye className="h-5 w-5" />
                  Search Result Asset View
                </DialogTitle>
              </DialogHeader>
              
              {(() => {
                const result = searchResults[viewingAsAsset];
                
                if (!result) return <div className="p-6">Article not found</div>;
                
                return (
                  <div className="flex-1 min-h-0 overflow-y-auto">
                    <div className="h-full flex flex-col">
                      {/* Article Header */}
                      <div className="flex-none px-8 py-6 border-b">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                          <Search className="h-4 w-4" />
                          <span>Search Result</span>
                          <span>•</span>
                          <span>{provider}</span>
                          {result.score && (
                            <>
                              <span>•</span>
                              <span>Score: {Math.round(result.score * 100)}%</span>
                            </>
                          )}
                        </div>
                        
                        <h1 className="text-2xl font-bold leading-tight mb-4 text-foreground">
                          {result.title || 'Untitled Article'}
                        </h1>
                        
                        <div className="flex items-center gap-2 text-sm">
                          <span className="text-muted-foreground">Source:</span>
                          <a 
                            href={result.url} 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="text-primary hover:underline flex items-center gap-1"
                          >
                            {new URL(result.url).hostname}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                        
                        {/* Tavily Answer if available */}
                        {result.raw?.tavily_answer && (
                          <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg border-l-4 border-primary">
                            <div className="flex items-center gap-2 mb-2">
                              <Sparkles className="h-4 w-4 text-blue-600" />
                              <span className="font-medium text-blue-900 dark:text-blue-100">AI Summary</span>
                            </div>
                            <p className="text-sm text-blue-800 dark:text-blue-200">
                              {result.raw.tavily_answer}
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Article Content */}
                      <div className="flex-1 overflow-y-auto">
                        <div className="max-w-4xl mx-auto px-6 py-6">
                          
                          {/* Images */}
                          {result.raw?.tavily_images && result.raw.tavily_images.length > 0 && (
                            <div className="mb-6">
                              <h4 className="font-medium mb-3 flex items-center gap-2">
                                <ImageIcon className="h-4 w-4" />
                                Images ({result.raw.tavily_images.length})
                              </h4>
                              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                {result.raw.tavily_images.map((image, imgIndex) => (
                                  <div key={imgIndex} className="relative group">
                                    <img
                                      src={image.url}
                                      alt={image.description || `Image ${imgIndex + 1}`}
                                      className="w-full h-32 object-cover rounded border hover:shadow-md transition-shadow cursor-pointer"
                                      onClick={() => window.open(image.url, '_blank')}
                                      onError={(e) => {
                                        const target = e.target as HTMLImageElement;
                                        target.parentElement!.style.display = 'none';
                                      }}
                                    />
                                    {image.description && (
                                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity rounded flex items-end p-2">
                                        <p className="text-white text-xs">{image.description}</p>
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Article Text Content */}
                          {result.raw_content && (
                            <div className="prose prose-gray max-w-none">
                              <div className="text-base leading-relaxed text-foreground whitespace-pre-wrap">
                                {result.raw_content}
                              </div>
                            </div>
                          )}

                          {/* Fallback to summary if no raw content */}
                          {!result.raw_content && result.content && (
                            <div className="prose prose-gray max-w-none">
                              <div className="text-base leading-relaxed text-foreground">
                                {result.content}
                              </div>
                            </div>
                          )}

                          {/* Article Metadata */}
                          <div className="mt-8 pt-6 border-t">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                              <div className="space-y-2">
                                <h4 className="font-semibold text-muted-foreground">Search Info</h4>
                                <div className="space-y-1">
                                  <div className="flex items-center gap-2">
                                    <strong className="w-20 shrink-0">Query:</strong>
                                    <span>"{query}"</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <strong className="w-20 shrink-0">Provider:</strong>
                                    <span className="capitalize">{provider}</span>
                                  </div>
                                  {result.score && (
                                    <div className="flex items-center gap-2">
                                      <strong className="w-20 shrink-0">Score:</strong>
                                      <span>{Math.round(result.score * 100)}%</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                              
                              <div className="space-y-2">
                                <h4 className="font-semibold text-muted-foreground">Content Info</h4>
                                <div className="space-y-1">
                                  {result.raw_content && (
                                    <div className="flex items-center gap-2">
                                      <strong className="w-20 shrink-0">Length:</strong>
                                      <span>{result.raw_content.length.toLocaleString()} characters</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Footer Actions */}
                      <div className="flex-none p-4 border-t bg-muted/30">
                        <div className="flex justify-between items-center">
                          <Button
                            variant="outline"
                            onClick={() => window.open(result.url, '_blank')}
                          >
                            <ExternalLink className="h-4 w-4 mr-2" />
                            Open Original
                          </Button>
                          <Button onClick={() => setViewingAsAsset(null)}>
                            Close
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </DialogContent>
          </Dialog>
        )}
      </CardContent>
    </Card>
  );
}
