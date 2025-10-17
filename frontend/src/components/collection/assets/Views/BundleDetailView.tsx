'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { 
  Layers, 
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
  File,
  Eye,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import {
  AssetRead,
  AssetKind,
  BundleRead,
} from '@/client';
import { useTreeStore } from '@/zustand_stores/storeTree';
import AssetDetailView from './AssetDetailView';
import AssetSelector, { AssetTreeItem, getAssetIcon } from '@/components/collection/assets/AssetSelector';
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

// Asset composition stats helper
const getCompositionStats = (children: any[]) => {
  const stats = new Map<AssetKind, { count: number; totalChildren: number }>();
  let totalChildAssets = 0;

  const processNode = (node: any) => {
    if (node.type === 'asset' && node.kind) {
      const current = stats.get(node.kind) || { count: 0, totalChildren: 0 };
      current.count += 1;
      
      // Count potential child items (rows, pages, etc.)
      let childCount = 0;
      if (node.kind === 'csv' && node.source_metadata?.row_count) {
        childCount = node.source_metadata.row_count as number;
      } else if (node.kind === 'pdf' && node.source_metadata?.page_count) {
        childCount = node.source_metadata.page_count as number;
      }
      current.totalChildren += childCount;
      totalChildAssets += childCount;
      stats.set(node.kind, current);
    }
  };

  children.forEach(processNode);
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
    childrenCache,
    fetchChildren,
    getFullBundle,
    getFullAsset,
  } = useTreeStore();

  const [selectedBundle, setSelectedBundle] = useState<BundleRead | null>(null);
  const [treeSelectedItems, setTreeSelectedItems] = useState<Set<string>>(new Set());

  // Load bundle details when bundle ID changes
  useEffect(() => {
    if (selectedBundleId) {
      getFullBundle(selectedBundleId).then(bundle => {
        setSelectedBundle(bundle || null);
      });
    } else {
      setSelectedBundle(null);
    }
  }, [selectedBundleId, getFullBundle]);

  // Get bundle children from cache for composition stats
  const bundleChildren = useMemo(() => {
    if (!selectedBundleId) return [];
    const bundleNodeId = `bundle-${selectedBundleId}`;
    return childrenCache.get(bundleNodeId) || [];
  }, [selectedBundleId, childrenCache]);

  // Compute composition stats
  const { stats: compositionStats, totalChildAssets } = useMemo(() => 
    getCompositionStats(bundleChildren), [bundleChildren]
  );

  // Handle item view from tree
  const handleItemView = useCallback(async (item: AssetTreeItem) => {
    if (item.type === 'asset' && item.asset) {
      onAssetSelect(item.asset.id);
    } else if (item.type === 'folder' && item.bundle) {
      // Could navigate to nested bundle if needed
      toast.info(`Viewing nested bundle: ${item.bundle.name}`);
    }
  }, [onAssetSelect]);

  // Handle item actions (custom actions for items in bundle view)
  const renderItemActions = useCallback((item: AssetTreeItem) => {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem 
            onClick={(e) => {
              e.stopPropagation();
              handleItemView(item);
            }}
          >
            <Eye className="mr-2 h-4 w-4" />
            View Details
          </DropdownMenuItem>
          <DropdownMenuItem 
            onClick={(e) => {
              e.stopPropagation();
              toast.info('Download functionality coming soon');
            }}
          >
            <Download className="mr-2 h-4 w-4" />
            Download
          </DropdownMenuItem>
          <DropdownMenuItem 
            onClick={(e) => {
              e.stopPropagation();
              toast.info('Share functionality coming soon');
            }}
          >
            <Share2 className="mr-2 h-4 w-4" />
            Share
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }, [handleItemView]);

  // If viewing a specific asset, show asset detail view
  if (selectedAssetId) {
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
              <span className="text-xs sm:text-sm">Back to Bundle</span>
            </Button>
            <Separator orientation="vertical" className="h-4" />
            <span className="text-xs sm:text-sm text-muted-foreground truncate flex-1 min-w-0">
              {selectedBundle?.name}
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

  // If no bundle selected, show empty state
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

  // Main bundle view with tree
  return (
    <div className="h-full flex flex-col">
      {/* Bundle Header */}
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
                <span>{bundleChildren.length} items</span>
              </div>
              
              {/* Compact Bundle Composition */}
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
          
          {/* Actions */}
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

      {/* Bundle Contents - Tree View */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <AssetSelector
          selectedItems={treeSelectedItems}
          onSelectionChange={setTreeSelectedItems}
          onItemView={handleItemView}
          onItemDoubleClick={handleItemView}
          renderItemActions={renderItemActions}
          compact={false}
          filterByBundleId={selectedBundleId}
        />
      </div>
    </div>
  );
}
