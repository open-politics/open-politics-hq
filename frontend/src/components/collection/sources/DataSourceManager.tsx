import React, { useEffect, useState } from 'react';
import { useSourceStore } from '@/zustand_stores/storeSources';
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
  Settings, 
  Play, 
  Pause, 
  MoreVertical,
  Globe,
  Rss,
  FileText,
  Database,
  Clock,
  CheckCircle,
  AlertCircle,
  XCircle,
  ChevronLeft
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import UnifiedSourceConfiguration from '@/components/collection/sources/configuration/UnifiedSourceConfiguration';
import SearchComponent from '@/components/collection/search/SearchComponent';
import SourceEditDialog from '@/components/collection/sources/SourceEditDialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatDistanceToNow } from 'date-fns';

const sourceKindIcons = {
  'rss': Rss,
  'search': Search,
  'url_list': Globe,
  'site_discovery': Globe,
  'upload': FileText,
  'text_block_ingest': FileText,
  'default': Database
};

const statusColors = {
  'pending': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
  'processing': 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  'complete': 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  'failed': 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'
};

const statusIcons = {
  'pending': Clock,
  'processing': Repeat,
  'complete': CheckCircle,
  'failed': XCircle
};

interface DataSourceManagerProps {
  onClose?: () => void;
}

export default function DataSourceManager({ onClose }: DataSourceManagerProps = {}) {
  const { sources, isLoading, error, fetchSources, triggerSourceProcessing, deleteSource } = useSourceStore();
  const { isLoggedIn, isLoading: authLoading } = useAuth();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<any | null>(null);
  const [activeTab, setActiveTab] = useState('sources');

  useEffect(() => {
    // Only fetch sources when user is authenticated
    if (isLoggedIn && !authLoading) {
      fetchSources();
    }
  }, [fetchSources, isLoggedIn, authLoading]);

  const handleSuccess = () => {
    setIsCreateOpen(false);
    fetchSources();
  };

  const handleSearchAssetsCreated = (assets: any[]) => {
    // Refresh sources to show the newly created search source
    fetchSources();
  };

  const handleTriggerProcessing = async (sourceId: number) => {
    try {
      await triggerSourceProcessing(sourceId);
    } catch (error) {
      console.error('Failed to trigger processing:', error);
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

  const renderSourceCard = (source: any) => {
    const IconComponent = sourceKindIcons[source.kind] || sourceKindIcons.default;
    const StatusIcon = statusIcons[source.status] || Clock;
    const statusColor = statusColors[source.status] || statusColors.pending;

    return (
      <Card key={source.id} className="hover:shadow-md transition-shadow">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/20">
                <IconComponent className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <CardTitle className="text-base">{source.name}</CardTitle>
                <CardDescription className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    {source.kind.replace('_', ' ')}
                  </Badge>
                  <Badge className={`text-xs ${statusColor}`}>
                    <StatusIcon className="h-3 w-3 mr-1" />
                    {source.status}
                  </Badge>
                </CardDescription>
              </div>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleTriggerProcessing(source.id)}>
                  <Play className="h-4 w-4 mr-2" />
                  Run Now
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleEditSource(source)}>
                  <Settings className="h-4 w-4 mr-2" />
                  Configure
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem 
                  className="text-red-600"
                  onClick={() => handleDeleteSource(source.id, source.name)}
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardHeader>

        <CardContent className="pt-0">
          <div className="space-y-2 text-sm text-muted-foreground">
            {source.details?.feed_url && (
              <div className="flex items-center gap-2">
                <Globe className="h-3 w-3" />
                <span className="truncate">{source.details.feed_url}</span>
              </div>
            )}
            {source.details?.search_config?.query && (
              <div className="flex items-center gap-2">
                <Search className="h-3 w-3" />
                <span className="truncate">"{source.details.search_config.query}"</span>
              </div>
            )}
            {source.updated_at && (
              <div className="flex items-center gap-2">
                <Clock className="h-3 w-3" />
                <span>Updated {formatDistanceToNow(new Date(source.updated_at))} ago</span>
              </div>
            )}
            {source.enable_monitoring && (
              <div className="flex items-center gap-2">
                <Repeat className="h-3 w-3 text-blue-500" />
                <span>Monitoring enabled</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="flex flex-col h-full w-full max-w-screen-3xl mx-auto px-1 sm:px-2 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          {onClose && (
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={onClose}
              className="h-9 w-9 p-0"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
          )}
          <div className="p-2.5 flex items-center gap-2 rounded-xl bg-blue-50/20 dark:bg-blue-950/10 border border-blue-200 dark:border-blue-800 shadow-sm">
            <RadioTower className="h-6 w-6 text-blue-700 dark:text-blue-400" />
            <Repeat className="h-6 w-6 text-blue-700 dark:text-blue-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Data Ingestion</h1>
            <p className="text-gray-600 dark:text-gray-400 text-sm">
              Search, discover, and manage your data sources
            </p>
          </div>
        </div>
        <Button onClick={() => setIsCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New Source
        </Button>
      </div>

      {/* Main Content with Tabs */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
          <TabsList className="grid w-full grid-cols-2 mb-4">
            <TabsTrigger value="search" className="flex items-center gap-2">
              <Search className="h-4 w-4" />
              Search & Discover
            </TabsTrigger>
            <TabsTrigger value="sources" className="flex items-center gap-2">
              <RadioTower className="h-4 w-4" />
              Managed Sources
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
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Repeat className="h-4 w-4 animate-spin" />
                    Loading sources...
                  </div>
                </div>
              )}
              
              {error && (
                <Card className="border-red-200 bg-red-50 dark:bg-red-950/20">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 text-red-600">
                      <AlertCircle className="h-4 w-4" />
                      <span>{error}</span>
                    </div>
                  </CardContent>
                </Card>
              )}

              {!isLoading && !error && (
                <>
                  {sources.length === 0 ? (
                    <Card className="border-dashed">
                      <CardContent className="flex flex-col items-center justify-center py-12">
                        <RadioTower className="h-12 w-12 text-muted-foreground mb-4" />
                        <h3 className="text-lg font-medium mb-2">No sources configured</h3>
                        <p className="text-muted-foreground text-center mb-4">
                          Create your first data source to start ingesting content
                        </p>
                        <Button onClick={() => setIsCreateOpen(true)}>
                          <Plus className="h-4 w-4 mr-2" />
                          Create Source
                        </Button>
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {sources.map(renderSourceCard)}
                    </div>
                  )}
                </>
              )}
            </TabsContent>
          </div>
        </Tabs>
      </div>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create New Source</DialogTitle>
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
