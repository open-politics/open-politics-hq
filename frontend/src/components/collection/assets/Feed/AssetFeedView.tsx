'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Loader2, 
  RefreshCw, 
  ChevronDown,
  Newspaper,
  SlidersHorizontal,
  X,
  Asterisk,
  LayoutGrid,
  LayoutList,
  LayoutPanelTop,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { AssetCard, CardGrid, CardGridSkeleton } from '../Cards';
import { useFeedAssets } from './useFeedAssets';
import { 
  DISPLAYABLE_ASSET_KINDS, 
  getAssetKindConfig,
  type AssetKindConfig,
} from '../assetKindConfig';
import type { AssetFeedViewProps, AssetFeedItem } from './types';
import type { AssetKind, AssetRead } from '@/client';

/**
 * AssetFeedView - A flexible feed of asset cards
 * 
 * Three ways to provide data:
 * 1. `items` prop - Pre-fetched data, no internal fetching
 * 2. `fetchFn` prop - Custom fetch function
 * 3. `infospaceId` prop - Uses useFeedAssets hook
 * 
 * Usage:
 * ```tsx
 * // With infospace ID (auto-fetches)
 * <AssetFeedView 
 *   infospaceId={123}
 *   filterKinds={['article', 'web']}
 *   onAssetClick={handleClick}
 * />
 * 
 * // With pre-fetched data
 * <AssetFeedView 
 *   items={myItems}
 *   onAssetClick={handleClick}
 * />
 * 
 * // With custom fetch
 * <AssetFeedView 
 *   fetchFn={async () => myApi.getLatest()}
 *   onAssetClick={handleClick}
 * />
 * ```
 */

const DEFAULT_LIMIT = 12;

export function AssetFeedView({
  // Data sources
  items: externalItems,
  fetchFn,
  infospaceId,
  
  // Behavior
  onAssetClick,
  initialLimit = DEFAULT_LIMIT,
  enableInfiniteScroll = true,
  
  // Filtering (initial filter, can be overridden by user)
  filterKinds: initialFilterKinds,
  
  // Pre-known types from parent (e.g., tree data)
  availableKinds: preKnownKinds,
  
  // Display
  title,
  showControls = true,
  cardSize = 'md',
  columns = 'auto',
  layout = 'grid',
  className,
  emptyMessage = 'No items to display',
}: AssetFeedViewProps) {
  // Track data source mode
  const usingExternalData = externalItems !== undefined;
  const usingCustomFetch = fetchFn !== undefined;
  const usingInternalFetch = infospaceId !== undefined;
  
  // Local state for custom fetch mode
  const [customFetchItems, setCustomFetchItems] = useState<AssetFeedItem[]>([]);
  const [customFetchLoading, setCustomFetchLoading] = useState(false);
  const [customFetchError, setCustomFetchError] = useState<string | null>(null);
  
  // Sort state for UI - default to "type, then date" (standard file manager behavior)
  const [sortOption, setSortOption] = useState<'kind-updated_at' | 'kind-created_at' | 'created_at' | 'updated_at'>('kind-updated_at');
  
  // Layout state - allow user to switch between layouts
  const [activeLayout, setActiveLayout] = useState<'grid' | 'bento' | 'list'>(layout);
  
  // Local filter state - allows user to filter by type via badges
  const [activeTypeFilters, setActiveTypeFilters] = useState<Set<AssetKind>>(
    new Set(initialFilterKinds || [])
  );
  
  // Use tree store data - no separate API calls needed!
  // The hook uses already-loaded tree data for efficient rendering
  const hookResult = useFeedAssets({
    infospaceId: usingInternalFetch ? infospaceId! : 0,
    limit: initialLimit,
    kinds: undefined, // Don't filter in hook, we filter locally via badges
    sortBy: sortOption,
    sortOrder: 'desc',
  });
  
  // Determine which raw data to use
  let rawItems: AssetFeedItem[];
  let isLoading: boolean;
  let error: string | null;
  let hasMore: boolean;
  let loadMore: () => void;
  let refresh: () => void;
  
  if (usingExternalData) {
    rawItems = externalItems;
    isLoading = false;
    error = null;
    hasMore = false;
    loadMore = () => {};
    refresh = () => {};
  } else if (usingCustomFetch) {
    rawItems = customFetchItems;
    isLoading = customFetchLoading;
    error = customFetchError;
    hasMore = false;
    loadMore = () => {};
    refresh = async () => {
      setCustomFetchLoading(true);
      setCustomFetchError(null);
      try {
        const result = await fetchFn();
        setCustomFetchItems(result);
      } catch (err: any) {
        setCustomFetchError(err.message || 'Failed to load');
      } finally {
        setCustomFetchLoading(false);
      }
    };
  } else {
    rawItems = hookResult.items;
    isLoading = hookResult.isLoading;
    error = hookResult.error;
    hasMore = hookResult.hasMore;
    loadMore = hookResult.loadMore;
    refresh = hookResult.refresh;
  }
  
  // Determine which types to show badges for:
  // 1. If preKnownKinds provided (from tree data), use those
  // 2. Otherwise, derive from loaded items
  const availableTypes = useMemo(() => {
    // If parent provides known kinds (e.g., from tree), show those upfront
    if (preKnownKinds && preKnownKinds.length > 0) {
      return preKnownKinds.filter(k => DISPLAYABLE_ASSET_KINDS.includes(k));
    }
    // Fallback: derive unique kinds from loaded items
    const kinds = new Set<AssetKind>();
    rawItems.forEach(item => {
      if (DISPLAYABLE_ASSET_KINDS.includes(item.asset.kind)) {
        kinds.add(item.asset.kind);
      }
    });
    return Array.from(kinds);
  }, [preKnownKinds, rawItems]);
  
  // Apply local type filter
  const items = useMemo(() => {
    if (activeTypeFilters.size === 0) {
      return rawItems; // No filter = show all
    }
    return rawItems.filter(item => activeTypeFilters.has(item.asset.kind));
  }, [rawItems, activeTypeFilters]);
  
  // Toggle type filter
  const toggleTypeFilter = useCallback((kind: AssetKind) => {
    setActiveTypeFilters(prev => {
      const next = new Set(prev);
      if (next.has(kind)) {
        next.delete(kind);
      } else {
        next.add(kind);
      }
      return next;
    });
  }, []);
  
  // Clear all filters
  const clearFilters = useCallback(() => {
    setActiveTypeFilters(new Set());
  }, []);
  
  // Infinite scroll observer
  const loadMoreRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    if (!enableInfiniteScroll || !hasMore || isLoading) return;
    
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMore();
        }
      },
      { threshold: 0.1 }
    );
    
    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }
    
    return () => observer.disconnect();
  }, [enableInfiniteScroll, hasMore, isLoading, loadMore]);
  
  // Initial fetch for custom fetch mode
  useEffect(() => {
    if (usingCustomFetch && customFetchItems.length === 0 && !customFetchLoading) {
      refresh();
    }
  }, [usingCustomFetch, customFetchItems.length, customFetchLoading, refresh]);
  
  // Handle card click
  const handleCardClick = useCallback((asset: AssetRead) => {
    onAssetClick?.(asset);
  }, [onAssetClick]);

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      {(title || showControls) && (
        <div className="flex-none ">
          <div className="flex items-center justify-between px-4 py-2">
            {title && (
              <div className="flex mr-auto items-center gap-1">
                <Asterisk className="h-6 w-6 ml-2" />
                <h1 className="text-md font-bold not-italic">{title}</h1>
              </div>
            )}
            
            {showControls && (
              <div className="flex items-center gap-2">
                {/* Layout switcher */}
                <div className="flex items-center border rounded-md">
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      'h-8 w-8 p-0 rounded-none rounded-l-md',
                      activeLayout === 'grid' && 'bg-muted'
                    )}
                    onClick={() => setActiveLayout('grid')}
                    title="Grid view"
                  >
                    <LayoutGrid className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      'h-8 w-8 p-0 rounded-none border-x',
                      activeLayout === 'bento' && 'bg-muted'
                    )}
                    onClick={() => setActiveLayout('bento')}
                    title="Bento view"
                  >
                    <LayoutPanelTop className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      'h-8 w-8 p-0 rounded-none rounded-r-md',
                      activeLayout === 'list' && 'bg-muted'
                    )}
                    onClick={() => setActiveLayout('list')}
                    title="List view"
                  >
                    <LayoutList className="h-4 w-4" />
                  </Button>
                </div>
                
                {/* Sort dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 gap-1">
                      <SlidersHorizontal className="h-4 w-4" />
                      <span className="hidden sm:inline">Sort</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuRadioGroup 
                      value={sortOption} 
                      onValueChange={(v) => setSortOption(v as any)}
                    >
                      <DropdownMenuRadioItem value="kind-updated_at">
                        <span className="flex items-center gap-2">
                          <span className="text-muted-foreground">📁</span>
                          Type, then Date
                        </span>
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="created_at">
                        Recently Added
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="updated_at">
                        Recently Updated
                      </DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
                
                {/* Refresh button */}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={refresh}
                  disabled={isLoading}
                >
                  <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
                </Button>
              </div>
            )}
          </div>
          
          {/* Type filter badges - no counts, just type toggles */}
          {showControls && availableTypes.length > 0 && (
            <div className="px-4 pb-3 flex items-center gap-2 flex-wrap">
              {activeTypeFilters.size > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearFilters}
                  className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3 mr-1" />
                  Clear
                </Button>
              )}
              {availableTypes.map((kind) => {
                const config = getAssetKindConfig(kind);
                const Icon = config.icon;
                const isActive = activeTypeFilters.has(kind);
                const activeColor = `${config.bgColor} ${config.textColor}`;
                
                return (
                  <button
                    key={kind}
                    onClick={() => toggleTypeFilter(kind)}
                    className={cn(
                      'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all',
                      isActive 
                        ? cn(activeColor, 'ring-2 ring-offset-1 ring-offset-background')
                        : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    {config.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
      
      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-4">
          {/* Loading state (initial) */}
          {isLoading && items.length === 0 && (
            <CardGridSkeleton count={6} columns={columns} layout={activeLayout} />
          )}
          
          {/* Error state */}
          {error && items.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="text-destructive mb-4">
                <Newspaper className="h-12 w-12 mx-auto opacity-50" />
              </div>
              <h3 className="font-medium text-lg mb-2">Failed to load</h3>
              <p className="text-muted-foreground text-sm mb-4">{error}</p>
              <Button onClick={refresh} variant="outline" size="sm">
                <RefreshCw className="h-4 w-4 mr-2" />
                Try again
              </Button>
            </div>
          )}
          
          {/* Empty state */}
          {!isLoading && !error && items.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Newspaper className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="font-medium text-lg mb-2">{emptyMessage}</h3>
              <p className="text-muted-foreground text-sm">
                Add some articles or web content to see them here.
              </p>
            </div>
          )}
          
          {/* Cards grid */}
          {items.length > 0 && (
            <CardGrid columns={columns} layout={activeLayout}>
              {items.map((item) => (
                <motion.div
                  key={`feed-card-${item.asset.id}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  // Let grid's stretch alignment handle equal heights
                  className="flex flex-col"
                >
                  <AssetCard
                    asset={item.asset}
                    childAssets={item.childAssets}
                    score={item.score}
                    onClick={handleCardClick}
                    size={cardSize}
                    orientation={activeLayout === 'list' ? 'horizontal' : 'vertical'}
                    className="flex-1"
                  />
                </motion.div>
              ))}
            </CardGrid>
          )}
          
          {/* Load more indicator */}
          {hasMore && (
            <div 
              ref={loadMoreRef}
              className="flex justify-center py-8"
            >
              {isLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span>Loading more...</span>
                </div>
              ) : (
                <Button 
                  variant="outline" 
                  onClick={loadMore}
                  className="gap-2"
                >
                  <ChevronDown className="h-4 w-4" />
                  Load more
                </Button>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
