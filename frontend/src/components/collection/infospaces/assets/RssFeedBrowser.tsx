import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Rss, ExternalLink, Calendar, User, Tag, Plus, Globe, Download, Eye, Clock } from "lucide-react";
import { toast } from "sonner";
import { RssFeedBrowseResponse } from "@/lib/scraping/scraping_response";
import { AssetsService, UtilsService } from "@/client/services";
import { useInfospaceStore } from "@/zustand_stores/storeInfospace";

interface RssFeedBrowserProps {
  onSelectArticle?: (url: string, title: string) => void;
  onIngestArticle?: (url: string, title: string) => void;
  onIngestFeeds?: (feeds: any[]) => void;
  onIngestSelectedArticles?: (articles: any[]) => void;
  onCreateRssSource?: (source: any) => void;
  infospaceId?: number;
  trigger?: React.ReactNode;
  destination: 'individual' | 'new_bundle' | 'existing_bundle';
  selectedBundleId?: number | string;
  bundleTitle?: string;
}

export default function RssFeedBrowser({
  onSelectArticle,
  onIngestArticle,
  onIngestFeeds,
  onIngestSelectedArticles,
  onCreateRssSource,
  infospaceId: propInfospaceId,
  trigger,
  destination,
  selectedBundleId,
  bundleTitle,
}: RssFeedBrowserProps) {
  const { activeInfospace } = useInfospaceStore();
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'discover' | 'preview'>('discover');
  
  // Use prop infospaceId if provided, otherwise use active infospace from store
  const infospaceId = propInfospaceId || activeInfospace?.id;
  
  // Discover tab state
  const [availableCountries, setAvailableCountries] = useState<string[]>([]);
  const [selectedCountry, setSelectedCountry] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [discoveredFeeds, setDiscoveredFeeds] = useState<any[]>([]);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  
  // Removed browse tab state - functionality moved to preview tab
  
  // Preview tab state
  const [previewFeedUrl, setPreviewFeedUrl] = useState("");
  const [previewData, setPreviewData] = useState<any>(null);
  const [previewing, setPreviewing] = useState(false);
  const [selectedArticles, setSelectedArticles] = useState<Set<number>>(new Set());
  const [creatingSource, setCreatingSource] = useState(false);
  
  // Common state
  const [error, setError] = useState<string | null>(null);
  const [ingestLoading, setIngestLoading] = useState(false);

  // Load available countries on component mount
  useEffect(() => {
    const loadCountries = async () => {
      try {
        const response = await UtilsService.getAvailableRssCountries();
        const data = await response as any;
        setAvailableCountries(data.countries || []);
      } catch (err) {
        console.error("Failed to load countries:", err);
      }
    };
    
    if (open) {
      loadCountries();
    }
  }, [open]);

  const discoverFeeds = async () => {
    if (!selectedCountry) {
      toast.error("Please select a country");
      return;
    }

    if (!infospaceId) {
      toast.error("Infospace ID is required");
      return;
    }

    setDiscoverLoading(true);
    setError(null);
    setDiscoveredFeeds([]);

    try {
      console.log('Discovering feeds with params:', {
        infospaceId,
        country: selectedCountry,
        category: categoryFilter || null,
        limit: 50
      });
      
      const response = await UtilsService.discoverRssFeeds({
        country: selectedCountry,
        category: categoryFilter || null,
        limit: 50
      });
      
      const data = await response as any;
      console.log('Discovery response:', data);
      setDiscoveredFeeds(data.feeds || []);
      toast.success(`Found ${data.feeds?.length || 0} RSS feeds from ${selectedCountry}`);
    } catch (err) {
      console.error('Discovery error:', err);
      const errorMessage = err instanceof Error ? err.message : "Failed to discover RSS feeds";
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setDiscoverLoading(false);
    }
  };

  // Function to preview a discovered feed
  const previewDiscoveredFeed = async (feedUrl: string, feedTitle: string) => {
    setPreviewFeedUrl(feedUrl);
    setActiveTab('preview');
    
    // Auto-preview the feed
    setPreviewing(true);
    setError(null);

    try {
      const response = await fetch(`/api/v1/infospaces/${infospaceId}/assets/preview-rss-feed?feed_url=${encodeURIComponent(feedUrl)}&max_items=20`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
          'Content-Type': 'application/json',
        },
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "Failed to preview feed");
      }

      setPreviewData(data);
      setSelectedArticles(new Set());
      toast.success(`Previewing feed: ${feedTitle}`);
    } catch (err: any) {
      setError(err.message || "Failed to preview feed");
      console.error("Feed preview error:", err);
    } finally {
      setPreviewing(false);
    }
  };

  const ingestSelectedFeeds = async (feeds: any[]) => {
    if (!feeds.length) {
      toast.error("No feeds selected for ingestion");
      return;
    }

    if (!infospaceId) {
      toast.error("Infospace ID is required");
      return;
    }

    setIngestLoading(true);
    try {
      const response = await AssetsService.ingestRssFeedsFromAwesome({
        infospaceId,
        requestBody: {
          country: selectedCountry,
          category_filter: categoryFilter || undefined,
          max_feeds: feeds.length,
          max_items_per_feed: 20,
          options: {}
        }
      });
      
      const assets = await response;
      toast.success(`Successfully ingested ${assets.length} assets from ${feeds.length} RSS feeds`);
      
      if (onIngestFeeds) {
        onIngestFeeds(assets);
      }
      
      setOpen(false);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to ingest RSS feeds";
      toast.error(errorMessage);
    } finally {
      setIngestLoading(false);
    }
  };

  const handleSelectArticle = (url: string, title: string) => {
    if (onSelectArticle) {
      onSelectArticle(url, title);
    }
    setOpen(false);
  };

  const handleIngestArticle = async (url: string, title: string) => {
    if (onIngestArticle) {
      onIngestArticle(url, title);
    }
    toast.success(`Ingesting article: ${title}`);
  };

  // Preview feed functionality
  const previewFeed = async () => {
    if (!previewFeedUrl.trim()) {
      setError("Please enter a feed URL");
      return;
    }

    // Variable for length of the feed
    const length = 20;

    setPreviewing(true);
    setError(null);

    try {
      const response = await fetch(`/api/v1/infospaces/${infospaceId}/assets/preview-rss-feed?feed_url=${encodeURIComponent(previewFeedUrl)}&max_items=20`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
          'Content-Type': 'application/json',
        },
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "Failed to preview feed");
      }

      setPreviewData(data);
      setSelectedArticles(new Set());
      toast.success(`Previewed feed: ${data.feed_info.title}`);
    } catch (err: any) {
      setError(err.message || "Failed to preview feed");
      console.error("Feed preview error:", err);
    } finally {
      setPreviewing(false);
    }
  };

  // Toggle article selection
  const toggleArticleSelection = (index: number) => {
    const newSelected = new Set(selectedArticles);
    if (newSelected.has(index)) {
      newSelected.delete(index);
    } else {
      newSelected.add(index);
    }
    setSelectedArticles(newSelected);
  };

  // Select all articles
  const selectAllArticles = () => {
    if (!previewData?.items) return;
    setSelectedArticles(new Set(previewData.items.map((_: any, index: number) => index)));
  };

  // Deselect all articles
  const deselectAllArticles = () => {
    setSelectedArticles(new Set());
  };

  // Ingest selected articles
  const ingestSelectedArticles = async () => {
    if (!previewData?.items || selectedArticles.size === 0) {
      setError("Please select articles to ingest");
      return;
    }

    setIngestLoading(true);
    setError(null);

    try {
      const selectedItems = Array.from(selectedArticles).map(index => previewData.items[index]);
      
      const response = await fetch(`/api/v1/infospaces/${infospaceId}/assets/ingest-selected-articles`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          feed_url: previewFeedUrl,
          selected_articles: selectedItems
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "Failed to ingest selected articles");
      }

      if (onIngestSelectedArticles) {
        onIngestSelectedArticles(selectedItems);
      }

      toast.success(`Successfully ingested ${data.ingested_count} articles`);
      setSelectedArticles(new Set());
    } catch (err: any) {
      setError(err.message || "Failed to ingest selected articles");
      console.error("Selective ingestion error:", err);
    } finally {
      setIngestLoading(false);
    }
  };

  // Create RSS source for monitoring
  const createRssSource = async (autoMonitor: boolean = false) => {
    if (!previewData?.feed_info) {
      setError("No feed data available");
      return;
    }

    setCreatingSource(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/v1/infospaces/${infospaceId}/assets/create-rss-source`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${localStorage.getItem("access_token")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            feed_url: previewFeedUrl,
            source_name: `RSS: ${previewData.feed_info.title}`,
            auto_monitor: autoMonitor,
            monitoring_schedule: autoMonitor ? "0 */6 * * *" : undefined, // Every 6 hours
            target_bundle_id:
              destination === "existing_bundle" ? selectedBundleId : undefined,
            target_bundle_name:
              destination === "new_bundle" ? bundleTitle : undefined,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "Failed to create RSS source");
      }

      if (onCreateRssSource) {
        onCreateRssSource(data);
      }

      toast.success(`Created RSS source: ${data.source_name}`);
    } catch (err: any) {
      setError(err.message || "Failed to create RSS source");
      console.error("RSS source creation error:", err);
    } finally {
      setCreatingSource(false);
    }
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return "No date";
    try {
      return new Date(dateString).toLocaleDateString();
    } catch {
      return dateString;
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm" className="group-hover:shadow-md group-hover:border-blue-200 dark:group-hover:border-blue-700 transition-all duration-200 border border-blue-100 dark:border-blue-900 bg-blue-50/20 dark:bg-blue-950/10">
            <Rss className="h-4 w-4 mr-2" />
            RSS Feeds
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-5xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="p-1.5 rounded-md bg-blue-500/20 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400">
              <Rss className="h-5 w-5" />
            </div>
            RSS Feed Discovery & Browser
          </DialogTitle>
        </DialogHeader>

        {/* Tab Navigation */}
        <div className="flex space-x-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
          <Button
            variant={activeTab === 'discover' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('discover')}
            className="flex-1"
          >
            <Globe className="h-4 w-4 mr-2" />
            Discover Feeds
          </Button>
          <Button
            variant={activeTab === 'preview' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('preview')}
            className="flex-1"
          >
            <Eye className="h-4 w-4 mr-2" />
            Preview & Select
          </Button>
        </div>

        <div className="space-y-4">
          {/* Discover Tab Content */}
          {activeTab === 'discover' && (
            <div className="space-y-4">
              {!infospaceId && (
                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                  <p className="text-sm text-yellow-600">
                    ⚠️ No active infospace found. Please select an infospace or create one to discover and ingest RSS feeds.
                  </p>
                </div>
              )}
              
              {/* Discovery Controls */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="country-select">Country</Label>
                  <Select value={selectedCountry} onValueChange={setSelectedCountry}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a country" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableCountries.map((country) => (
                        <SelectItem key={country} value={country}>
                          {country}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="category-filter">Category Filter (Optional)</Label>
                  <Input
                    id="category-filter"
                    placeholder="e.g., News, Technology, Sports"
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                  />
                </div>
              </div>
              
              <Button 
                onClick={discoverFeeds} 
                disabled={discoverLoading || !selectedCountry || !infospaceId}
                className="w-full"
              >
                {discoverLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Globe className="h-4 w-4 mr-2" />
                )}
                {!infospaceId ? "No Active Infospace" : "Discover RSS Feeds"}
              </Button>
            </div>
          )}

          {/* Removed browse tab content - functionality moved to preview tab */}

          {/* Error Display */}
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {/* Discovered Feeds */}
          {activeTab === 'discover' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">
                  Discovered Feeds ({discoveredFeeds.length})
                </h3>
                {discoveredFeeds.length > 0 && (
                  <Button
                    onClick={() => ingestSelectedFeeds(discoveredFeeds)}
                    disabled={ingestLoading}
                    className="bg-green-600 hover:bg-green-700 text-white"
                  >
                    {ingestLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Download className="h-4 w-4 mr-2" />
                    )}
                    Ingest All Feeds
                  </Button>
                )}
              </div>
              
              <ScrollArea className="h-96">
                <div className="space-y-3">
                  {discoveredFeeds.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Globe className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>No feeds discovered yet. Select a country and click "Discover RSS Feeds" to get started.</p>
                    </div>
                  ) : (
                    discoveredFeeds.map((feed, index) => (
                    <Card 
                      key={index} 
                      className="hover:shadow-md transition-all cursor-pointer border border-blue-100 dark:border-blue-900 bg-blue-50/20 dark:bg-blue-950/10 hover:bg-blue-100/30 dark:hover:bg-blue-900/20"
                      onClick={() => previewDiscoveredFeed(feed.url, feed.title)}
                    >
                      <CardContent className="p-4">
                        <div className="space-y-2">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <h4 className="font-medium text-sm leading-tight">
                                {feed.title}
                              </h4>
                              {feed.description && (
                                <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                                  {feed.description}
                                </p>
                              )}
                            </div>
                            <div className="flex gap-1 ml-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  window.open(feed.url, '_blank');
                                }}
                              >
                                <ExternalLink className="h-3 w-3" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  previewDiscoveredFeed(feed.url, feed.title);
                                }}
                              >
                                <Eye className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                          
                          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                            <Badge variant="secondary" className="text-xs">
                              {feed.country}
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              <Globe className="h-2 w-2 mr-1" />
                              awesome-rss-feeds
                            </Badge>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* Removed Feed Information section - functionality moved to preview tab */}

          {/* Removed Feed Items section - functionality moved to preview tab */}

          {/* Preview Tab Content */}
          {activeTab === 'preview' && (
            <div className="space-y-4">
              {/* Feed URL Input */}
              <div className="space-y-2">
                <Label htmlFor="preview-feed-url">RSS Feed URL</Label>
                <div className="flex gap-2">
                  <Input
                    id="preview-feed-url"
                    placeholder="https://example.com/feed.xml"
                    value={previewFeedUrl}
                    onChange={(e) => setPreviewFeedUrl(e.target.value)}
                    className="flex-1"
                  />
                  <Button
                    onClick={previewFeed}
                    disabled={previewing || !previewFeedUrl.trim()}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    {previewing ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Eye className="h-4 w-4 mr-2" />
                    )}
                    Preview Feed
                  </Button>
                </div>
              </div>

              {/* Feed Preview */}
              {previewData && (
                <div className="space-y-4">
                  {/* Feed Info */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">{previewData.feed_info.title}</CardTitle>
                      <CardDescription>
                        {previewData.feed_info.description}
                      </CardDescription>
                      <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                        <Badge variant="secondary">
                          {previewData.feed_info.total_items} total items
                        </Badge>
                        {previewData.feed_info.language && (
                          <Badge variant="outline">
                            {previewData.feed_info.language}
                          </Badge>
                        )}
                        {previewData.feed_info.updated && (
                          <Badge variant="outline">
                            <Calendar className="h-2 w-2 mr-1" />
                            Updated: {formatDate(previewData.feed_info.updated)}
                          </Badge>
                        )}
                      </div>
                    </CardHeader>
                  </Card>

                  {/* Article Selection Controls */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-semibold">
                        Articles ({previewData.items.length})
                      </h3>
                      <Badge variant="outline">
                        {selectedArticles.size} selected
                      </Badge>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={selectAllArticles}
                        disabled={selectedArticles.size === previewData.items.length}
                      >
                        Select All
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={deselectAllArticles}
                        disabled={selectedArticles.size === 0}
                      >
                        Deselect All
                      </Button>
                    </div>
                  </div>

                  {/* Articles List */}
                  <ScrollArea className="h-96">
                    <div className="space-y-3">
                      {previewData.items.map((item: any, index: number) => (
                        <Card 
                          key={index} 
                          className={`cursor-pointer transition-all ${
                            selectedArticles.has(index) 
                              ? 'ring-2 ring-blue-500 bg-blue-50 dark:bg-blue-950/20' 
                              : 'hover:shadow-md'
                          }`}
                          onClick={() => toggleArticleSelection(index)}
                        >
                          <CardContent className="p-4">
                            <div className="flex items-start gap-3">
                              <div className="mt-1">
                                <input
                                  type="checkbox"
                                  checked={selectedArticles.has(index)}
                                  onChange={() => toggleArticleSelection(index)}
                                  className="h-4 w-4 text-blue-600 rounded border-gray-300"
                                />
                              </div>
                              <div className="flex-1 space-y-2">
                                <h4 className="font-medium text-sm leading-tight">
                                  {item.title}
                                </h4>
                                {item.summary && (
                                  <p className="text-sm text-muted-foreground line-clamp-2">
                                    {item.summary}
                                  </p>
                                )}
                                
                                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                                  {item.published && (
                                    <div className="flex items-center gap-1">
                                      <Calendar className="h-3 w-3" />
                                      {formatDate(item.published)}
                                    </div>
                                  )}
                                  {item.author && (
                                    <div className="flex items-center gap-1">
                                      <User className="h-3 w-3" />
                                      {item.author}
                                    </div>
                                  )}
                                </div>
                                
                                {item.tags && item.tags.length > 0 && (
                                  <div className="flex flex-wrap gap-1">
                                    {item.tags.slice(0, 3).map((tag: string, tagIndex: number) => (
                                      <Badge key={tagIndex} variant="outline" className="text-xs">
                                        <Tag className="h-2 w-2 mr-1" />
                                        {tag}
                                      </Badge>
                                    ))}
                                    {item.tags.length > 3 && (
                                      <Badge variant="outline" className="text-xs">
                                        +{item.tags.length - 3} more
                                      </Badge>
                                    )}
                                  </div>
                                )}
                              </div>
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    window.open(item.link, '_blank');
                                  }}
                                >
                                  <ExternalLink className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </ScrollArea>

                  {/* Action Buttons */}
                  <div className="flex gap-2 pt-4 border-t">
                    <Button
                      onClick={() => ingestSelectedArticles()}
                      disabled={selectedArticles.size === 0 || ingestLoading}
                      className="bg-green-600 hover:bg-green-700 text-white"
                    >
                      {ingestLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Download className="h-4 w-4 mr-2" />
                      )}
                      Ingest Selected ({selectedArticles.size})
                    </Button>
                    
                    <Button
                      onClick={() => createRssSource(false)}
                      disabled={creatingSource}
                      variant="outline"
                    >
                      {creatingSource ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Plus className="h-4 w-4 mr-2" />
                      )}
                      Create Source
                    </Button>
                    
                    <Button
                      onClick={() => createRssSource(true)}
                      disabled={creatingSource}
                      variant="outline"
                    >
                      {creatingSource ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Clock className="h-4 w-4 mr-2" />
                      )}
                      Create & Monitor
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
