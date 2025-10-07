/**
 * Asset Tree Viewer
 * 
 * Reusable tree viewer for assets and bundles with full detail views
 */

import React, { useState, useMemo, useEffect } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import {
  ChevronRight,
  ChevronLeft,
  Folder,
  FolderOpen,
  Search,
  Eye,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { TreeItem } from '../shared/types';
import AssetDetailView from '../../../assets/Views/AssetDetailView';
import BundleDetailView from '../../../assets/Views/BundleDetailView';
import { TextSpanHighlightProvider } from '@/components/collection/contexts/TextSpanHighlightContext';
import { getAssetIcon, formatAssetKind, getAssetBadgeClass } from '../../../assets/AssetSelector';
import { formatDistanceToNow } from 'date-fns';
import { useBundleStore } from '@/zustand_stores/storeBundles';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';

interface AssetTreeViewerProps {
  tree: TreeItem[];
  compact?: boolean;
  onAssetClick?: (assetId: number) => void;
  onBundleClick?: (bundleId: number) => void;
  totalCount?: number;
  message?: string;
}

export function AssetTreeViewer({
  tree,
  compact = false,
  onAssetClick,
  onBundleClick,
  totalCount,
  message
}: AssetTreeViewerProps) {
  const { activeInfospace } = useInfospaceStore();
  const { fetchBundles } = useBundleStore();
  const [selectedItem, setSelectedItem] = useState<TreeItem | null>(null);
  const [selectedAssetInBundle, setSelectedAssetInBundle] = useState<number | null>(null);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [showMobileDetail, setShowMobileDetail] = useState(false);

  // Fetch bundles when component mounts so BundleDetailView can access them
  useEffect(() => {
    if (activeInfospace?.id) {
      fetchBundles(activeInfospace.id);
    }
  }, [activeInfospace?.id, fetchBundles]);
  
  // Filter tree based on search
  const filteredTree = useMemo(() => {
    if (!searchTerm.trim()) return tree;
    
    const search = searchTerm.toLowerCase();
    const filterItems = (items: TreeItem[]): TreeItem[] => {
      return items.reduce((acc: TreeItem[], item) => {
        const matchesName = item.name.toLowerCase().includes(search);
        const filteredChildren = item.children ? filterItems(item.children) : undefined;
        
        if (matchesName || (filteredChildren && filteredChildren.length > 0)) {
          acc.push({
            ...item,
            children: filteredChildren,
          });
        }
        return acc;
      }, []);
    };
    
    return filterItems(tree);
  }, [tree, searchTerm]);
  
  // Toggle item expansion
  const toggleExpanded = (itemId: string) => {
    setExpandedItems(prev => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) {
        newSet.delete(itemId);
      } else {
        newSet.add(itemId);
      }
      return newSet;
    });
  };
  
  // Handle item click
  const handleItemClick = (item: TreeItem) => {
    // Always update internal preview panel
    setSelectedItem(item);
    
    // On mobile, show detail view
    setShowMobileDetail(true);
    
    // Optionally trigger parent callbacks (for external integrations)
    // When callbacks are not provided, we use only the internal preview panel
    if (onBundleClick && item.type === 'folder' && item.bundle) {
      onBundleClick(item.bundle.id);
    } else if (onAssetClick && item.type === 'asset' && item.asset) {
      onAssetClick(item.asset.id);
    }
  };

  // Handle mobile back button
  const handleMobileBack = () => {
    setShowMobileDetail(false);
  };
  
  // Render tree item with rich styling like AssetSelector
  const renderTreeItem = (item: TreeItem): React.ReactNode => {
    const hasChildren = item.children && item.children.length > 0;
    const isExpanded = expandedItems.has(item.id);
    const isActive = selectedItem?.id === item.id;
    
    // Folder/Bundle rendering
    if (item.type === 'folder') {
      return (
        <div key={item.id}>
          <div
            className={cn(
              "group flex items-center justify-between gap-2 py-2 px-3 hover:bg-muted cursor-pointer transition-colors",
              "border-t border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50",
              isActive && "bg-blue-100 dark:bg-blue-900/80 border-l-4 border-blue-500 !border-y-blue-500/50"
            )}
            style={{ paddingLeft: `${item.level * 1.5 + 0.5}rem` }}
            onClick={(e) => { 
              e.stopPropagation(); 
              handleItemClick(item);
            }}
          >
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className="w-4 h-4 flex items-center justify-center">
                {hasChildren && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-4 w-4 p-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleExpanded(item.id);
                    }}
                  >
                    <ChevronRight
                      className={cn(
                        "h-3 w-3 transition-transform duration-200",
                        isExpanded && "rotate-90"
                      )}
                    />
                  </Button>
                )}
              </div>
              <div className="w-4 h-4 flex items-center justify-center">
                <div className="relative">
                  <Folder
                    className={cn(
                      "h-4 w-4 text-blue-600 transition-opacity duration-200",
                      isExpanded && "opacity-0"
                    )}
                  />
                  <FolderOpen
                    className={cn(
                      "h-4 w-4 text-blue-600 absolute inset-0 transition-opacity duration-200",
                      !isExpanded && "opacity-0"
                    )}
                  />
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold truncate">{item.name}</span>
                  {hasChildren && (
                    <Badge variant="secondary" className="text-xs">
                      {item.children?.length} items
                    </Badge>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {item.metadata?.description && (
                <span className="text-xs text-muted-foreground hidden md:block max-w-[200px] truncate">
                  {item.metadata.description}
                </span>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => {
                  e.stopPropagation();
                  handleItemClick(item);
                }}
                title="View Bundle Details"
              >
                <Eye className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div
            data-state={isExpanded ? "open" : "closed"}
            className="overflow-hidden transition-all duration-300 ease-out data-[state=closed]:animate-slide-up data-[state=open]:animate-slide-down data-[state=closed]:h-0 data-[state=open]:h-auto max-h-[600px] overflow-y-auto"
          >
            {item.children && (
              <div className="ml-4 border-l-2 border-slate-200 dark:border-slate-700 pl-0 space-y-0.5 pb-2 pt-1">
                <div className="space-y-0.5">
                  {item.children.map(child => renderTreeItem(child))}
                </div>
              </div>
            )}
          </div>
        </div>
      );
    }
    
    // Asset rendering
    const assetKind = (item.asset?.kind || 'text') as any;
    const badgeClass = getAssetBadgeClass(assetKind);
    
    return (
      <div key={item.id}>
        <div
          className={cn(
            "group flex items-center gap-2.5 py-1.5 px-3 hover:bg-muted/50 cursor-pointer transition-colors rounded-md",
            isActive && "bg-blue-50 dark:bg-blue-900/50 border-l-4 rounded-none border-blue-500"
          )}
          style={{ paddingLeft: `${item.level * 1.5 + 0.5}rem` }}
          onClick={() => handleItemClick(item)}
        >
          <div className="w-4 h-4" />
          <div className="w-4 h-4 flex items-center justify-center">
            {getAssetIcon(assetKind)}
          </div>
          <div className="flex-1 min-w-0 overflow-hidden">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium truncate">{item.name}</span>
            </div>
          </div>
          <div className="flex items-center gap-4 ml-auto pl-4">
            <Badge
              variant="outline"
              className={cn("text-xs hidden md:block", badgeClass)}
            >
              {formatAssetKind(assetKind)}
            </Badge>
            {item.asset?.updated_at && (
              <div className="text-xs text-muted-foreground truncate hidden group-hover:block lg:block min-w-[100px] text-right">
                {formatDistanceToNow(new Date(item.asset.updated_at), { addSuffix: true })}
              </div>
            )}
            <div className="hidden md:flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={(e) => {
                  e.stopPropagation();
                  handleItemClick(item);
                }}
                title="View Details"
              >
                <Eye className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
        {hasChildren && (
          <div
            data-state={isExpanded ? "open" : "closed"}
            className="overflow-hidden transition-all duration-300 ease-out data-[state=closed]:animate-slide-up data-[state=open]:animate-slide-down data-[state=closed]:h-0 data-[state=open]:h-auto max-h-72 overflow-y-auto"
          >
            {item.children && (
              <div className="ml-4 border-l-2 border-slate-200 dark:border-slate-700 pl-2 space-y-1 pb-2 pt-1">
                <div className="space-y-1">
                  {item.children.map(child => renderTreeItem(child))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };
  
  // Compact mode - just show count
  if (compact) {
    return (
      <div className="space-y-2 text-sm">
        <p className="font-medium">{message || `${totalCount || tree.length} items`}</p>
        <p className="text-xs text-muted-foreground">
          Click to expand and browse results
        </p>
      </div>
    );
  }
  
  // Render detail view content
  const renderDetailView = () => {
    if (selectedItem?.type === 'asset' && selectedItem.asset) {
      return (
        <AssetDetailView
          selectedAssetId={selectedItem.asset.id}
          highlightAssetIdOnOpen={null}
          onEdit={() => {}} // Read-only in tool results
          schemas={[]}
        />
      );
    }
    
    if (selectedItem?.type === 'folder' && selectedItem.bundle) {
      return (
        <BundleDetailView
          selectedBundleId={selectedItem.bundle.id}
          onLoadIntoRunner={undefined}
          selectedAssetId={selectedAssetInBundle}
          onAssetSelect={setSelectedAssetInBundle}
          highlightAssetId={null}
        />
      );
    }
    
    return (
      <div className="h-full flex items-center justify-center p-4 sm:p-6">
        <div className="text-center">
          <Eye className="h-10 w-10 sm:h-12 sm:w-12 mx-auto text-muted-foreground mb-3 sm:mb-4 opacity-50" />
          <h3 className="text-base sm:text-lg font-medium text-muted-foreground">
            Select an item to view details
          </h3>
          <p className="text-xs sm:text-sm text-muted-foreground mt-2">
            Browse the {totalCount || tree.length} result{(totalCount || tree.length) !== 1 ? 's' : ''} on the left
          </p>
        </div>
      </div>
    );
  };

  // Render tree list content
  const renderTreeList = () => (
    <div className="h-full flex flex-col">
      {/* Search bar */}
      <div className="flex-none p-2 sm:p-3 border-b">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search results..."
            className="pl-8 h-8 sm:h-9 text-sm"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>
      
      {/* Tree view */}
      <ScrollArea className="flex-1">
        <div className="p-1 sm:p-2 space-y-0.5 sm:space-y-1">
          {filteredTree.length === 0 ? (
            <div className="text-center py-6 sm:py-8 text-muted-foreground text-xs sm:text-sm">
              No results found
            </div>
          ) : (
            filteredTree.map(item => renderTreeItem(item))
          )}
        </div>
      </ScrollArea>
    </div>
  );

  // Full mode - responsive layout
  return (
    <TextSpanHighlightProvider>
      <div className="border rounded-lg overflow-hidden bg-background">
        {/* Header */}
        {message && (
          <div className="flex items-center justify-between p-2 sm:p-3 border-b bg-muted/30">
            <span className="text-xs sm:text-sm font-medium truncate">{message}</span>
            {totalCount !== undefined && (
              <Badge variant="secondary" className="text-xs ml-2 shrink-0">
                {totalCount}
              </Badge>
            )}
          </div>
        )}
        
        {/* Content - Mobile: single view with toggle, Desktop: split pane */}
        <div className="h-[70vh] sm:h-[600px] max-h-[800px] max-w-[calc(100vw-4rem)]">
          {/* Mobile View - show tree OR detail */}
          <div className="md:hidden h-full">
            {showMobileDetail && selectedItem ? (
              <div className="h-full flex flex-col">
                {/* Mobile back button */}
                <div className="flex-none flex items-center gap-2 p-2 border-b bg-muted/30">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleMobileBack}
                    className="h-8 px-2"
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    Back
                  </Button>
                  <span className="text-xs font-medium truncate flex-1">
                    {selectedItem.name}
                  </span>
                </div>
                {/* Detail view */}
                <div className="flex-1 min-h-0 overflow-auto">
                  {renderDetailView()}
                </div>
              </div>
            ) : (
              renderTreeList()
            )}
          </div>

          {/* Desktop View - split pane */}
          <div className="hidden md:block h-full">
            <ResizablePanelGroup direction="horizontal" className="h-full w-full">
              <ResizablePanel defaultSize={40} minSize={30} maxSize={70}>
                {renderTreeList()}
              </ResizablePanel>
              
              <ResizableHandle withHandle className="bg-border" />
              
              <ResizablePanel defaultSize={60} minSize={30} maxSize={70}>
                <div className="h-full border-l">
                  {renderDetailView()}
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
        </div>
      </div>
    </TextSpanHighlightProvider>
  );
}

