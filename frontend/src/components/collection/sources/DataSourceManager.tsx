import React, { useEffect, useState, useMemo } from 'react';
import { useSourceStore } from '@/zustand_stores/storeSources';
import { useBundleStore } from '@/zustand_stores/storeBundles';
import useAuth from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  RadioTower, 
  Repeat, 
  Plus, 
  Search, 
  AlertCircle,
  ChevronLeft,
  TrendingUp
} from 'lucide-react';
import UnifiedSourceConfiguration from '@/components/collection/sources/configuration/UnifiedSourceConfiguration';
import SearchComponent from '@/components/collection/search/SearchComponent';
import SourceEditDialog from '@/components/collection/sources/SourceEditDialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StreamCard } from './StreamCard';
import { SourcesService } from '@/client';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { toast } from 'sonner';

interface DataSourceManagerProps {
  onClose?: () => void;
}

export default function DataSourceManager({ onClose }: DataSourceManagerProps = {}) {
  const { sources, isLoading, error, fetchSources, deleteSource } = useSourceStore();
  const { bundles, fetchBundles } = useBundleStore();
  const { activeInfospace } = useInfospaceStore();
  const { isLoggedIn, isLoading: authLoading } = useAuth();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<any | null>(null);
  const [activeTab, setActiveTab] = useState('sources');

  useEffect(() => {
    // Only fetch sources when user is authenticated
    if (isLoggedIn && !authLoading) {
      fetchSources();
      if (activeInfospace?.id) {
        fetchBundles(activeInfospace.id);
      }
    }
  }, [fetchSources, fetchBundles, isLoggedIn, authLoading, activeInfospace?.id]);

  const handleSuccess = () => {
    setIsCreateOpen(false);
    fetchSources();
  };

  const handleSearchAssetsCreated = (assets: any[]) => {
    // Refresh sources to show the newly created search source
    fetchSources();
  };

  // Group sources by status
  const groupedSources = useMemo(() => {
    const statusLower = (s: any) => (s.status || '').toLowerCase();
    const active = sources.filter(s => (s.is_active ?? false) && statusLower(s) === 'active');
    const paused = sources.filter(s => !(s.is_active ?? false) || statusLower(s) === 'paused');
    const other = sources.filter(s => 
      !active.includes(s) && !paused.includes(s)
    );
    return { active, paused, other };
  }, [sources]);

  // Calculate aggregate stats
  const aggregateStats = useMemo(() => {
    const activeSources = groupedSources.active;
    const totalItemsPerHour = activeSources.reduce((sum, s) => {
      const itemsLastPoll = s.items_last_poll ?? 0;
      const pollInterval = (s as any).poll_interval_seconds ?? 300;
      const itemsPerHour = itemsLastPoll > 0 
        ? Math.round((itemsLastPoll / pollInterval) * 3600)
        : 0;
      return sum + itemsPerHour;
    }, 0);
    const totalItemsIngested = sources.reduce((sum, s) => sum + (s.total_items_ingested ?? 0), 0);
    
    return {
      activeCount: activeSources.length,
      totalItemsPerHour,
      totalItemsIngested,
    };
  }, [groupedSources, sources]);

  // Get bundle names for display
  const getBundleName = (bundleId?: number | null) => {
    if (!bundleId) return undefined;
    return bundles.find(b => b.id === bundleId)?.name;
  };

  const handleActivate = async (sourceId: number) => {
    if (!activeInfospace?.id) return;
    try {
      // Note: These methods will be available after frontend client regeneration
      const activateMethod = (SourcesService as any).activateStream;
      if (!activateMethod) {
        toast.error('Stream activation not yet available - please regenerate frontend client');
        return;
      }
      await activateMethod({
        infospaceId: activeInfospace.id,
        sourceId,
      });
      toast.success('Stream activated');
      fetchSources();
    } catch (error) {
      toast.error('Failed to activate stream');
      console.error(error);
    }
  };

  const handlePause = async (sourceId: number) => {
    if (!activeInfospace?.id) return;
    try {
      const pauseMethod = (SourcesService as any).pauseStream;
      if (!pauseMethod) {
        toast.error('Stream pause not yet available - please regenerate frontend client');
        return;
      }
      await pauseMethod({
        infospaceId: activeInfospace.id,
        sourceId,
      });
      toast.success('Stream paused');
      fetchSources();
    } catch (error) {
      toast.error('Failed to pause stream');
      console.error(error);
    }
  };

  const handlePoll = async (sourceId: number) => {
    if (!activeInfospace?.id) return;
    try {
      const pollMethod = (SourcesService as any).pollSource;
      if (!pollMethod) {
        toast.error('Poll not yet available - please regenerate frontend client');
        return;
      }
      await pollMethod({
        infospaceId: activeInfospace.id,
        sourceId,
      });
      toast.success('Poll triggered');
      fetchSources();
    } catch (error) {
      toast.error('Failed to trigger poll');
      console.error(error);
    }
  };

  const handleEditSource = (source: any) => {
    setEditingSource(source);
  };

  const handleDeleteSource = async (sourceId: number, sourceName: string) => {
    if (confirm(`Are you sure you want to delete "${sourceName}"? This action cannot be undone.`)) {
      try {
        await deleteSource(sourceId);
      } catch (error) {
        console.error('Failed to delete source:', error);
      }
    }
  };

  return (
    <div className="flex flex-col h-full w-full max-w-screen-3xl mx-auto px-2 sm:px-4 md:px-6 overflow-hidden">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 mb-4 sm:mb-6">
        <div className="flex items-center gap-2 sm:gap-3">
          {onClose && (
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={onClose}
              className="h-8 w-8 sm:h-9 sm:w-9 p-0 flex-shrink-0"
            >
              <ChevronLeft className="h-4 w-4 sm:h-5 sm:w-5" />
            </Button>
          )}
          <div className="p-2 sm:p-2.5 flex items-center gap-1.5 sm:gap-2 rounded-md bg-blue-50/20 dark:bg-blue-950/10 border border-blue-200 dark:border-blue-800 shadow-sm flex-shrink-0">
            <RadioTower className="h-5 w-5 sm:h-6 sm:w-6 text-blue-700 dark:text-blue-400" />
            <Repeat className="h-5 w-5 sm:h-6 sm:w-6 text-blue-700 dark:text-blue-400" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100 truncate">Data Ingestion</h1>
            <p className="text-gray-600 dark:text-gray-400 text-xs sm:text-sm truncate">
              Search, discover, and manage your data sources
            </p>
          </div>
        </div>
        <Button onClick={() => setIsCreateOpen(true)} className="w-full sm:w-auto flex-shrink-0" size="sm">
          <Plus className="h-4 w-4 mr-2" />
          <span className="hidden xs:inline">New Source</span>
          <span className="xs:hidden">New</span>
        </Button>
      </div>

      {/* Main Content with Tabs */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
          <TabsList className="grid w-full grid-cols-2 mb-3 sm:mb-4">
            <TabsTrigger value="search" className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm">
              <Search className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span className="hidden xs:inline">Search & Discover</span>
              <span className="xs:hidden">Search</span>
            </TabsTrigger>
            <TabsTrigger value="sources" className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm">
              <RadioTower className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span className="hidden xs:inline">Managed Sources</span>
              <span className="xs:hidden">Sources</span>
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 min-h-0 overflow-hidden">
            <TabsContent value="search" className="h-full m-0">
              <SearchComponent 
                onAssetsCreated={handleSearchAssetsCreated}
                className="h-full"
              />
            </TabsContent>

            <TabsContent value="sources" className="h-full m-0 overflow-y-auto">
              {isLoading && (
                <div className="flex items-center justify-center h-32">
                  <div className="flex items-center gap-2 text-muted-foreground text-sm">
                    <Repeat className="h-4 w-4 animate-spin" />
                    Loading sources...
                  </div>
                </div>
              )}
              
              {error && (
                <Card className="border-red-200 bg-red-50 dark:bg-red-950/20">
                  <CardContent className="p-3 sm:p-4">
                    <div className="flex items-center gap-2 text-red-600 text-sm">
                      <AlertCircle className="h-4 w-4 flex-shrink-0" />
                      <span className="break-words">{error}</span>
                    </div>
                  </CardContent>
                </Card>
              )}

              {!isLoading && !error && (
                <>
                  {sources.length === 0 ? (
                    <Card className="border-dashed">
                      <CardContent className="flex flex-col items-center justify-center py-8 sm:py-12 px-4">
                        <RadioTower className="h-10 w-10 sm:h-12 sm:w-12 text-muted-foreground mb-3 sm:mb-4" />
                        <h3 className="text-base sm:text-lg font-medium mb-2 text-center">No sources configured</h3>
                        <p className="text-muted-foreground text-center mb-3 sm:mb-4 text-sm">
                          Create your first data source to start ingesting content
                        </p>
                        <Button onClick={() => setIsCreateOpen(true)} size="sm">
                          <Plus className="h-4 w-4 mr-2" />
                          Create Source
                        </Button>
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="space-y-4 h-full flex flex-col min-h-[70svh] md:min-h-[72.75svh] max-h-[76.75svh] w-full max-w-full overflow-y-auto scrollbar-hide">
                      {/* Aggregate Stats */}
                      {aggregateStats.activeCount > 0 && (
                        <Card className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
                          <CardContent className="p-3 sm:p-4">
                            <div className="grid grid-cols-3 gap-2 sm:gap-4">
                              <div className="text-center sm:text-left">
                                <p className="text-xs sm:text-sm text-muted-foreground truncate">Active Streams</p>
                                <p className="text-xl sm:text-2xl font-bold">{aggregateStats.activeCount}</p>
                              </div>
                              <div className="text-center sm:text-right">
                                <p className="text-xs sm:text-sm text-muted-foreground truncate">Items/Hour</p>
                                <p className="text-xl sm:text-2xl font-bold flex items-center justify-center sm:justify-end gap-1">
                                  <TrendingUp className="h-4 w-4 sm:h-5 sm:w-5" />
                                  {aggregateStats.totalItemsPerHour}
                                </p>
                              </div>
                              <div className="text-center sm:text-right">
                                <p className="text-xs sm:text-sm text-muted-foreground truncate">Total Ingested</p>
                                <p className="text-xl sm:text-2xl font-bold">{aggregateStats.totalItemsIngested.toLocaleString()}</p>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      )}

                      {/* Active Streams */}
                      {groupedSources.active.length > 0 && (
                        <div>
                          <h3 className="text-base sm:text-lg font-semibold mb-2 sm:mb-3">
                            Active Streams ({groupedSources.active.length})
                          </h3>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                            {groupedSources.active.map(source => (
                              <StreamCard
                                key={source.id}
                                source={source as any}
                                outputBundleName={getBundleName(source.output_bundle_id)}
                                onActivate={handleActivate}
                                onPause={handlePause}
                                onPoll={handlePoll}
                                onConfigure={handleEditSource}
                              />
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Paused Streams */}
                      {groupedSources.paused.length > 0 && (
                        <div>
                          <h3 className="text-base sm:text-lg font-semibold mb-2 sm:mb-3">
                            Paused Streams ({groupedSources.paused.length})
                          </h3>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                            {groupedSources.paused.map(source => (
                              <StreamCard
                                key={source.id}
                                source={source as any}
                                outputBundleName={getBundleName(source.output_bundle_id)}
                                onActivate={handleActivate}
                                onPause={handlePause}
                                onPoll={handlePoll}
                                onConfigure={handleEditSource}
                              />
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Other Sources */}
                      {groupedSources.other.length > 0 && (
                        <div>
                          <h3 className="text-base sm:text-lg font-semibold mb-2 sm:mb-3">
                            Other Sources ({groupedSources.other.length})
                          </h3>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                            {groupedSources.other.map(source => (
                              <StreamCard
                                key={source.id}
                                source={source as any}
                                outputBundleName={getBundleName(source.output_bundle_id)}
                                onActivate={handleActivate}
                                onPause={handlePause}
                                onPoll={handlePoll}
                                onConfigure={handleEditSource}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </TabsContent>
          </div>
        </Tabs>
      </div>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-7xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base sm:text-lg">Create New Stream</DialogTitle>
          </DialogHeader>
          <UnifiedSourceConfiguration onSuccess={handleSuccess} />
        </DialogContent>
      </Dialog>

      <SourceEditDialog
        source={editingSource}
        open={!!editingSource}
        onClose={() => setEditingSource(null)}
      />
    </div>
  );
}
