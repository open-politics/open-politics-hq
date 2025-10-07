'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { 
  Search, 
  Loader2, 
  ExternalLink, 
  Plus, 
  CheckCircle, 
  AlertCircle,
  Settings,
  Download,
  RefreshCw,
  Globe,
  Clock,
  Zap,
  FileText,
  Image as ImageIcon,
  Sparkles,
  Eye
} from 'lucide-react';
import { toast } from 'sonner';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { useApiKeysStore } from '@/zustand_stores/storeApiKeys';
import useAuth from '@/hooks/useAuth';
import { SearchService, AssetRead } from '@/client';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import AssetDetailView from '@/components/collection/assets/Views/AssetDetailView';

interface SearchResult {
  title: string;
  url: string;
  content: string;
  score?: number;
  published_date?: string;
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
  [key: string]: unknown;
}

interface SearchSession {
  id: string;
  query: string;
  provider: string;
  timestamp: Date;
  results: SearchResult[];
  resultsCount: number;
  isLoading?: boolean;
  error?: string;
}

interface SearchInterfaceProps {
  className?: string;
}

const searchProviders = [
  { 
    value: 'tavily', 
    label: 'Tavily', 
    description: 'AI-powered web search with deep content analysis',
    icon: Zap,
    color: 'text-blue-600'
  },
  { 
    value: 'searxng', 
    label: 'SearXNG', 
    description: 'Privacy-focused metasearch engine',
    icon: Globe,
    color: 'text-green-600'
  }
];

export default function SearchInterface({ className }: SearchInterfaceProps) {
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState('tavily');
  const [maxResults, setMaxResults] = useState(10);
  const [searchDepth, setSearchDepth] = useState<'basic' | 'advanced'>('basic');
  const [includeImages, setIncludeImages] = useState(true);
  const [includeRawContent, setIncludeRawContent] = useState(true);
  
  const [sessions, setSessions] = useState<SearchSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [selectedResults, setSelectedResults] = useState<Set<string>>(new Set());
  const [isCreatingAssets, setIsCreatingAssets] = useState(false);
  const [viewingArticle, setViewingArticle] = useState<{sessionId: string; resultIndex: number} | null>(null);
  const [viewingAsAsset, setViewingAsAsset] = useState<{sessionId: string; resultIndex: number} | null>(null);
  
  const { activeInfospace } = useInfospaceStore();
  const { apiKeys } = useApiKeysStore();
  const { isLoggedIn } = useAuth();
  
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsEndRef = useRef<HTMLDivElement>(null);

  const activeSession = sessions.find(s => s.id === activeSessionId);

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Scroll to bottom when new results come in
  useEffect(() => {
    if (activeSession && !activeSession.isLoading) {
      resultsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeSession?.results.length, activeSession?.isLoading]);

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

    const sessionId = `search-${Date.now()}`;
    const newSession: SearchSession = {
      id: sessionId,
      query: query.trim(),
      provider,
      timestamp: new Date(),
      results: [],
      resultsCount: 0,
      isLoading: true
    };

    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(sessionId);
    setSelectedResults(new Set());

    try {
      const response = await SearchService.searchAndIngest({
        requestBody: {
          query: query.trim(),
          provider,
          limit: maxResults,
          infospace_id: activeInfospace.id,
          scrape_content: includeRawContent,
          create_assets: false, // Just search, don't create assets yet
          api_key: apiKeys[provider] || undefined,
          // Add Tavily-specific parameters
          ...(provider === 'tavily' && {
            include_images: includeImages,
            include_raw_content: includeRawContent,
            search_depth: searchDepth,
            include_answer: true
          })
        }
      });

      const results = (response.results || []) as SearchResult[];
      
      setSessions(prev => prev.map(session => 
        session.id === sessionId 
          ? { 
              ...session, 
              results,
              resultsCount: response.results_found || 0,
              isLoading: false 
            }
          : session
      ));
      
      toast.success(`Found ${response.results_found || 0} results`);
    } catch (error) {
      console.error('Search error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      setSessions(prev => prev.map(session => 
        session.id === sessionId 
          ? { 
              ...session, 
              isLoading: false,
              error: errorMessage
            }
          : session
      ));
      
      toast.error(`Search failed: ${errorMessage}`);
    }
  }, [query, provider, maxResults, searchDepth, includeImages, includeRawContent, activeInfospace, apiKeys, isLoggedIn]);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSearch();
    }
  };

  const handleResultToggle = (sessionId: string, resultIndex: number) => {
    const resultKey = `${sessionId}-${resultIndex}`;
    setSelectedResults(prev => {
      const newSet = new Set(prev);
      if (newSet.has(resultKey)) {
        newSet.delete(resultKey);
      } else {
        newSet.add(resultKey);
      }
      return newSet;
    });
  };

  const handleSelectAllInSession = (sessionId: string) => {
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return;

    const sessionResultKeys = session.results.map((_, i) => `${sessionId}-${i}`);
    const allSelected = sessionResultKeys.every(key => selectedResults.has(key));

    setSelectedResults(prev => {
      const newSet = new Set(prev);
      if (allSelected) {
        // Deselect all in this session
        sessionResultKeys.forEach(key => newSet.delete(key));
      } else {
        // Select all in this session
        sessionResultKeys.forEach(key => newSet.add(key));
      }
      return newSet;
    });
  };

  const handleCreateAssets = useCallback(async () => {
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

    setIsCreatingAssets(true);

    try {
      // Collect URLs and metadata from selected results
      const urlsToCreate: string[] = [];
      const searchMetadata: Record<string, any> = {};
      
      selectedResults.forEach(resultKey => {
        const [sessionId, indexStr] = resultKey.split('-');
        const index = parseInt(indexStr);
        const session = sessions.find(s => s.id === sessionId);
        
        if (session && session.results[index]) {
          const result = session.results[index];
          urlsToCreate.push(result.url);
          
          // Collect metadata from the first result for context
          if (Object.keys(searchMetadata).length === 0) {
            searchMetadata.query = session.query;
            searchMetadata.provider = session.provider;
            searchMetadata.timestamp = session.timestamp.toISOString();
          }
        }
      });

      if (urlsToCreate.length === 0) {
        toast.error('No valid URLs found in selected results');
        return;
      }

      // Collect full search result data for selected results
      const selectedSearchResults: any[] = [];
      
      selectedResults.forEach(resultKey => {
        const [sessionId, indexStr] = resultKey.split('-');
        const index = parseInt(indexStr);
        const session = sessions.find(s => s.id === sessionId);
        
        if (session && session.results[index]) {
          selectedSearchResults.push(session.results[index]);
        }
      });

      // Use the SearchService from the generated SDK
      const result = await SearchService.createAssetsFromResults({
        requestBody: {
          search_results: selectedSearchResults,
          infospace_id: activeInfospace.id,
          search_metadata: searchMetadata
        }
      });
      
      toast.success(`Created ${result.assets_created} assets from ${urlsToCreate.length} selected results`);
      setSelectedResults(new Set());
      
    } catch (error) {
      console.error('Asset creation error:', error);
      toast.error(`Failed to create assets: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsCreatingAssets(false);
    }
  }, [selectedResults, sessions, activeInfospace, isLoggedIn]);

  // Convert search result to mock AssetRead for AssetDetailView
  const createMockAssetFromSearchResult = (result: SearchResult, sessionId: string, index: number): AssetRead => {
    const session = sessions.find(s => s.id === sessionId);
    return {
      id: -1, // Mock ID
      uuid: `search-${sessionId}-${index}`,
      title: result.title || 'Untitled',
      kind: 'web',
      text_content: result.raw_content || result.content,
      source_identifier: result.url,
      blob_path: null,
      event_timestamp: result.published_date || new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      infospace_id: activeInfospace?.id || 0,
      user_id: 0,
      source_id: null,
      parent_asset_id: null,
      part_index: null,
      is_container: false,
      source_metadata: {
        search_query: session?.query,
        search_provider: session?.provider,
        search_score: result.score,
        search_rank: index,
        favicon: result.favicon,
        tavily_images: result.raw?.tavily_images,
        tavily_answer: result.raw?.tavily_answer,
        content_length: result.raw_content?.length || result.content?.length,
        scraped_at: new Date().toISOString(),
        created_from_search: true,
        ...result.raw
      }
    } as AssetRead;
  };

  const renderSearchResult = (result: SearchResult, index: number, sessionId: string) => {
    const resultKey = `${sessionId}-${index}`;
    const isSelected = selectedResults.has(resultKey);
    const hasImages = result.raw?.tavily_images && result.raw.tavily_images.length > 0;
    const hasRawContent = result.raw_content && result.raw_content.length > 0;

    return (
      <Card 
        key={index}
        className={cn(
          "transition-all duration-200 hover:shadow-md",
          isSelected && "ring-2 ring-blue-500 bg-blue-50/50 dark:bg-blue-950/20"
        )}
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
              {hasImages && (
                <div className="mb-3">
                  <div className="flex gap-2 overflow-x-auto pb-2">
                    {result.raw!.tavily_images!.slice(0, 3).map((image, imgIndex) => (
                      <div key={imgIndex} className="flex-shrink-0">
                        <img
                          src={image.url}
                          alt={image.description || `Image ${imgIndex + 1}`}
                          className="w-16 h-16 object-cover rounded border"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            target.style.display = 'none';
                          }}
                        />
                      </div>
                    ))}
                    {result.raw!.tavily_images!.length > 3 && (
                      <div className="flex-shrink-0 w-16 h-16 bg-muted rounded border flex items-center justify-center text-xs text-muted-foreground">
                        +{result.raw!.tavily_images!.length - 3}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex items-center gap-2 mb-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setViewingArticle({ sessionId, resultIndex: index });
                  }}
                  disabled={!hasRawContent}
                  className="h-7 px-2 text-xs"
                >
                  <FileText className="h-3 w-3 mr-1" />
                  {hasRawContent ? 'Read Article' : 'No Content'}
                </Button>
                
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setViewingAsAsset({ sessionId, resultIndex: index });
                  }}
                  disabled={!hasRawContent}
                  className="h-7 px-2 text-xs"
                >
                  <Eye className="h-3 w-3 mr-1" />
                  View as Asset
                </Button>
                
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    window.open(result.url, '_blank');
                  }}
                  className="h-7 px-2 text-xs"
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
                
                {result.published_date && (
                  <div className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatDistanceToNow(new Date(result.published_date))} ago
                  </div>
                )}
                
                {hasRawContent && (
                  <div className="flex items-center gap-1">
                    <FileText className="h-3 w-3" />
                    Full content
                  </div>
                )}
                
                {hasImages && (
                  <div className="flex items-center gap-1">
                    <ImageIcon className="h-3 w-3" />
                    {result.raw!.tavily_images!.length} images
                  </div>
                )}
              </div>
            </div>
            
            <div className="flex-shrink-0">
              <div 
                className="cursor-pointer"
                onClick={() => handleResultToggle(sessionId, index)}
              >
                {isSelected ? (
                  <CheckCircle className="h-5 w-5 text-blue-600" />
                ) : (
                  <div className="h-5 w-5 border-2 border-gray-300 rounded-full hover:border-blue-400 transition-colors" />
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderSession = (session: SearchSession) => {
    const sessionResultKeys = session.results.map((_, i) => `${session.id}-${i}`);
    const selectedInSession = sessionResultKeys.filter(key => selectedResults.has(key)).length;
    const ProviderIcon = searchProviders.find(p => p.value === session.provider)?.icon || Search;

    return (
      <div key={session.id} className="space-y-4">
        {/* Session Header */}
        <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg border">
          <div className="flex items-center gap-3">
            <ProviderIcon className={cn("h-5 w-5", searchProviders.find(p => p.value === session.provider)?.color)} />
            <div>
              <h3 className="font-medium">{session.query}</h3>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>{session.provider}</span>
                <span>•</span>
                <span>{formatDistanceToNow(session.timestamp)} ago</span>
                {!session.isLoading && !session.error && (
                  <>
                    <span>•</span>
                    <span>{session.resultsCount} results</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {!session.isLoading && !session.error && session.results.length > 0 && (
            <div className="flex items-center gap-2">
              {selectedInSession > 0 && (
                <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/30">
                  {selectedInSession} selected
                </Badge>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleSelectAllInSession(session.id)}
              >
                {selectedInSession === session.results.length ? 'Deselect All' : 'Select All'}
              </Button>
            </div>
          )}
        </div>

        {/* Session Content */}
        {session.isLoading && (
          <div className="flex items-center justify-center py-8">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Searching...
            </div>
          </div>
        )}

        {session.error && (
          <Card className="border-red-200 bg-red-50 dark:bg-red-950/20">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-red-600">
                <AlertCircle className="h-4 w-4" />
                <span>Search failed: {session.error}</span>
              </div>
            </CardContent>
          </Card>
        )}

        {!session.isLoading && !session.error && session.results.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-8">
              <AlertCircle className="h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-muted-foreground">No results found for "{session.query}"</p>
              <p className="text-sm text-muted-foreground">Try a different search query or provider</p>
            </CardContent>
          </Card>
        )}

        {!session.isLoading && !session.error && session.results.length > 0 && (
          <div className="space-y-3">
            {session.results.map((result, index) => renderSearchResult(result, index, session.id))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Header */}
      <div className="flex-none p-6 border-b">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2.5 flex items-center gap-2 rounded-xl bg-blue-50/20 dark:bg-blue-950/10 border border-blue-200 dark:border-blue-800 shadow-sm">
            <Search className="h-6 w-6 text-blue-700 dark:text-blue-400" />
            <Globe className="h-6 w-6 text-blue-700 dark:text-blue-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Web Search</h1>
            <p className="text-gray-600 dark:text-gray-400 text-sm">
              Search the web and create assets from results
            </p>
          </div>
        </div>

        {/* Search Input */}
        <div className="space-y-4">
          <div className="flex gap-3">
            <div className="flex-1">
              <Input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Enter your search query..."
                className="text-base"
              />
            </div>
            <Button 
              onClick={handleSearch} 
              disabled={!query.trim() || (activeSession?.isLoading)}
              className="px-6"
            >
              {activeSession?.isLoading ? (
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

          {/* Search Options */}
          <div className="flex flex-wrap gap-3 text-sm">
            <div className="flex items-center gap-2">
              <label className="text-muted-foreground">Provider:</label>
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {searchProviders.map((prov) => (
                    <SelectItem key={prov.value} value={prov.value}>
                      <div className="flex items-center gap-2">
                        <prov.icon className={cn("h-4 w-4", prov.color)} />
                        {prov.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-muted-foreground">Results:</label>
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

            {provider === 'tavily' && (
              <div className="flex items-center gap-2">
                <label className="text-muted-foreground">Depth:</label>
                <Select value={searchDepth} onValueChange={(v: 'basic' | 'advanced') => setSearchDepth(v)}>
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="basic">Basic</SelectItem>
                    <SelectItem value="advanced">Advanced</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </div>

        {/* Action Bar */}
        {selectedResults.size > 0 && (
          <div className="mt-4 p-3 bg-primary/5 rounded-lg border border-primary/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/30">
                  {selectedResults.size} selected
                </Badge>
                <span className="text-sm text-muted-foreground">
                  Ready to create assets from selected results
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedResults(new Set())}
                >
                  Clear Selection
                </Button>
                <Button
                  onClick={handleCreateAssets}
                  disabled={isCreatingAssets}
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
            </div>
          </div>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 min-h-0">
        <ScrollArea className="h-full">
          <div className="p-6 space-y-8">
            {sessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Search className="h-16 w-16 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium text-muted-foreground mb-2">
                  Start your web search
                </h3>
                <p className="text-muted-foreground max-w-md">
                  Enter a search query above to find content from across the web. 
                  You can then select results to create assets in your infospace.
                </p>
              </div>
            ) : (
              sessions.map(renderSession)
            )}
            <div ref={resultsEndRef} />
          </div>
        </ScrollArea>
      </div>

      {/* Article Viewer Dialog */}
      {viewingArticle && (
        <Dialog open={true} onOpenChange={() => setViewingArticle(null)}>
          <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Article Content
              </DialogTitle>
            </DialogHeader>
            
            {(() => {
              const session = sessions.find(s => s.id === viewingArticle.sessionId);
              const result = session?.results[viewingArticle.resultIndex];
              
              if (!result) return <div>Article not found</div>;
              
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
                      {result.published_date && (
                        <>
                          <span>•</span>
                          <span>{formatDistanceToNow(new Date(result.published_date))} ago</span>
                        </>
                      )}
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

      {/* Search Result Detail View Dialog */}
      {viewingAsAsset && (
        <Dialog open={true} onOpenChange={() => setViewingAsAsset(null)}>
          <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col p-0">
            <DialogHeader className="px-6 py-4 border-b">
              <DialogTitle className="flex items-center gap-2">
                <Globe className="h-5 w-5" />
                Search Result Detail View
              </DialogTitle>
            </DialogHeader>
            
            {(() => {
              const session = sessions.find(s => s.id === viewingAsAsset.sessionId);
              const result = session?.results[viewingAsAsset.resultIndex];
              
              if (!result) return <div className="p-6">Article not found</div>;
              
              return (
                <div className="flex-1 min-h-0 overflow-y-auto">
                  <div className="h-full flex flex-col">
                    {/* Article Header */}
                    <div className="flex-none px-8 py-6 border-b">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                        <Globe className="h-4 w-4" />
                        <span>Search Result</span>
                        <span>•</span>
                        <span>{session?.provider}</span>
                        {result.published_date && (
                          <>
                            <span>•</span>
                            <span>{formatDistanceToNow(new Date(result.published_date))} ago</span>
                          </>
                        )}
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
                                  <span>"{session?.query}"</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <strong className="w-20 shrink-0">Provider:</strong>
                                  <span className="capitalize">{session?.provider}</span>
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
                                {result.published_date && (
                                  <div className="flex items-center gap-2">
                                    <strong className="w-20 shrink-0">Published:</strong>
                                    <span>{formatDistanceToNow(new Date(result.published_date), { addSuffix: true })}</span>
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
    </div>
  );
}
