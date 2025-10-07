'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { 
  Layers, 
  FileText, 
  FileSpreadsheet, 
  Image as ImageIcon, 
  Video, 
  Music, 
  Mail, 
  Globe, 
  Type,
  File,
  Eye,
  ArrowRight,
  Loader2,
  AlertCircle,
  Calendar,
  Hash,
  Download,
  Share2,
  PlayCircle,
  MoreHorizontal,
  Upload,
  List
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import {
  AssetRead,
  AssetKind,
  BundleRead,
} from '@/client';
import { useBundleStore } from '@/zustand_stores/storeBundles';
import { useAssetStore } from '@/zustand_stores/storeAssets';
import AssetDetailView from './AssetDetailView';
import { AssetPreview } from './AssetPreviewComponents';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Asset icon helper
const getAssetIcon = (kind: AssetKind, className?: string) => {
  const iconClass = cn("h-4 w-4", className);
  switch (kind) {
    case 'pdf': return <FileText className={cn(iconClass, "text-red-600")} />;
    case 'csv': return <FileSpreadsheet className={cn(iconClass, "text-green-600")} />;
    case 'csv_row': return <List className={cn(iconClass, "text-emerald-600")} />;
    case 'image': return <ImageIcon className={cn(iconClass, "text-purple-600")} />;
    case 'video': return <Video className={cn(iconClass, "text-orange-600")} />;
    case 'audio': return <Music className={cn(iconClass, "text-teal-600")} />;
    case 'mbox':
    case 'email': return <Mail className={cn(iconClass, "text-blue-600")} />;
    case 'web': return <Globe className={cn(iconClass, "text-sky-600")} />;
    case 'text':
    case 'text_chunk': return <Type className={cn(iconClass, "text-indigo-600")} />;
    default: return <File className={cn(iconClass, "text-muted-foreground")} />;
  }
};

// Asset composition stats
const getCompositionStats = (assets: AssetRead[]) => {
  const stats = new Map<AssetKind, { count: number; totalChildren: number }>();
  let totalChildAssets = 0;

  assets.forEach(asset => {
    const current = stats.get(asset.kind) || { count: 0, totalChildren: 0 };
    current.count += 1;
    let childCount = 0;
    if (asset.kind === 'csv' && asset.source_metadata?.row_count) {
      childCount = asset.source_metadata.row_count as number;
    } else if (asset.kind === 'pdf' && asset.source_metadata?.page_count) {
      childCount = asset.source_metadata.page_count as number;
    }
    current.totalChildren += childCount;
    totalChildAssets += childCount;
    stats.set(asset.kind, current);
  });

  return { stats, totalChildAssets };
};

interface BundleDetailViewProps {
  selectedBundleId: number | null;
  onLoadIntoRunner?: (runId: number, runName: string) => void;
  selectedAssetId: number | null;
  onAssetSelect: (id: number | null) => void;
  onAssetDragStart?: (asset: AssetRead, event: React.DragEvent) => void;
  onAssetDragEnd?: () => void;
  highlightAssetId: number | null;
}

export default function BundleDetailView({ 
  selectedBundleId, 
  onLoadIntoRunner,
  selectedAssetId,
  onAssetSelect,
  onAssetDragStart,
  onAssetDragEnd,
  highlightAssetId
}: BundleDetailViewProps) {
  const {
    bundles,
    getBundleAssets,
    isLoading: isLoadingBundles,
    error: bundleError,
  } = useBundleStore();

  const { fetchChildAssets } = useAssetStore();

  const [selectedBundle, setSelectedBundle] = useState<BundleRead | null>(null);
  const [bundleAssets, setBundleAssets] = useState<AssetRead[]>([]);
  const [isLoadingAssets, setIsLoadingAssets] = useState(false);
  const [activeTab, setActiveTab] = useState<string>('all');
  
  // Media blob URLs for authenticated access
  const [mediaBlobUrls, setMediaBlobUrls] = useState<Map<string, string>>(new Map());
  const [isLoadingMedia, setIsLoadingMedia] = useState<Set<string>>(new Set());
  
  // State for child assets from hierarchical assets
  const [allChildAssets, setAllChildAssets] = useState<AssetRead[]>([]);
  const [isLoadingChildAssets, setIsLoadingChildAssets] = useState(false);
  
  // State for selected image in the Images tab
  const [selectedImageAsset, setSelectedImageAsset] = useState<AssetRead | null>(null);

  // Function to fetch authenticated media files and create blob URLs
  const fetchMediaBlob = async (blobPath: string): Promise<string | null> => {
    if (!blobPath) return null;

    // Check if we already have a blob URL for this path
    if (mediaBlobUrls.has(blobPath)) {
      return mediaBlobUrls.get(blobPath)!;
    }

    // Check if we're already loading this media
    if (isLoadingMedia.has(blobPath)) {
      return null;
    }

    setIsLoadingMedia(prev => new Set([...prev, blobPath]));

    try {
      const response = await fetch(`/api/v1/files/stream/${encodeURIComponent(blobPath)}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch media: ${response.status} ${response.statusText}`);
      }

      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);

      setMediaBlobUrls(prev => new Map(prev.set(blobPath, blobUrl)));
      return blobUrl;
    } catch (error) {
      console.error('Error fetching media blob:', error);
      return null;
    } finally {
      setIsLoadingMedia(prev => {
        const newSet = new Set(prev);
        newSet.delete(blobPath);
        return newSet;
      });
    }
  };

  // Authenticated Image component
  const AuthenticatedImage = ({ asset, className }: { asset: AssetRead; className?: string }) => {
    const [imageSrc, setImageSrc] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [hasError, setHasError] = useState(false);

    useEffect(() => {
      const loadImage = async () => {
        setIsLoading(true);
        setHasError(false);
        
        // Try external source first if available
        if (asset.source_identifier) {
          try {
            const img = new Image();
            img.onload = () => {
              setImageSrc(asset.source_identifier!);
              setIsLoading(false);
            };
            img.onerror = () => {
              // Fallback to blob path if external fails
              if (asset.blob_path) {
                fetchMediaBlob(asset.blob_path).then(blobUrl => {
                  if (blobUrl) {
                    setImageSrc(blobUrl);
                  } else {
                    setHasError(true);
                  }
                  setIsLoading(false);
                });
              } else {
                setHasError(true);
                setIsLoading(false);
              }
            };
            img.src = asset.source_identifier;
            return;
          } catch (error) {
            // Continue to blob path fallback
          }
        }
        
        // Use blob path
        if (asset.blob_path) {
          try {
            const blobUrl = await fetchMediaBlob(asset.blob_path);
            if (blobUrl) {
              setImageSrc(blobUrl);
            } else {
              setHasError(true);
            }
          } catch (error) {
            setHasError(true);
          }
        } else {
          setHasError(true);
        }
        setIsLoading(false);
      };
      
      loadImage();
    }, [asset.source_identifier, asset.blob_path]);

    if (isLoading) {
      return (
        <div className={cn("flex items-center justify-center bg-muted/50 rounded", className)}>
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      );
    }

    if (hasError || !imageSrc) {
      return (
        <div className={cn("flex flex-col items-center justify-center bg-muted/50 rounded text-muted-foreground", className)}>
          <ImageIcon className="h-8 w-8 mb-1 opacity-50" />
          <span className="text-xs">Failed to load</span>
        </div>
      );
    }

    return (
      <img 
        src={imageSrc} 
        alt={asset.title || 'Bundle image'} 
        className={cn("object-cover rounded", className)}
        onError={() => setHasError(true)}
      />
    );
  };

  // Helper function to filter out .gif images
  const isGifImage = (asset: AssetRead): boolean => {
    if (asset.source_identifier && asset.source_identifier.toLowerCase().includes('.gif')) return true;
    if (asset.blob_path && asset.blob_path.toLowerCase().includes('.gif')) return true;
    return false;
  };

  // Filter assets by type and exclude GIFs for images
  const filteredAssets = useMemo(() => {
    const nonGifAssets = bundleAssets.filter(asset => {
      if (asset.kind === 'image' && isGifImage(asset)) return false;
      return true;
    });

    // Include child image assets from hierarchical assets
    const childImageAssets = allChildAssets.filter(asset => {
      if (asset.kind === 'image' && !isGifImage(asset)) return true;
      return false;
    });

    // Combine direct image assets with child image assets
    const allImages = [
      ...nonGifAssets.filter(asset => asset.kind === 'image'),
      ...childImageAssets
    ];

    const assetsByType = {
      all: nonGifAssets,
      images: allImages,
      documents: nonGifAssets.filter(asset => ['pdf', 'csv'].includes(asset.kind)),
      web: nonGifAssets.filter(asset => asset.kind === 'web'),
      media: nonGifAssets.filter(asset => ['video', 'audio'].includes(asset.kind)),
      text: nonGifAssets.filter(asset => ['text', 'text_chunk'].includes(asset.kind)),
      other: nonGifAssets.filter(asset => !['image', 'pdf', 'csv', 'web', 'video', 'audio', 'text', 'text_chunk'].includes(asset.kind))
    };

    return assetsByType;
  }, [bundleAssets, allChildAssets]);

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      mediaBlobUrls.forEach(url => {
        URL.revokeObjectURL(url);
      });
    };
  }, [mediaBlobUrls]);

  useEffect(() => {
    if (selectedBundleId) {
      const bundle = bundles.find(b => b.id === selectedBundleId);
      setSelectedBundle(bundle || null);
      if (selectedAssetId && !bundleAssets.some(a => a.id === selectedAssetId)) {
        onAssetSelect(null);
      }
    } else {
      setSelectedBundle(null);
      onAssetSelect(null);
    }
  }, [selectedBundleId, bundles, bundleAssets, selectedAssetId, onAssetSelect]);

  useEffect(() => {
    if (selectedBundle) {
      setIsLoadingAssets(true);
      getBundleAssets(selectedBundle.id)
        .then(assets => setBundleAssets(assets))
        .catch(error => {
          console.error('Failed to load bundle assets:', error);
          toast.error('Failed to load bundle assets');
          setBundleAssets([]);
        })
        .finally(() => setIsLoadingAssets(false));
    } else {
      setBundleAssets([]);
    }
  }, [selectedBundle, getBundleAssets]);

  // Add effect to refresh bundle assets when the bundle's asset_count changes
  useEffect(() => {
    if (selectedBundle && selectedBundle.asset_count !== undefined) {
      // If we have assets but the count doesn't match, refresh
      if (bundleAssets.length !== selectedBundle.asset_count) {
        console.log(`Bundle asset count mismatch: have ${bundleAssets.length}, expected ${selectedBundle.asset_count}. Refreshing...`);
        setIsLoadingAssets(true);
        getBundleAssets(selectedBundle.id)
          .then(assets => setBundleAssets(assets))
          .catch(error => {
            console.error('Failed to refresh bundle assets:', error);
          })
          .finally(() => setIsLoadingAssets(false));
      }
    }
  }, [selectedBundle?.asset_count, bundleAssets.length, selectedBundle?.id, getBundleAssets]);

  // Effect to fetch child assets from hierarchical assets
  useEffect(() => {
    const fetchAllChildAssets = async () => {
      if (bundleAssets.length === 0) {
        setAllChildAssets([]);
        return;
      }

      setIsLoadingChildAssets(true);
      const allChildren: AssetRead[] = [];

      try {
        // Find hierarchical assets that might have child assets
        const hierarchicalAssets = bundleAssets.filter(asset => 
          asset.kind === 'web' || asset.kind === 'pdf' || asset.kind === 'csv' || 
          asset.kind === 'mbox' || asset.is_container
        );

        // Fetch child assets for each hierarchical asset
        for (const asset of hierarchicalAssets) {
          try {
            const children = await fetchChildAssets(asset.id);
            if (children && children.length > 0) {
              allChildren.push(...children);
            }
          } catch (error) {
            console.error(`Failed to fetch child assets for asset ${asset.id}:`, error);
          }
        }

        setAllChildAssets(allChildren);
      } catch (error) {
        console.error('Error fetching child assets:', error);
        setAllChildAssets([]);
      } finally {
        setIsLoadingChildAssets(false);
      }
    };

    fetchAllChildAssets();
  }, [bundleAssets, fetchChildAssets]);

  const handleAssetSelect = (asset: AssetRead) => onAssetSelect(asset.id);

  const handleAssetViewAction = (asset: AssetRead, action: string) => {
    switch (action) {
      case 'view': onAssetSelect(asset.id); break;
      case 'download': toast.info(`Download functionality not yet implemented for ${asset.title}`); break;
      case 'share': toast.info(`Share functionality not yet implemented for ${asset.title}`); break;
    }
  };

  // Handle image selection within the Images tab
  const handleImageSelect = (asset: AssetRead) => {
    if (activeTab === 'images') {
      setSelectedImageAsset(selectedImageAsset?.id === asset.id ? null : asset);
    } else {
      handleAssetSelect(asset);
    }
  };

  const { stats: compositionStats, totalChildAssets } = useMemo(() => 
    getCompositionStats(bundleAssets), [bundleAssets]
  );

  if (selectedAssetId) {
    const selectedAsset = bundleAssets.find(a => a.id === selectedAssetId);
    return (
      <div className="h-full flex flex-col">
        <div className="flex-none p-2 sm:p-3 border-b bg-muted/30">
          <div className="flex items-center gap-2 min-w-0">
            <Button 
              variant="ghost" 
              size="sm"
              onClick={() => onAssetSelect(null)}
              className="h-7 sm:h-8 px-2 shrink-0"
            >
              <ArrowRight className="h-3 w-3 sm:h-4 sm:w-4 rotate-180 mr-1" />
              <span className="text-xs sm:text-sm">Back</span>
            </Button>
            <Separator orientation="vertical" className="h-4" />
            <span className="text-xs sm:text-sm text-muted-foreground truncate flex-1 min-w-0">
              {selectedBundle?.name} / {selectedAsset?.title}
            </span>
            <Badge variant="secondary" className="text-xs bg-muted border-muted-foreground/30 shrink-0">
              Asset
            </Badge>
          </div>
        </div>
        <div className="flex-1 min-h-0">
          <AssetDetailView
            selectedAssetId={selectedAssetId}
            highlightAssetIdOnOpen={highlightAssetId}
            onEdit={(asset: AssetRead) => console.log('Edit asset:', asset)}
            schemas={[]}
            onLoadIntoRunner={onLoadIntoRunner}
          />
        </div>
      </div>
    );
  }

  if (!selectedBundleId || !selectedBundle) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <div className="text-center">
          <Layers className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium text-muted-foreground mb-2">No Bundle Selected</h3>
          <p className="text-sm text-muted-foreground">Select a bundle to view its contents.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Bundle Header with Composition */}
      <div className="flex-none p-2 sm:p-4 border-b bg-muted/30">
        <div className="flex items-start justify-between gap-2 sm:gap-4 mb-2 sm:mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <Layers className="h-4 w-4 sm:h-5 sm:w-5 text-primary shrink-0" />
              <h2 className="text-sm sm:text-lg font-semibold truncate">
                {selectedBundle.name || `Bundle ${selectedBundle.id}`}
              </h2>
              <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/30 shrink-0">
                Bundle
              </Badge>
            </div>
            {/* Bundle Metadata */}
            <div className="flex items-center gap-2 sm:gap-4 mt-2 sm:mt-3 text-xs text-muted-foreground flex-wrap">
          <div className="flex items-center gap-1">
            <Hash className="h-3 w-3" />
            <span>ID: {selectedBundle.id}</span>
          </div>
          <div className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            <span>Updated {formatDistanceToNow(new Date(selectedBundle.updated_at), { addSuffix: true })}</span>
          </div>
          <div className="flex items-center gap-1">
            <File className="h-3 w-3" />
            <span>{selectedBundle.asset_count || 0} assets</span>
          </div>
          
          {/* Compact Bundle Composition in Header */}
          {Array.from(compositionStats.entries()).length > 0 && (
            <>
              <Separator orientation="vertical" className="h-3" />
              <div className="flex items-center gap-2">
                {Array.from(compositionStats.entries()).map(([kind, data]) => (
                  <TooltipProvider key={kind} delayDuration={100}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center gap-1">
                          {getAssetIcon(kind, "h-3 w-3")}
                          <span className="text-xs font-medium">{data.count}</span>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{data.count} {kind.replace('_', ' ')} file{data.count > 1 ? 's' : ''}</p>
                        {data.totalChildren > 0 && (
                          <p>+{data.totalChildren} sub-items</p>
                        )}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ))}
                {totalChildAssets > 0 && (
                  <TooltipProvider delayDuration={100}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge variant="secondary" className="text-xs px-1 py-0">
                          +{totalChildAssets}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{totalChildAssets} total sub-items (CSV rows, PDF pages, etc.)</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
            </>
          )}
            </div>
            {selectedBundle.description && (
              <p className="text-sm text-muted-foreground mt-1">
                "{selectedBundle.description}"
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 w-8 sm:w-auto sm:px-3 p-0">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Bundle Actions</DropdownMenuLabel>
                <DropdownMenuItem><Share2 className="mr-2 h-4 w-4" />Share Bundle</DropdownMenuItem>
                <DropdownMenuItem><Download className="mr-2 h-4 w-4" />Export Bundle</DropdownMenuItem>
                {onLoadIntoRunner && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => onLoadIntoRunner(1, 'Default Runner')}>
                      <PlayCircle className="mr-2 h-4 w-4" />Load into Runner
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            
            <Button 
              variant="default" 
              size="sm"
              onClick={() => {
                // TODO: Open upload dialog for this bundle
                toast.info("Upload to bundle functionality coming soon");
              }}
              className="bg-primary hover:bg-primary/90 h-8 px-2 sm:px-3"
            >
              <Upload className="mr-0 sm:mr-2 h-4 w-4" />
              <span className="hidden sm:inline">Add Files</span>
            </Button>
          </div>
        </div>

        
      </div>

      {/* Bundle Content */}
      <div className="flex-1 min-h-0 overflow-auto">
        {isLoadingAssets ? (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mr-2" />
            <span className="text-muted-foreground">Loading bundle contents...</span>
          </div>
        ) : bundleError ? (
          <div className="h-full flex items-center justify-center text-red-500 p-4">
            <AlertCircle className="h-5 w-5 mr-2" />
            <span>Error: {bundleError}</span>
          </div>
        ) : bundleAssets.length === 0 ? (
          <div className="h-full flex items-center justify-center p-6">
            <div className="text-center">
              <File className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium text-muted-foreground mb-2">Empty Bundle</h3>
              <p className="text-sm text-muted-foreground">
                This bundle doesn't contain any assets yet.
              </p>
            </div>
          </div>
        ) : (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
            <div className="flex-none border-b">
              {/* Mobile: Scrollable horizontal tabs, Desktop: Grid */}
              <div className="overflow-x-auto scrollbar-hide">
                <TabsList className="inline-flex md:grid md:w-full md:grid-cols-6 h-10 sm:h-12 bg-transparent p-1 rounded-none min-w-full md:min-w-0">
                  <TabsTrigger value="all" className="flex items-center gap-1 sm:gap-2 whitespace-nowrap px-2 sm:px-3">
                    <Layers className="h-3 w-3 sm:h-4 sm:w-4 shrink-0" />
                    <span className="text-xs sm:text-sm">All ({filteredAssets.all.length})</span>
                  </TabsTrigger>
                  <TabsTrigger value="images" className="flex items-center gap-1 sm:gap-2 whitespace-nowrap px-2 sm:px-3" disabled={filteredAssets.images.length === 0}>
                    <ImageIcon className="h-3 w-3 sm:h-4 sm:w-4 shrink-0" />
                    <span className="text-xs sm:text-sm">Images ({filteredAssets.images.length})</span>
                  </TabsTrigger>
                  <TabsTrigger value="documents" className="flex items-center gap-1 sm:gap-2 whitespace-nowrap px-2 sm:px-3" disabled={filteredAssets.documents.length === 0}>
                    <FileText className="h-3 w-3 sm:h-4 sm:w-4 shrink-0" />
                    <span className="text-xs sm:text-sm">Docs ({filteredAssets.documents.length})</span>
                  </TabsTrigger>
                  <TabsTrigger value="web" className="flex items-center gap-1 sm:gap-2 whitespace-nowrap px-2 sm:px-3" disabled={filteredAssets.web.length === 0}>
                    <Globe className="h-3 w-3 sm:h-4 sm:w-4 shrink-0" />
                    <span className="text-xs sm:text-sm">Web ({filteredAssets.web.length})</span>
                  </TabsTrigger>
                  <TabsTrigger value="media" className="flex items-center gap-1 sm:gap-2 whitespace-nowrap px-2 sm:px-3" disabled={filteredAssets.media.length === 0}>
                    <Video className="h-3 w-3 sm:h-4 sm:w-4 shrink-0" />
                    <span className="text-xs sm:text-sm">Media ({filteredAssets.media.length})</span>
                  </TabsTrigger>
                  <TabsTrigger value="text" className="flex items-center gap-1 sm:gap-2 whitespace-nowrap px-2 sm:px-3" disabled={filteredAssets.text.length === 0}>
                    <Type className="h-3 w-3 sm:h-4 sm:w-4 shrink-0" />
                    <span className="text-xs sm:text-sm">Text ({filteredAssets.text.length})</span>
                  </TabsTrigger>
                </TabsList>
              </div>
            </div>

            {/* All Assets Tab */}
            <TabsContent value="all" className="flex-1 min-h-0 overflow-auto p-2 sm:p-4 m-0">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center justify-between">
                    All Assets in Bundle
                    <Badge variant="outline" className="text-xs">
                      {filteredAssets.all.length} total assets
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 space-y-1">
                  {filteredAssets.all.map((asset, index) => (
                    <div
                      key={asset.id}
                      draggable={!!onAssetDragStart}
                      onDragStart={(e) => {
                        e.stopPropagation();
                        if (onAssetDragStart) {
                          onAssetDragStart(asset, e);
                        }
                      }}
                      onDragEnd={(e) => {
                        e.stopPropagation();
                        if (onAssetDragEnd) {
                          onAssetDragEnd();
                        }
                      }}
                      className={cn(
                        "group relative flex items-center gap-3 p-3 rounded-lg transition-all cursor-pointer",
                        "hover:bg-muted/50 hover:border-primary/30 hover:shadow-sm",
                        "focus-within:ring-2 focus-within:ring-primary/20"
                      )}
                      onClick={() => handleAssetSelect(asset)}
                    >
                      {/* Index number */}
                      <div className="absolute top-2 left-2 w-5 h-5 rounded-full bg-muted/80 flex items-center justify-center text-xs text-muted-foreground">
                        {index + 1}
                      </div>
                      
                      {/* Asset Preview */}
                      <div className="">
                        <AssetPreview asset={asset} className="w-48 h-16 rounded" />
                      </div>
                      
                      {/* Asset Info */}
                      <div className="flex-1 min-w-0 pr-8">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <h4 className="font-medium text-sm truncate group-hover:text-primary transition-colors">
                              {(asset.title || `Asset ${asset.id}`)
                                .replace(/\s*\(IMAGE\)\s*$/i, '')
                                .replace(/\s*\(PDF\)\s*$/i, '')
                                .replace(/\s*\(CSV\)\s*$/i, '')
                                .trim()}
                            </h4>
                            <div className="flex-shrink-0">
                              {getAssetIcon(asset.kind, "h-5 w-5")}
                            </div>
                            <Badge variant="outline" className="text-xs font-normal">
                              {asset.kind}
                            </Badge>
                            <Badge variant="secondary" className="text-xs bg-muted border-muted-foreground/30">
                              Asset
                            </Badge>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          {asset.source_metadata?.filename && typeof asset.source_metadata.filename === 'string' ? (
                            <span className="truncate">
                              📁 {asset.source_metadata.filename}
                            </span>
                          ) : null}
                          
                          <span className="shrink-0">
                            🕒 {formatDistanceToNow(new Date(asset.updated_at), { addSuffix: true })}
                          </span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAssetViewAction(asset, 'view');
                          }}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={(e) => {
                              e.stopPropagation();
                              handleAssetViewAction(asset, 'view');
                            }}>
                              <Eye className="mr-2 h-4 w-4" />
                              View Details
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={(e) => {
                              e.stopPropagation();
                              handleAssetViewAction(asset, 'download');
                            }}>
                              <Download className="mr-2 h-4 w-4" />
                              Download
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={(e) => {
                              e.stopPropagation();
                              handleAssetViewAction(asset, 'share');
                            }}>
                              <Share2 className="mr-2 h-4 w-4" />
                              Share
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Images Gallery Tab */}
            <TabsContent value="images" className="flex-1 min-h-0 overflow-auto p-2 sm:p-4 m-0">
              {selectedImageAsset ? (
                // Selected Image View with Preview and Details
                <div className="h-full flex flex-col lg:flex-row gap-4">
                  {/* Large Image Preview */}
                  <div className="flex-1 flex flex-col">
                    <Card className="flex-1">
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setSelectedImageAsset(null)}
                              className="h-8 px-2"
                            >
                              <ArrowRight className="h-4 w-4 rotate-180 mr-1" />
                              Back to Gallery
                            </Button>
                            <Separator orientation="vertical" className="h-4" />
                            <ImageIcon className="h-4 w-4 text-purple-600" />
                            <span className="font-medium">
                              {(selectedImageAsset.title || `Image ${selectedImageAsset.id}`)
                                .replace(/\s*\(IMAGE\)\s*$/i, '')
                                .trim()}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleAssetViewAction(selectedImageAsset, 'view')}
                            >
                              <Eye className="h-4 w-4 mr-2" />
                              Full Details
                            </Button>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="pt-0 flex-1 flex items-center justify-center bg-muted/20 rounded">
                        <div className="max-w-full max-h-full overflow-auto">
                          <AuthenticatedImage 
                            asset={selectedImageAsset} 
                            className="max-w-full max-h-[70vh] object-contain rounded shadow-lg"
                          />
                        </div>
                      </CardContent>
                    </Card>
                    
                    {/* Image Metadata */}
                    <Card className="mt-4">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Image Information</CardTitle>
                      </CardHeader>
                      <CardContent className="pt-0">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                          <div>
                            <strong>ID:</strong> {selectedImageAsset.id}
                          </div>
                          <div>
                            <strong>UUID:</strong> 
                            <code className="ml-1 text-xs">{selectedImageAsset.uuid}</code>
                          </div>
                          {selectedImageAsset.source_identifier && (
                            <div className="md:col-span-2">
                              <strong>Source URL:</strong>
                              <a 
                                href={selectedImageAsset.source_identifier} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="ml-1 text-primary hover:underline text-xs break-all"
                              >
                                {selectedImageAsset.source_identifier}
                              </a>
                            </div>
                          )}
                          {selectedImageAsset.source_metadata && Object.keys(selectedImageAsset.source_metadata).length > 0 && (
                            <div className="md:col-span-2">
                              <strong>Metadata:</strong>
                              <pre className="text-xs bg-muted/50 p-2 rounded mt-1 overflow-auto max-h-32">
                                {JSON.stringify(selectedImageAsset.source_metadata, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Thumbnail Gallery Sidebar */}
                  <div className="w-full lg:w-80">
                    <Card className="h-full">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm flex items-center justify-between">
                          <span>All Images</span>
                          <Badge variant="outline" className="text-xs">
                            {filteredAssets.images.length} images
                          </Badge>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="pt-0">
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-96 lg:max-h-full overflow-auto">
                          {filteredAssets.images.map((asset, index) => (
                            <div
                              key={asset.id}
                              className={cn(
                                "group relative cursor-pointer rounded-lg overflow-hidden transition-all",
                                selectedImageAsset.id === asset.id 
                                  ? "border-primary ring-2 ring-primary/20" 
                                  : "border-muted hover:border-primary/50"
                              )}
                              onClick={() => setSelectedImageAsset(asset)}
                            >
                              <div className="aspect-square bg-muted/20">
                                <AuthenticatedImage 
                                  asset={asset} 
                                  className="w-full h-full object-cover"
                                />
                              </div>
                              <div className="absolute top-1 left-1 opacity-70 group-hover:opacity-100 transition-opacity">
                                <Badge variant="secondary" className="text-xs bg-black/50 text-white border-none">
                                  {index + 1}
                                </Badge>
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              ) : (
                // Gallery Grid View
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <ImageIcon className="h-4 w-4 text-purple-600" />
                        Images Gallery
                      </div>
                      <Badge variant="outline" className="text-xs">
                        {filteredAssets.images.length} images
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    {filteredAssets.images.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <ImageIcon className="h-12 w-12 mx-auto mb-4 opacity-50" />
                        <p>No images in this bundle</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                        {filteredAssets.images.map((asset, index) => (
                          <div
                            key={asset.id}
                            className="group relative cursor-pointer"
                            onClick={() => handleImageSelect(asset)}
                          >
                            <div className="aspect-square rounded-lg overflow-hidden bg-muted/20 hover:border-primary/50 transition-all">
                              <AuthenticatedImage 
                                asset={asset} 
                                className="w-full h-full hover:scale-105 transition-transform duration-200"
                              />
                            </div>
                            
                            {/* Overlay with info */}
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors rounded-lg">
                              <div className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Badge variant="secondary" className="text-xs bg-black/50 text-white border-none">
                                  {index + 1}
                                </Badge>
                              </div>
                              <div className="absolute bottom-2 left-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <p className="text-white text-xs bg-black/50 rounded px-2 py-1 truncate">
                                  {(asset.title || `Image ${asset.id}`)
                                    .replace(/\s*\(IMAGE\)\s*$/i, '')
                                    .trim()}
                                </p>
                              </div>
                              <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  className="h-8 w-8 p-0 bg-black/50 hover:bg-black/70 border-none"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleAssetViewAction(asset, 'view');
                                  }}
                                >
                                  <Eye className="h-4 w-4 text-white" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* Documents Tab */}
            <TabsContent value="documents" className="flex-1 min-h-0 overflow-auto p-2 sm:p-4 m-0">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-red-600" />
                      Documents
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {filteredAssets.documents.length} documents
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 space-y-2">
                  {filteredAssets.documents.map((asset, index) => (
                    <div
                      key={asset.id}
                      className="flex items-center gap-3 p-3 rounded-lg cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => handleAssetSelect(asset)}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-6">{index + 1}</span>
                        {getAssetIcon(asset.kind, "h-5 w-5")}
                      </div>
                      <AssetPreview asset={asset} className="w-32 h-12 rounded border" />
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-sm truncate">
                          {(asset.title || `Document ${asset.id}`)
                            .replace(/\s*\(PDF\)\s*$/i, '')
                            .replace(/\s*\(CSV\)\s*$/i, '')
                            .trim()}
                        </h4>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant="outline" className="text-xs capitalize">{asset.kind}</Badge>
                          {asset.source_metadata?.filename && typeof asset.source_metadata.filename === 'string' ? (
                            <span className="truncate">{String(asset.source_metadata.filename)}</span>
                          ) : null}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAssetViewAction(asset, 'view');
                        }}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Web Assets Tab */}
            <TabsContent value="web" className="flex-1 min-h-0 overflow-auto p-2 sm:p-4 m-0">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Globe className="h-4 w-4 text-sky-600" />
                      Article
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {filteredAssets.web.length} articles
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 space-y-2">
                  {filteredAssets.web.map((asset, index) => (
                    <div
                      key={asset.id}
                      className="flex items-center gap-3 p-3 rounded-lg cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => handleAssetSelect(asset)}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-6">{index + 1}</span>
                        <Globe className="h-5 w-5 text-sky-600" />
                      </div>
                      <AssetPreview asset={asset} className="w-32 h-12 rounded border" />
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-sm truncate">
                          {asset.title || `Article ${asset.id}`}
                        </h4>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          {asset.source_identifier && (
                            <span className="truncate">{new URL(asset.source_identifier).hostname}</span>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAssetViewAction(asset, 'view');
                        }}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Media Tab */}
            <TabsContent value="media" className="flex-1 min-h-0 overflow-auto p-2 sm:p-4 m-0">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Video className="h-4 w-4 text-orange-600" />
                      Media Files
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {filteredAssets.media.length} files
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 space-y-2">
                  {filteredAssets.media.map((asset, index) => (
                    <div
                      key={asset.id}
                      className="flex items-center gap-3 p-3 rounded-lg cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => handleAssetSelect(asset)}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-6">{index + 1}</span>
                        {getAssetIcon(asset.kind, "h-5 w-5")}
                      </div>
                      <div className="w-32 h-12 bg-muted/50 rounded flex items-center justify-center">
                        {getAssetIcon(asset.kind, "h-6 w-6")}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-sm truncate">
                          {asset.title || `${asset.kind} ${asset.id}`}
                        </h4>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant="outline" className="text-xs capitalize">{asset.kind}</Badge>
                          {asset.source_metadata?.filename && typeof asset.source_metadata.filename === 'string' ? (
                            <span className="truncate">{String(asset.source_metadata.filename)}</span>
                          ) : null}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAssetViewAction(asset, 'view');
                        }}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Text Tab */}
            <TabsContent value="text" className="flex-1 min-h-0 overflow-auto p-2 sm:p-4 m-0">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Type className="h-4 w-4 text-indigo-600" />
                      Text Content
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {filteredAssets.text.length} text blocks
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 space-y-2">
                  {filteredAssets.text.map((asset, index) => (
                    <div
                      key={asset.id}
                      className="flex items-center gap-3 p-3 rounded-lg cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => handleAssetSelect(asset)}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-6">{index + 1}</span>
                        <Type className="h-5 w-5 text-indigo-600" />
                      </div>
                      <div className="w-32 h-12 bg-muted/50 rounded flex items-center justify-center">
                        <Type className="h-6 w-6 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-sm truncate">
                          {asset.title || `Text Block ${asset.id}`}
                        </h4>
                        <div className="text-xs text-muted-foreground">
                          {asset.text_content && (
                            <span className="truncate">
                              {asset.text_content.substring(0, 80)}
                              {asset.text_content.length > 80 ? '...' : ''}
                            </span>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAssetViewAction(asset, 'view');
                        }}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
} 