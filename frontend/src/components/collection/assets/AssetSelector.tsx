'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { 
  Search, 
  Upload, 
  Eye,
  MoreHorizontal,
  ChevronDown,
  ChevronRight,
  Loader2,
  AlertCircle,
  Trash2,
  Share2,
  Download,
  X,
  FolderPlus,
  FolderOpen,
  Folder,
  Edit3,
  Check,
  Link as LinkIcon,
  EyeOff,
  View,
  ArrowDown01,
  RefreshCw,
  Layers,
  FolderInput,
  Lock,
  Unlock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { formatDistanceToNowStrict } from 'date-fns';
import { toast } from 'sonner';
import {
  AssetRead,
  AssetKind,
  BundleRead,
  BundlesService,
} from '@/client';
import type { AssetNode } from '@/client';
import { useAssetStore } from '@/zustand_stores/storeAssets';
import { useBundleStore } from '@/zustand_stores/storeBundles';
import { useTreeStore } from '@/zustand_stores/storeTree';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { useDebounce } from '@/hooks/useDebounce';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useAssetQuery } from '@/hooks/useAssetQuery';
import type { ChildResultGroup } from '@/hooks/useAssetQuery';
import { useIngestionJobs } from '@/hooks/useIngestionJobs';
import { 
  getAssetIcon, 
  formatAssetKind, 
  getAssetBadgeClass 
} from './assetKindConfig';
import { RelevanceBadge } from './RelevanceBadge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';

// Types
type SortKey = 'name' | 'updated_at' | 'kind';
type SortDirection = 'asc' | 'desc';
type AssetTreeItemType = 'folder' | 'asset';

export interface AssetTreeItem {
  id: string;
  type: AssetTreeItemType;
  name: string;
  asset?: AssetRead;
  bundle?: BundleRead;
  children?: AssetTreeItem[];
  level: number;
  isExpanded: boolean;
  isSelected: boolean;
  parentId?: string;
  isContainer?: boolean;
}

// Asset icon/badge helpers are imported from './assetKindConfig'
// Re-export for backwards compatibility with other modules that may import from here
export { getAssetIcon, formatAssetKind, getAssetBadgeClass } from './assetKindConfig';

/** Parsed virtual folder ID: vfolder-{bundleId}__{urlencodedPath} */
export function parseVfolderId(id: string): { bundleId: number; pathPrefix: string } | null {
  if (!id.startsWith('vfolder-')) return null;
  const parts = id.replace('vfolder-', '').split('__');
  const bundleId = parseInt(parts[0], 10);
  if (isNaN(bundleId)) return null;
  const pathPrefix = parts.length > 1 ? decodeURIComponent(parts[1].replace(/\|/g, '/')) : '';
  return { bundleId, pathPrefix };
}

interface AssetSelectorProps {
    selectedItems: Set<string>;
    onSelectionChange: (selectedIds: Set<string>) => void;
    // Props to control available actions, e.g. hide 'delete' button
    // For now, we'll keep it simple and just manage selection
    onItemView?: (item: AssetTreeItem) => void;
    onItemDoubleClick?: (item: AssetTreeItem) => void;
    /** Called when user clicks "Materialize as bundle" on a virtual folder. Creates a real bundle from the path. */
    onMaterializeVfolder?: (params: { bundleId: number; pathPrefix: string; name: string }) => void;
    // Prop to allow parent component to provide actions for the dropdown menu
    renderItemActions?: (item: AssetTreeItem) => React.ReactNode;
    /** Render context menu items for a tree item, or null for empty-space right-click */
    renderContextMenu?: (item: AssetTreeItem | null) => React.ReactNode;
    // External search control
    initialSearchTerm?: string;
    onSearchTermChange?: (searchTerm: string) => void;
    autoFocusSearch?: boolean;
    // Compact mode - hides header and reduces padding for inline usage
    compact?: boolean;
    // Filter to show only children of a specific bundle (for bundle detail view)
    filterByBundleId?: number | null;
    /** Path prefix for virtual folder - when set with filterByBundleId, fetches vfolder children */
    pathPrefix?: string | null;
    sortBy?: 'name' | 'updated_at' | 'created_at';
    sortOrder?: 'asc' | 'desc';
    /** Render always-visible badge/icon after item name (e.g. favorite star) */
    renderItemBadge?: (item: AssetTreeItem) => React.ReactNode;
    /** Only show bundle nodes (hide standalone assets). Useful for bundle pickers. */
    bundlesOnly?: boolean;
}

export default function AssetSelector({
    selectedItems,
    onSelectionChange,
    onItemView,
    onItemDoubleClick,
    onMaterializeVfolder,
    renderItemActions,
    renderContextMenu,
    renderItemBadge,
    initialSearchTerm = '',
    onSearchTermChange,
    autoFocusSearch = false,
    compact = false,
    filterByBundleId = null,
    pathPrefix = null,
    sortBy = 'name',
    sortOrder = 'asc',
    bundlesOnly = false,
}: AssetSelectorProps) {
  const { activeInfospace } = useInfospaceStore();
  
  // NEW: Use tree store for efficient loading
  const {
    rootNodes,
    childrenCache,
    hasMoreChildren,
    isLoadingRoot,
    isLoadingChildren,
    fetchRootTree,
    fetchChildren,
  } = useTreeStore();
  
  // Still need asset/bundle stores for mutations
  const {
    updateAsset,
  } = useAssetStore();
  
  const {
    addAssetToBundle,
    removeAssetFromBundle,
    updateBundle,
    createBundle,
    moveBundleToParent,
    sealBundle,
    unsealBundle,
  } = useBundleStore();

  // Poll for active ingestion jobs
  const { activeJobs, getJob, refresh: refreshJobs } = useIngestionJobs({
    pollInterval: 2000,
    activeOnly: true,
    onJobComplete: async (job) => {
      // Refresh tree when a job completes
      console.log('[AssetSelector] Ingestion job completed:', job.id);
      await useTreeStore.getState().clearCache();
      await fetchRootTree();
      toast.success(`Dataset ingestion completed: ${job.processed_files} files processed`);
    },
  });

  // UI State
  const [searchTerm, setSearchTerm] = useState(initialSearchTerm);
  const debouncedSearchTerm = useDebounce(searchTerm, 300);
  
  // Notify parent of search term changes
  useEffect(() => {
    onSearchTermChange?.(debouncedSearchTerm);
  }, [debouncedSearchTerm, onSearchTermChange]);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [assetTypeFilter, setAssetTypeFilter] = useState<AssetKind | 'all'>('all');
  const [sortOption, setSortOption] = useState(`${sortBy}-${sortOrder}`);
  
  // Search mode: semantic (~prefix) vs text (plain FTS)
  const [useSemanticMode, setUseSemanticMode] = useState(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('assetSelector_searchMode');
      return stored === 'semantic';
    }
    return false;
  });
  const isSemanticAvailable = !!(activeInfospace?.enrichment_config as any)?.embedding?.model_name;

  // Build AQL query: prepend ~ for semantic mode
  const aqlQuery = useMemo(() => {
    const term = debouncedSearchTerm.trim();
    if (!term) return '';
    return useSemanticMode && isSemanticAvailable ? `~${term}` : term;
  }, [debouncedSearchTerm, useSemanticMode, isSemanticAvailable]);

  // Unified search via AQL /query endpoint
  const {
    nameMatches,
    results: queryResults,
    childResults: queryChildResults,
    isLoading: isSearching,
    error: searchError,
  } = useAssetQuery({
    infospaceId: activeInfospace?.id || 0,
    query: aqlQuery,
    limit: 50,
    enabled: aqlQuery.length > 0,
  });
  const isSearchActive = aqlQuery.length > 0;

  // Store preference in localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('assetSelector_searchMode', useSemanticMode ? 'semantic' : 'text');
    }
  }, [useSemanticMode]);
  
  // Inline editing state
  const [editingItem, setEditingItem] = useState<{ id: string; value: string } | null>(null);
  
  // Search input ref for auto-focus
  const searchInputRef = useRef<HTMLInputElement>(null);
  
  // Keyboard navigation state
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const flattenedItemsRef = useRef<AssetTreeItem[]>([]);
  
  // Bundle click timeout for distinguishing single vs double click
  const bundleClickTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Data fetching state - NOW REMOVED! Using tree store instead
  // const [bundleAssets, setBundleAssets] = useState<Map<number, AssetRead[]>>(new Map());
  // const [childAssets, setChildAssets] = useState<Map<number, AssetRead[]>>(new Map());
  // const [isLoadingChildren, setIsLoadingChildren] = useState<Set<number>>(new Set());

  // Context menu state (item=null means empty-space right-click)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: AssetTreeItem | null } | null>(null);

  // Drag and drop state
  const [draggedOverBundleId, setDraggedOverBundleId] = useState<string | null>(null);
  const [isDraggedOverTopLevel, setIsDraggedOverTopLevel] = useState(false);
  const [draggedOverAssetId, setDraggedOverAssetId] = useState<string | null>(null);
  const [dragOverTimeout, setDragOverTimeout] = useState<NodeJS.Timeout | null>(null);
  const [sealRejectedId, setSealRejectedId] = useState<string | null>(null);

  // Refresh state
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullOffset, setPullOffset] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef<number>(0);
  const isDragging = useRef(false);
  const wheelAccumulator = useRef<number>(0);
  const wheelResetTimeout = useRef<NodeJS.Timeout | null>(null);
  const lastWheelTime = useRef<number>(0);

  const fetchingRef = useRef(false);
  const previousRootNodesRef = useRef<AssetNode[]>([]);
  const previousChildrenCacheRef = useRef<Map<string, AssetNode[]>>(new Map());

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (dragOverTimeout) {
        clearTimeout(dragOverTimeout);
      }
      if (wheelResetTimeout.current) {
        clearTimeout(wheelResetTimeout.current);
      }
      if (bundleClickTimeoutRef.current) {
        clearTimeout(bundleClickTimeoutRef.current);
      }
    };
  }, [dragOverTimeout]);

  // Reset all drag state when any drag operation ends (drop, cancel, Escape)
  // Empty deps — state setters are stable, no stale closure risk
  useEffect(() => {
    const resetDragState = () => {
      setIsDraggedOverTopLevel(false);
      setDraggedOverBundleId(null);
      setDraggedOverAssetId(null);
      setDragOverTimeout((prev) => { if (prev) clearTimeout(prev); return null; });
    };
    document.addEventListener('dragend', resetDragState);
    // Also catch drops outside valid targets (fires on document)
    document.addEventListener('drop', resetDragState);
    return () => {
      document.removeEventListener('dragend', resetDragState);
      document.removeEventListener('drop', resetDragState);
    };
  }, []);

  // Sync initial search term and auto-focus
  useEffect(() => {
    setSearchTerm(initialSearchTerm);
  }, [initialSearchTerm]);

  useEffect(() => {
    if (autoFocusSearch && searchInputRef.current) {
      searchInputRef.current.focus();
    }
    // In compact mode, set first item as focused for keyboard navigation
    if (compact && flattenedItemsRef.current.length > 0) {
      setFocusedIndex(0);
    }
  }, [autoFocusSearch, compact]);

  // Note: flattenedItems will be computed after itemsForView is defined

  // Refresh handler - simplified
  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    
    setIsRefreshing(true);
    setPullOffset(0);
    
    try {
      const store = useTreeStore.getState();
      
      // Save current expanded items to restore after refresh
      const expandedIds = Array.from(expandedItems);
      
      // Force refresh by clearing lastFetchedInfospaceId (allows fetchRootTree to run)
      useTreeStore.setState({ lastFetchedInfospaceId: null });
      
      // Fetch new data
      await store.fetchRootTree();
      
      // Re-fetch children for all expanded items
      const childrenPromises = expandedIds.map(async (itemId) => {
        const node = [...store.rootNodes, ...Array.from(store.childrenCache.values()).flat()]
          .find(n => n.id === itemId);
        if (node && (node.type === 'bundle' || node.has_children)) {
          try {
            // Clear cache for this item to force refresh
            const newCache = new Map(store.childrenCache);
            newCache.delete(itemId);
            useTreeStore.setState({ childrenCache: newCache });
            
            await store.fetchChildren(itemId);
          } catch (err) {
            console.warn(`[AssetSelector] Failed to reload children for ${itemId}:`, err);
          }
        }
      });
      
      await Promise.all(childrenPromises);
      
      toast.success('Refreshed');
    } catch (error) {
      console.error('[AssetSelector] Refresh error:', error);
      toast.error('Failed to refresh');
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, expandedItems]);

  // Simple pull-to-refresh handlers - clean implementation (touch + mouse wheel)
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer || isRefreshing) return;
    
    const viewport = scrollContainer.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement;
    if (!viewport) return;
    
    // Only start if at top of scroll
    if (viewport.scrollTop === 0) {
      touchStartY.current = e.touches[0].clientY;
      isDragging.current = true;
    }
  }, [isRefreshing]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging.current || isRefreshing) return;
    
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;
    
    const viewport = scrollContainer.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement;
    if (!viewport || viewport.scrollTop > 0) {
      isDragging.current = false;
      setPullOffset(0);
      return;
    }

    const currentY = e.touches[0].clientY;
    const delta = currentY - touchStartY.current;
    
    // Simple pull with light resistance
    if (delta > 0) {
      const resistance = 0.4;
      setPullOffset(Math.min(delta * resistance, 100));
    }
  }, [isRefreshing]);

  const handleTouchEnd = useCallback(() => {
    if (!isDragging.current) return;
    
    isDragging.current = false;
    
    // Trigger refresh if pulled past threshold
    if (pullOffset >= 50) {
      handleRefresh();
    } else {
      setPullOffset(0);
    }
  }, [pullOffset, handleRefresh]);

  // Desktop: Mouse wheel support for pull-to-refresh - smooth implementation
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (isRefreshing) return;
    
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;
    
    const viewport = scrollContainer.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement;
    if (!viewport) return;
    
    // Only trigger when at top and scrolling up
    if (viewport.scrollTop === 0 && e.deltaY < 0) {
      e.preventDefault();
      
      // Clear reset timeout
      if (wheelResetTimeout.current) {
        clearTimeout(wheelResetTimeout.current);
      }
      
      // Accumulate wheel delta
      wheelAccumulator.current += Math.abs(e.deltaY) * 0.3;
      const offset = Math.min(wheelAccumulator.current, 100);
      setPullOffset(offset);
      
      // Trigger refresh at threshold
      if (offset >= 50) {
        wheelAccumulator.current = 0;
        handleRefresh();
      } else {
        // Reset after inactivity
        wheelResetTimeout.current = setTimeout(() => {
          wheelAccumulator.current = 0;
          setPullOffset(0);
        }, 200);
      }
    } else if (viewport.scrollTop > 0 && pullOffset > 0) {
      // Reset if scrolled down
      wheelAccumulator.current = 0;
      setPullOffset(0);
      if (wheelResetTimeout.current) {
        clearTimeout(wheelResetTimeout.current);
      }
    }
  }, [isRefreshing, pullOffset, handleRefresh]);

  // NEW: Fetch tree data when infospace changes (single efficient call!)
  // If filterByBundleId is provided, fetch children of that bundle instead
  useEffect(() => {
    if (activeInfospace?.id && !fetchingRef.current) {
      fetchingRef.current = true;
      
      if (filterByBundleId !== null) {
        // Fetch children of bundle or virtual folder (when pathPrefix set)
        const rootNodeId = pathPrefix != null && pathPrefix !== ''
          ? `vfolder-${filterByBundleId}__${encodeURIComponent(pathPrefix)}`
          : `bundle-${filterByBundleId}`;
        console.log('[AssetSelector] Fetching children for:', rootNodeId);
        fetchChildren(rootNodeId).finally(() => {
          fetchingRef.current = false;
        });
      } else {
        // Fetch root tree
        console.log('[AssetSelector] Fetching tree for infospace:', activeInfospace.id);
        fetchRootTree().finally(() => {
          fetchingRef.current = false;
        });
      }
    }
  }, [activeInfospace?.id, filterByBundleId, pathPrefix, fetchRootTree, fetchChildren]);

  // NEW: Restore expanded state after data loads - fixes issue where bundles appear open but have no children
  // Optimized to only run when necessary
  useEffect(() => {
    // Only run if root is loaded and we have expanded items
    if (isLoadingRoot || expandedItems.size === 0) return;
    if (rootNodes.length === 0 && previousRootNodesRef.current.length === 0) return;
    
    // Check if we have expanded items that need their children loaded
    const expandedIds = Array.from(expandedItems);
    const itemsToLoad: string[] = [];
    
    // Build a set of all node IDs for quick lookup
    const allNodeIds = new Set<string>();
    rootNodes.forEach(n => allNodeIds.add(n.id));
    childrenCache.forEach(children => {
      children.forEach(n => allNodeIds.add(n.id));
    });
    
    // Find expanded items that need children loaded
    expandedIds.forEach(itemId => {
      if (!childrenCache.has(itemId) && 
          !isLoadingChildren.has(itemId) && 
          allNodeIds.has(itemId)) {
        itemsToLoad.push(itemId);
      }
    });

    // Load children in parallel (but limit concurrency)
    if (itemsToLoad.length > 0) {
      // Load up to 5 items at once to avoid overwhelming the server
      const batchSize = 5;
      for (let i = 0; i < itemsToLoad.length; i += batchSize) {
        const batch = itemsToLoad.slice(i, i + batchSize);
        Promise.all(
          batch.map(async (itemId) => {
            try {
              await fetchChildren(itemId);
            } catch (err) {
              console.warn(`[AssetSelector] Failed to load children for ${itemId}:`, err);
            }
          })
        ).catch(err => {
          console.warn('[AssetSelector] Batch load error:', err);
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootNodes.length, expandedItems.size, isLoadingRoot, isLoadingChildren.size, fetchChildren]);

  // Memoized asset kinds for filter dropdown (from tree nodes)
  const assetKinds = useMemo(() => {
    const kinds = new Set<AssetKind>();
    const collectKinds = (nodes: any[]) => {
      nodes.forEach(node => {
        if (node.type === 'asset' && node.kind) {
          kinds.add(node.kind);
        }
      });
    };
    collectKinds(rootNodes);
    childrenCache.forEach(children => collectKinds(children));
    return Array.from(kinds).sort();
  }, [rootNodes, childrenCache]);

  // Create map of search results (asset_id -> score) from unified query
  const searchScoreMap = useMemo(() => {
    const map = new Map<number, number>();
    for (const r of nameMatches.assets) {
      map.set(r.asset.id, (r.score ?? 0) * 100);
    }
    for (const r of queryResults) {
      if (!map.has(r.asset.id)) {
        map.set(r.asset.id, (r.score ?? 0) * 100);
      }
    }
    return map;
  }, [nameMatches.assets, queryResults]);

  // OLD N+1 FETCHING LOGIC - REMOVED! 🎉

  // Inline editing handlers
  const handleEditItem = useCallback((item: AssetTreeItem) => {
    setEditingItem({ id: item.id, value: item.name });
  }, []);

  const handleSaveEditing = useCallback(async () => {
    if (!editingItem) return;

    const { id, value } = editingItem;
    setEditingItem(null);

    if (id.startsWith('asset-')) {
      const assetId = parseInt(id.replace('asset-', ''), 10);
      try {
        await updateAsset(assetId, { title: value });
        toast.success(`Asset updated.`);
      } catch (error) {
        toast.error('Failed to update asset.');
      }
    } else if (id.startsWith('bundle-')) {
      const bundleId = parseInt(id.replace('bundle-', ''), 10);
      try {
        await updateBundle(bundleId, { name: value });
        toast.success(`Bundle updated.`);
      } catch (error) {
        console.error('Error updating bundle:', error);
        toast.error('Failed to update bundle.');
      }
    }
  }, [editingItem, updateAsset, updateBundle]);

  const handleCancelEdit = () => {
    setEditingItem(null);
  };
  
  // Convert an AssetNode from the tree store into an AssetTreeItem for rendering.
  const convertAssetNodeToTreeItem = useCallback((node: AssetNode, level: number = 0, parentId?: string): AssetTreeItem => {
    const isExpanded = expandedItems.has(node.id);
    const isSelected = selectedItems.has(node.id);

    let children: AssetTreeItem[] | undefined;
    if (isExpanded) {
      const cachedChildren = childrenCache.get(node.id) || previousChildrenCacheRef.current.get(node.id);
      if (cachedChildren && cachedChildren.length > 0) {
        const relevantChildren = bundlesOnly
          ? cachedChildren.filter(c => c.type === 'bundle')
          : cachedChildren;
        children = relevantChildren.map(child => convertAssetNodeToTreeItem(child, level + 1, node.id));
      }
    }

    let asset: AssetRead | undefined;
    let bundle: BundleRead | undefined;

    if (node.type === 'asset') {
      const assetId = parseInt(node.id.replace('asset-', ''));
      asset = {
        id: assetId,
        title: node.name,
        kind: node.kind,
        is_container: !!node.has_children,
        stub: node.stub || false,
        processing_status: node.processing_status,
        updated_at: node.updated_at,
        created_at: node.created_at,
        infospace_id: activeInfospace?.id || 0,
        parent_asset_id: node.parent_asset_id ?? null,
        text_content: '',
        uuid: '',
        part_index: node.part_index ?? null,
        source_id: null,
        facets: node.facets || null,
        file_info: null,
        tags: node.tags || [],
      } as AssetRead;
    } else if (node.type === 'bundle') {
      const bundleId = parseInt(node.id.replace('bundle-', ''));
      const parentBundleId =
        parentId && parentId.startsWith('bundle-')
          ? parseInt(parentId.replace('bundle-', ''))
          : null;
      bundle = {
        id: bundleId,
        name: node.name,
        description: '',
        infospace_id: activeInfospace?.id || 0,
        parent_bundle_id: parentBundleId,
        updated_at: node.updated_at,
        created_at: node.created_at || node.updated_at,
        asset_count: node.asset_count || 0,
        child_bundle_count: node.child_bundle_count || 0,
        sealed: node.sealed || false,
        tags: node.tags || [],
      } as BundleRead;
    }

    return {
      id: node.id,
      type: (node.type === 'bundle' || node.type === 'virtual_folder') ? 'folder' : 'asset',
      name: node.name,
      level,
      isExpanded,
      isSelected,
      parentId,
      isContainer: node.type === 'bundle' || node.type === 'virtual_folder' || !!node.has_children || undefined,
      children,
      asset,
      bundle,
    };
  }, [expandedItems, selectedItems, childrenCache, activeInfospace, bundlesOnly]);

  // Helper: Convert AssetRead to AssetNode so search results can flow through the same tree renderer.
  const assetReadToAssetNode = useCallback((asset: AssetRead): AssetNode => {
    return {
      id: `asset-${asset.id}`,
      type: 'asset' as const,
      name: asset.title || 'Untitled',
      kind: asset.kind,
      has_children: !!asset.is_container,
      stub: asset.stub || false,
      processing_status: asset.processing_status,
      parent_asset_id: asset.parent_asset_id ?? null,
      part_index: asset.part_index ?? null,
      tags: asset.tags ?? null,
      updated_at: asset.updated_at,
      created_at: asset.created_at,
      facets: asset.facets ?? null,
    };
  }, []);

  // Generate hierarchical asset tree
  // Project AssetNodes into AssetTreeItems. Memoized to avoid churn during search/refresh.
  const assetTree = useMemo(() => {
    // Use filtered bundle children if filterByBundleId is set, otherwise use root nodes
    // Keep showing previous data during refresh to prevent empty state
    const bundleRootNodeId = filterByBundleId != null && pathPrefix != null && pathPrefix !== ''
      ? `vfolder-${filterByBundleId}__${encodeURIComponent(pathPrefix)}`
      : filterByBundleId != null ? `bundle-${filterByBundleId}` : null;
    const nodesToRender = bundleRootNodeId !== null 
      ? (childrenCache.get(bundleRootNodeId) || previousChildrenCacheRef.current.get(bundleRootNodeId) || [])
      : (rootNodes.length > 0 ? rootNodes : previousRootNodesRef.current);
    
    // Update refs for next render
    if (rootNodes.length > 0) {
      previousRootNodesRef.current = rootNodes;
    }
    if (childrenCache.size > 0) {
      previousChildrenCacheRef.current = new Map(childrenCache);
    }
    
    // Reuse the shared conversion function
    const filteredNodesToRender = bundlesOnly
      ? nodesToRender.filter(n => n.type === 'bundle')
      : nodesToRender;
    const tree = filteredNodesToRender.map(node => convertAssetNodeToTreeItem(node, 0));
    console.log('[AssetSelector] Generated', tree.length, 'tree items');

    // Parse sort option - supports both "key-direction" and "primary-secondary-direction" formats
    const sortParts = sortOption.split('-');
    const isCompoundSort = sortParts.length === 3; // e.g., "name-desc"
    const primaryKey = sortParts[0] as SortKey;
    const secondaryKey = isCompoundSort ? sortParts[1] as SortKey : null;
    const sortDirection = (isCompoundSort ? sortParts[2] : sortParts[1]) as SortDirection;

    
    
    const sortItemsRecursively = (items: AssetTreeItem[]): AssetTreeItem[] => {
        const sortedItems = [...items].sort((a, b) => {
            // Folders always come first
            if (a.type === 'folder' && b.type !== 'folder') return -1;
            if (a.type !== 'folder' && b.type === 'folder') return 1;

            // Helper to get sort value for a given key
            const getSortValue = (item: AssetTreeItem, key: SortKey): string | number => {
                switch(key) {
                    case 'name':
                        return item.name.toLowerCase();
                    case 'updated_at':
                        return item.asset ? new Date(item.asset.updated_at).getTime() : (item.bundle ? new Date(item.bundle.updated_at).getTime() : 0);
                    case 'kind':
                        return item.asset?.kind || ' ';
                    default:
                        return 0;
                }
            };

            // Primary sort
            const valA = getSortValue(a, primaryKey);
            const valB = getSortValue(b, primaryKey);
            
            // For compound sort (kind + date): primary sort is always ascending by kind,
            // secondary sort uses the specified direction
            const primaryDirection = isCompoundSort && primaryKey === 'kind' ? 'asc' : sortDirection;
            
            if (valA < valB) return primaryDirection === 'asc' ? -1 : 1;
            if (valA > valB) return primaryDirection === 'asc' ? 1 : -1;
            
            // Secondary sort (for compound sorts like kind-updated_at)
            if (secondaryKey) {
                const secA = getSortValue(a, secondaryKey);
                const secB = getSortValue(b, secondaryKey);
                
                if (secA < secB) return sortDirection === 'asc' ? -1 : 1;
                if (secA > secB) return sortDirection === 'asc' ? 1 : -1;
            }
            
            // Fallback: sort by name
            if (a.name.toLowerCase() < b.name.toLowerCase()) return -1;
            if (a.name.toLowerCase() > b.name.toLowerCase()) return 1;

            return 0;
        });
        return sortedItems.map(item => ({ ...item, children: item.children ? sortItemsRecursively(item.children) : undefined }));
    };
    return sortItemsRecursively(tree);
  }, [rootNodes, childrenCache, expandedItems, selectedItems, sortOption, filterByBundleId, pathPrefix, convertAssetNodeToTreeItem]);
  
  // Convert query results to AssetTreeItems — tiered
  const searchNameBundleItems = useMemo(() => {
    if (!isSearchActive || nameMatches.bundles.length === 0) return [];
    return nameMatches.bundles.map((b): AssetTreeItem => ({
      id: `bundle-${b.id}`,
      type: 'folder',
      name: b.name,
      level: 0,
      isExpanded: false,
      isSelected: selectedItems.has(`bundle-${b.id}`),
      isContainer: true,
      bundle: b as any,
    }));
  }, [isSearchActive, nameMatches.bundles, selectedItems]);

  const searchNameAssetItems = useMemo(() => {
    if (!isSearchActive || nameMatches.assets.length === 0) return [];
    return nameMatches.assets.map(r => {
      const treeNode = assetReadToAssetNode(r.asset);
      const treeItem = convertAssetNodeToTreeItem(treeNode, 0);
      return { ...treeItem, asset: r.asset };
    });
  }, [isSearchActive, nameMatches.assets, assetReadToAssetNode, convertAssetNodeToTreeItem]);

  const searchContentItems = useMemo(() => {
    if (!isSearchActive || queryResults.length === 0) return [];
    return queryResults.map(r => {
      const treeNode = assetReadToAssetNode(r.asset);
      const treeItem = convertAssetNodeToTreeItem(treeNode, 0);
      return { ...treeItem, asset: r.asset };
    });
  }, [isSearchActive, queryResults, assetReadToAssetNode, convertAssetNodeToTreeItem]);

  // Filter tree based on search and type
  const filteredTree = useMemo(() => {
    // When search is active, the tiered results (searchNameBundleItems, searchNameAssetItems,
    // searchContentItems, queryChildResults) are rendered directly in JSX — filteredTree
    // only governs the non-search tree view.
    if (isSearchActive) {
      return assetTree; // unused in search mode, but keep stable reference
    }

    // No search active - use client-side filtering on tree
    const filterItems = (items: AssetTreeItem[]): AssetTreeItem[] => {
      return items.reduce((acc: AssetTreeItem[], item) => {
        const filteredChildren = item.children ? filterItems(item.children) : undefined;
        const typeMatch = assetTypeFilter === 'all' || item.type === 'folder' || item.asset?.kind === assetTypeFilter;
        let keepItem = false;
        if (item.type === 'folder') {
          if ((filteredChildren && filteredChildren.length > 0) || (typeMatch && assetTypeFilter === 'all')) {
            keepItem = true;
          }
        } else {
          if (typeMatch) {
            keepItem = true;
          }
        }
        if (keepItem) acc.push({ ...item, children: filteredChildren });
        return acc;
      }, []);
    };
    return filterItems(assetTree);
  }, [assetTree, assetTypeFilter, isSearchActive]);

  // NEW: Lazy load children when expanding nodes - optimized
  const toggleExpanded = useCallback(async (itemId: string) => {
    const isCurrentlyExpanded = expandedItems.has(itemId);
    const newExpandedSet = new Set(expandedItems);
    
    if (isCurrentlyExpanded) {
      newExpandedSet.delete(itemId);
    } else {
      newExpandedSet.add(itemId);
    }
    
    setExpandedItems(newExpandedSet);

    // Lazy load children if expanding and not already cached or loading
    if (!isCurrentlyExpanded && !childrenCache.has(itemId) && !isLoadingChildren.has(itemId)) {
      console.log('[AssetSelector] Lazy loading children for:', itemId);
      try {
        await fetchChildren(itemId);
      } catch (error) {
        console.error(`[AssetSelector] Failed to fetch children for ${itemId}:`, error);
        // On error, collapse the item
        setExpandedItems(prev => {
          const errorSet = new Set(prev);
          errorSet.delete(itemId);
          return errorSet;
        });
      }
    }
  }, [expandedItems, childrenCache, isLoadingChildren, fetchChildren]);

  const allVisibleItemIds = useMemo(() => {
    const ids = new Set<string>();
    const collectIds = (items: AssetTreeItem[]) => {
      for (const item of items) {
        ids.add(item.id);
        if (item.children) collectIds(item.children);
      }
    };
    collectIds(filteredTree);
    return ids;
  }, [filteredTree]);

  const isAllSelected = useMemo(() => {
    if (allVisibleItemIds.size === 0) return false;
    for (const id of allVisibleItemIds) if (!selectedItems.has(id)) return false;
    return true;
  }, [selectedItems, allVisibleItemIds]);

  const handleSelectAll = (checked: boolean) => {
    onSelectionChange(checked ? new Set(allVisibleItemIds) : new Set());
  };

  const toggleSelected = useCallback((itemId: string, multiSelect?: boolean) => {
    const newSet = new Set(selectedItems);
    const wasSelected = newSet.has(itemId);
    
    if (!multiSelect) {
      // Single select mode - replace selection
      newSet.clear();
      newSet.add(itemId);
    } else {
      // Multi-select mode - toggle this item
      if (wasSelected) {
        newSet.delete(itemId);
      } else {
        newSet.add(itemId);
      }
    }
    
    // NEW: Auto-select child images when parent article/web asset is selected
    // Find the item in the tree to check its type and children
    const findItemInTree = (items: AssetTreeItem[], id: string): AssetTreeItem | null => {
      for (const item of items) {
        if (item.id === id) return item;
        if (item.children) {
          const found = findItemInTree(item.children, id);
          if (found) return found;
        }
      }
      return null;
    };
    
    const item = findItemInTree(filteredTree, itemId);
    if (item && item.type === 'asset' && item.asset) {
      const asset = item.asset;
      const isArticleOrWeb = asset.kind === 'article' || asset.kind === 'web';
      
      // Only auto-select if item was just selected (not deselected)
      if (isArticleOrWeb && !wasSelected && newSet.has(itemId)) {
        // Parent selected - auto-select child images
        const childImages = item.children?.filter(
          child => child.type === 'asset' && 
          child.asset?.kind === 'image'
        ) || [];
        
        let autoSelectedCount = 0;
        childImages.forEach(child => {
          if (child.id && !newSet.has(child.id)) {
            newSet.add(child.id);
            autoSelectedCount++;
          }
        });
        
        if (autoSelectedCount > 0) {
          // Show toast notification for auto-selected images
          toast.info(`Auto-selected ${autoSelectedCount} image${autoSelectedCount > 1 ? 's' : ''}`, {
            duration: 2000,
          });
        }
      }
      // Note: We don't auto-deselect children when parent is deselected
      // to give users more control
    }
    
    onSelectionChange(newSet);
  }, [selectedItems, onSelectionChange, filteredTree]);

  const handleItemClick = useCallback(async (item: AssetTreeItem) => {
    if (!onItemView) return;
    
    // For detail views, we need the FULL object with all fields
    // The tree only has minimal data for display
    if (item.type === 'asset' && item.asset) {
      const assetId = item.asset.id;
      const fullAsset = await useTreeStore.getState().getFullAsset(assetId);
      if (fullAsset) {
        // Create enhanced tree item with full asset data
        onItemView({ ...item, asset: fullAsset });
      }
    } else if (item.type === 'folder' && item.bundle) {
      const bundleId = item.bundle.id;
      const fullBundle = await useTreeStore.getState().getFullBundle(bundleId);
      if (fullBundle) {
        // Create enhanced tree item with full bundle data
        onItemView({ ...item, bundle: fullBundle });
      }
    } else {
      onItemView(item);
    }
  }, [onItemView]);

  const handleItemDoubleClickInternal = useCallback(async (item: AssetTreeItem) => {
    if (onItemDoubleClick) {
      // Fetch full data for double-click too
      if (item.type === 'asset' && item.asset) {
        const fullAsset = await useTreeStore.getState().getFullAsset(item.asset.id);
        if (fullAsset) {
          onItemDoubleClick({ ...item, asset: fullAsset });
          return;
        }
      } else if (item.type === 'folder' && item.bundle) {
        const fullBundle = await useTreeStore.getState().getFullBundle(item.bundle.id);
        if (fullBundle) {
          onItemDoubleClick({ ...item, bundle: fullBundle });
          return;
        }
      }
      onItemDoubleClick(item);
    } else if (item.type === 'folder') {
      // Expand/collapse folder on double-click
      toggleExpanded(item.id);
    } else if (onItemView) {
      // Folders are handled above (toggle expand); here `item` is always an asset.
      if (item.asset) {
        const fullAsset = await useTreeStore.getState().getFullAsset(item.asset.id);
        if (fullAsset) {
          onItemView({ ...item, asset: fullAsset });
          return;
        }
      }
      onItemView(item);
    }
  }, [onItemDoubleClick, onItemView, toggleExpanded]);

  // Helper to recursively collect all child IDs from tree
  const collectAllDescendantIds = useCallback((nodeId: string): string[] => {
    const ids: string[] = [nodeId];
    const children = childrenCache.get(nodeId) || [];
    children.forEach(child => {
      ids.push(...collectAllDescendantIds(child.id));
    });
    return ids;
  }, [childrenCache]);

  const toggleBundleSelection = useCallback(async (bundleId: number, select: boolean) => {
    const bundleItemId = `bundle-${bundleId}`;

    // Apply the cache-based cascade synchronously so the UI reacts instantly
    // for bundles the user already expanded. This covers the common case and
    // the deselect path (where the backend lookup would only be redundant
    // churn).
    const cacheIds = collectAllDescendantIds(bundleItemId);
    const seed = new Set(selectedItems);
    if (select) {
      cacheIds.forEach(id => seed.add(id));
    } else {
      cacheIds.forEach(id => seed.delete(id));
    }
    onSelectionChange(seed);

    // On select, bundles the user hasn't expanded yet have an empty
    // childrenCache — so `cacheIds` is just [bundle-N] and downstream counters
    // (e.g. AnnotationRunnerDock's asset count) stay at zero. Pull the full
    // descendant asset list from the backend so the selection reflects what
    // a "run on this bundle" would actually target.
    if (!select || !activeInfospace?.id) return;
    try {
      const assetIds = await BundlesService.getBundleDescendantAssetIds({
        infospaceId: activeInfospace.id,
        bundleId,
        recursive: true,
      });
      if (!assetIds || assetIds.length === 0) return;
      // Merge with whatever the user has selected in the meantime — do not
      // clobber other picks.
      const next = new Set(seed);
      let added = 0;
      assetIds.forEach((id) => {
        const key = `asset-${id}`;
        if (!next.has(key)) { next.add(key); added++; }
      });
      if (added > 0) onSelectionChange(next);
    } catch (err: any) {
      console.error('[AssetSelector] Failed to expand bundle selection:', err);
      toast.error(err?.message || 'Failed to expand bundle selection');
    }
  }, [selectedItems, onSelectionChange, collectAllDescendantIds, activeInfospace?.id]);
  
  const isBundleFullySelected = useCallback((bundleId: number) => {
    const bundleItemId = `bundle-${bundleId}`;
    if (!selectedItems.has(bundleItemId)) return false;
    const allIds = collectAllDescendantIds(bundleItemId);
    return allIds.every(id => selectedItems.has(id));
  }, [selectedItems, collectAllDescendantIds]);

  const isBundlePartiallySelected = useCallback((bundleId: number) => {
    const bundleItemId = `bundle-${bundleId}`;
    if (selectedItems.has(bundleItemId)) return false;
    const allIds = collectAllDescendantIds(bundleItemId);
    // Excluding the bundle itself
    return allIds.slice(1).some(id => selectedItems.has(id));
  }, [selectedItems, collectAllDescendantIds]);

  const handleDropOnBundle = useCallback(async (bundleItem: AssetTreeItem, e: React.DragEvent) => {
    // Always reset all drag visual state immediately
    setDraggedOverBundleId(null);
    setDraggedOverAssetId(null);
    setIsDraggedOverTopLevel(false);
    // Extract bundle ID from node ID (format: "bundle-123")
    if (!bundleItem.id.startsWith('bundle-')) return;
    if (bundleItem.bundle?.sealed) {
      toast.error('Cannot drop into a sealed bundle.');
      setSealRejectedId(bundleItem.id);
      setTimeout(() => setSealRejectedId(null), 600);
      return;
    }
    const destinationBundleId = parseInt(bundleItem.id.replace('bundle-', ''));
    const data = e.dataTransfer.getData('application/json');
    if (!data) return;
    try {
        const parsedData = JSON.parse(data);
        const { type, items } = parsedData;
        
        if (type === 'assets' && Array.isArray(items)) {
            // Handle asset drops
            const draggedAssets = items as AssetRead[];
            toast.info(`Moving ${draggedAssets.length} asset(s) to "${bundleItem.name}"...`);
            // Simplified: just add assets to bundle (backend handles deduplication)
            const promises = draggedAssets.map(asset => 
                addAssetToBundle(destinationBundleId, asset.id)
            );
            await Promise.all(promises);
            toast.success(`Successfully moved ${draggedAssets.length} asset(s).`);
            
            // NEW: Refresh tree cache
            await useTreeStore.getState().clearCache();
            await fetchRootTree();
        } else if (type === 'mixed' && Array.isArray(items)) {
            // Handle mixed drops (bundles and assets)
            // destinationBundleId already defined at top of function
            const bundlesToMove = items.filter(item => item.type === 'bundle').map(item => item.item);
            const assetsToMove = items.filter(item => item.type === 'asset').map(item => item.item);
            
            // Prevent moving a bundle into itself or its descendants
            const isInvalidMove = bundlesToMove.some(bundle => {
                if (bundle.id === destinationBundleId) return true;
                // TODO: Add check for descendant bundles when we implement hierarchy display
                return false;
            });
            
            if (isInvalidMove) {
                toast.error('Cannot move a folder into itself.');
                return;
            }
            
            const totalItems = bundlesToMove.length + assetsToMove.length;
            toast.info(`Moving ${totalItems} item(s) to "${bundleItem.name}"...`);
            
            const promises: Promise<any>[] = [];
            
            // Move bundles using the new nested bundle API
            bundlesToMove.forEach(bundle => {
                promises.push(moveBundleToParent(bundle.id, destinationBundleId));
            });
            
            // Move assets
            assetsToMove.forEach(asset => {
                promises.push(addAssetToBundle(destinationBundleId, asset.id));
            });
            
            await Promise.all(promises);
            toast.success(`Successfully moved ${totalItems} item(s).`);
            
            // NEW: Refresh tree cache
            await useTreeStore.getState().clearCache();
            await fetchRootTree();
        }
    } catch (error) {
        console.error('Drop error:', error);
        toast.error('Failed to move items.');
    }
  }, [addAssetToBundle, moveBundleToParent, fetchRootTree]);

  const handleDropOnTopLevel = useCallback(async (e: React.DragEvent) => {
    setDraggedOverBundleId(null);
    setDraggedOverAssetId(null);
    setIsDraggedOverTopLevel(false);
    const data = e.dataTransfer.getData('application/json');
    if (!data) return;
    try {
        const parsedData = JSON.parse(data);
        const { type, items } = parsedData;
        
        if (type === 'assets' && Array.isArray(items)) {
            // Handle asset drops (existing logic)
            const draggedAssets = items as AssetRead[];
            
            // NOTE: Removing assets from bundles on drop to top level
            // This functionality requires knowing which bundles contain which assets
            // For now, we'll just refresh the tree - users can manually remove from bundles
            toast.info('Dropped assets on top level. Use the remove from bundle action if needed.');
            
            // Refresh tree
            await useTreeStore.getState().clearCache();
            await fetchRootTree();
        } else if (type === 'mixed' && Array.isArray(items)) {
            // Handle mixed drops (bundles and assets)
            const bundlesToMove = items.filter(item => item.type === 'bundle').map(item => item.item);
            const assetsToMove = items.filter(item => item.type === 'asset').map(item => item.item);
            
            const totalItems = bundlesToMove.length + assetsToMove.length;
            toast.info(`Moving ${totalItems} item(s) to root level...`);
            
            const promises: Promise<any>[] = [];
            
            // Move bundles to root level (parent_bundle_id = null)
            bundlesToMove.forEach(bundle => {
                promises.push(moveBundleToParent(bundle.id, null));
            });
            
            // NOTE: Assets can't be moved to "root" via bundle operations
            // They would need to be removed from bundles individually
            
            await Promise.all(promises);
            toast.success(`Successfully moved ${bundlesToMove.length} folder(s) to root level.`);
            if (assetsToMove.length > 0) {
              toast.info(`${assetsToMove.length} asset(s) require manual removal from bundles.`);
            }
            
            // Refresh tree
            await useTreeStore.getState().clearCache();
            await fetchRootTree();
        }
    } catch (error) {
        console.error('Drop on top level error:', error);
        toast.error('Failed to move items to top level.');
    }
  }, [moveBundleToParent, fetchRootTree]);

  const handleDropOnAsset = useCallback(async (targetItem: AssetTreeItem, e: React.DragEvent) => {
    // Always reset all drag visual state immediately
    setDraggedOverBundleId(null);
    setDraggedOverAssetId(null);
    setIsDraggedOverTopLevel(false);
    // Extract asset ID from node ID (format: "asset-123")
    if (!targetItem.id.startsWith('asset-')) return;
    const targetAssetId = parseInt(targetItem.id.replace('asset-', ''));
    const data = e.dataTransfer.getData('application/json');
    if (!data) return;
    
    try {
        const { type, items: draggedAssets } = JSON.parse(data) as { type: string; items: AssetRead[] };
        if (type !== 'assets' || !Array.isArray(draggedAssets)) return;
        
        // Don't allow dropping on itself
        if (draggedAssets.some(asset => asset.id === targetAssetId)) {
            return;
        }

        // Create a new bundle with the target asset and dragged assets
        const bundleName = `Bundle with ${targetItem.name}`;
        
        toast.info(`Creating bundle "${bundleName}"...`);
        
        // Create the bundle using the store method
        const newBundle = await createBundle({ 
            name: bundleName,
            description: `Bundle created by dragging assets onto ${targetItem.name}`
        });

        if (!newBundle) {
            throw new Error('Failed to create bundle');
        }
        
        // Add all assets to the new bundle
        const addPromises = [targetAssetId, ...draggedAssets.map(a => a.id)].map(assetId => 
            addAssetToBundle(newBundle.id, assetId)
        );
        await Promise.all(addPromises);
        
        toast.success(`Successfully created bundle "${bundleName}".`);
        
        // Refresh tree
        await useTreeStore.getState().clearCache();
        await fetchRootTree();
    } catch (error) {
        console.error('Drop on asset error:', error);
        toast.error('Failed to create bundle.');
    }
  }, [addAssetToBundle, createBundle, fetchRootTree]);

  const getIndentationStyle = (level: number) => ({ paddingLeft: `${level * 1.5}rem` });

  // Helper to get dataset ingestion job info for an asset/bundle
  const getJobInfo = useCallback((item: AssetTreeItem) => {
    // Check if asset has job_id in file_info
    if (item.asset?.file_info) {
      const jobId = (item.asset.file_info as Record<string, unknown>)?.job_id;
      if (jobId && typeof jobId === 'number') {
        return getJob(jobId);
      }
    }
    // Check if bundle is root_bundle_id for any active job
    if (item.bundle) {
      return activeJobs.find(job => job.root_bundle_id === item.bundle?.id);
    }
    return undefined;
  }, [getJob, activeJobs]);

  // Check if an item (or any selected item) belongs to a sealed bundle
  const isItemSealed = useCallback((item: AssetTreeItem): boolean => {
    // Bundle itself is sealed
    if (item.bundle?.sealed) return true;
    // Child of a sealed bundle — look up parent
    if (item.parentId?.startsWith('bundle-')) {
      const findInTree = (items: AssetTreeItem[], id: string): AssetTreeItem | undefined => {
        for (const i of items) {
          if (i.id === id) return i;
          if (i.children) { const found = findInTree(i.children, id); if (found) return found; }
        }
        return undefined;
      };
      const parent = findInTree(filteredTree, item.parentId);
      if (parent?.bundle?.sealed) return true;
    }
    return false;
  }, [filteredTree]);

  // Seal / unseal handlers
  const handleSealBundle = useCallback(async (bundle: BundleRead) => {
    const success = await sealBundle(bundle.id);
    if (success) { await useTreeStore.getState().clearCache(); await fetchRootTree(); }
  }, [sealBundle, fetchRootTree]);

  const handleUnsealBundle = useCallback(async (bundle: BundleRead) => {
    const success = await unsealBundle(bundle.id);
    if (success) { await useTreeStore.getState().clearCache(); await fetchRootTree(); }
  }, [unsealBundle, fetchRootTree]);

  // Context menu handler (item=null for empty-space right-click)
  const handleContextMenu = useCallback((e: React.MouseEvent, item: AssetTreeItem | null) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, item });
  }, []);

  // Close context menu on click anywhere
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close);
    return () => { window.removeEventListener('click', close); window.removeEventListener('contextmenu', close); };
  }, [contextMenu]);

  const renderTreeItem = useCallback((item: AssetTreeItem, itemIndex?: number) => {
    const hasChildren = item.children && item.children.length > 0;
    const canExpand = hasChildren || item.isContainer;
    const isLoading = isLoadingChildren.has(item.id);
    const isFolder = item.type === 'folder';
    const isEditing = editingItem?.id === item.id;
    const isDragOver = draggedOverBundleId === item.id;
    const isDragOverAsset = draggedOverAssetId === item.id;
    const isSealRejected = sealRejectedId === item.id;
    const isFocused = itemIndex !== undefined && itemIndex === focusedIndex;
    
    if (item.type === 'folder' && item.bundle) {
      const bundleId = item.bundle.id;
      const isFullySelected = isBundleFullySelected(bundleId);
      const isPartiallySelected = isBundlePartiallySelected(bundleId);
      const jobInfo = getJobInfo(item);
      const isJobActive = jobInfo && ['pending', 'downloading', 'extracting', 'processing'].includes(jobInfo.status);
      return (
        <div key={item.id}>
          <div
            data-item-index={itemIndex}
            className={cn("group flex items-center mb-0.5 justify-between gap-2 rounded-md hover:bg-muted cursor-pointer transition-colors border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 w-full overflow-hidden", compact ? "py-1 px-2" : "py-2 px-3", (isFullySelected || item.isSelected) && "bg-blue-100 dark:bg-blue-900/80 border-blue-500 !border-y-blue-500/50", isDragOver && !item.bundle?.sealed && "bg-blue-100 dark:bg-blue-900", isDragOver && item.bundle?.sealed && "bg-red-100 dark:bg-red-900/50 border-red-400", isSealRejected && "animate-shake bg-red-100 dark:bg-red-900/50 border-red-400", isFocused && "ring-1 ring-inset ring-primary")}
            style={getIndentationStyle(item.level)}
            onContextMenu={(e) => handleContextMenu(e, item)}
            onClick={(e) => {
              e.stopPropagation();
              // Delay single-click to distinguish from double-click
              if (bundleClickTimeoutRef.current) {
                clearTimeout(bundleClickTimeoutRef.current);
              }
              bundleClickTimeoutRef.current = setTimeout(() => {
                toggleExpanded(item.id);
                bundleClickTimeoutRef.current = null;
              }, 100);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              // Cancel single-click expand and open detail view
              if (bundleClickTimeoutRef.current) {
                clearTimeout(bundleClickTimeoutRef.current);
                bundleClickTimeoutRef.current = null;
              }
              handleItemClick(item);
            }}
            onDragOver={(e) => { 
              e.preventDefault(); 
              e.stopPropagation(); 
              setDraggedOverBundleId(item.id);
              setIsDraggedOverTopLevel(false);
              if (dragOverTimeout) {
                clearTimeout(dragOverTimeout);
                setDragOverTimeout(null);
              }
            }}
            onDragLeave={(e) => { 
              e.preventDefault(); 
              e.stopPropagation(); 
              setDraggedOverBundleId(null); 
            }}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleDropOnBundle(item, e); }}
            draggable
            onDragStart={(e) => {
              e.stopPropagation();
              if (isItemSealed(item)) {
                e.preventDefault();
                toast.error('Cannot move items from a sealed bundle.');
                return;
              }
              // Use simplified drag data with IDs and types
              const bundleId = parseInt(item.id.replace('bundle-', ''));
              
              const itemsToDrag: any[] = [];
              if (selectedItems.has(item.id)) {
                // Handle multiple selected items
                selectedItems.forEach(id => {
                  if (id.startsWith('bundle-')) {
                    itemsToDrag.push({ 
                      type: 'bundle', 
                      item: { id: parseInt(id.replace('bundle-', '')) } 
                    });
                  } else if (id.startsWith('asset-') || id.startsWith('child-')) {
                    itemsToDrag.push({ 
                      type: 'asset', 
                      item: { id: parseInt(id.replace(/^(asset-|child-)/, '')) } 
                    });
                  }
                });
              } else {
                itemsToDrag.push({ type: 'bundle', item: { id: bundleId } });
              }

              if (itemsToDrag.length > 0) {
                e.dataTransfer.setData('application/json', JSON.stringify({ type: 'mixed', items: itemsToDrag }));
              }
            }}
          >
            <div className="ml-1 w-4 h-4 flex items-center justify-center shrink-0">
              {canExpand && <Button variant="ghost" size="sm" className="h-4 w-4 p-0" onClick={(e) => {e.stopPropagation(); toggleExpanded(item.id);}}> {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <motion.div animate={{ rotate: item.isExpanded ? 90 : 0 }} transition={{ type: "spring", stiffness: 400, damping: 30 }}><ChevronRight className="h-3 w-3" /></motion.div>} </Button>}
            </div>
            <Checkbox checked={isFullySelected || isPartiallySelected} onCheckedChange={(checked) => toggleBundleSelection(bundleId, !!checked)} onClick={(e) => e.stopPropagation()} className={cn("h-4 w-4 rounded-sm shrink-0 border-gray-300 border-thin data-[state=checked]:bg-secondary data-[state=checked]:text-secondary-foreground", isPartiallySelected && !isFullySelected && "data-[state=checked]:bg-primary/50")} title={isFullySelected ? "Deselect all" : "Select all"} />
            {renderItemBadge?.(item)}
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="w-4 h-4 flex items-center justify-center shrink-0">
                    <div className="relative">
                      <AnimatePresence mode="wait">
                        {item.isExpanded ? (
                          <motion.div
                            key="open"
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            transition={{ duration: 0.1, ease: "easeOut" }}
                          >
                            <FolderOpen className="h-4 w-4 text-blue-400" />
                          </motion.div>
                        ) : (
                          <motion.div
                            key="closed"
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            transition={{ duration: 0.1, ease: "easeOut" }}
                          >
                            <Folder className="h-4 w-4 text-blue-400" />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>Bundle — data collection. Use to curation data, as recurrent ingestion target or as entrypoint for analysis and flows. Can be sealed to prevent modification.</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {item.bundle?.sealed && 
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Lock className="h-3 w-3 text-blue-500 shrink-0" />
                  </TooltipTrigger>
                  <TooltipContent side="right"><p>Sealed — contents cannot be modified</p></TooltipContent>
                </Tooltip>
              </TooltipProvider>
            }
            <div className="flex-1 min-w-0 overflow-hidden" onClick={(e) => { if (e.detail === 3) { e.stopPropagation(); handleEditItem(item); } }}>
              <div className="flex items-center gap-2 min-w-0 overflow-hidden">
                {isEditing ? (
                  <div className="flex items-center gap-1">
                    <Input value={editingItem.value} onChange={(e) => setEditingItem({ ...editingItem, value: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') handleSaveEditing(); if (e.key === 'Escape') handleCancelEdit(); }} autoFocus className="h-7 text-sm" onClick={(e) => e.stopPropagation()} />
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); handleSaveEditing();}}><Check className="h-4 w-4 text-green-600"/></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); handleCancelEdit();}}><X className="h-4 w-4 text-red-600"/></Button>
                  </div>
                ) : (
                  <>
                    <span className="text-sm font-normal truncate flex-1 max-w-32 sm:max-w-40 md:max-w-64">{item.name}</span>
                    {/* Dataset ingestion progress indicator */}
                    {isJobActive && jobInfo && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {jobInfo.stage_message || (typeof jobInfo.cursor_state?.message === 'string' ? jobInfo.cursor_state.message : '') || `${jobInfo.status}...`}
                        </span>
                        {jobInfo.progress_pct !== undefined && jobInfo.progress_pct > 0 && (
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            ({Math.round(jobInfo.progress_pct)}%)
                          </span>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
            {/* Actions (hover) */}
            <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              {renderItemActions ? renderItemActions(item) : (
                item.type === 'folder' && (
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={(e) => { e.stopPropagation(); handleItemClick(item); }} title="View Details"><Eye className="h-4 w-4" /></Button>
                )
              )}
            </div>
          </div>
          <AnimatePresence initial={false}>
            {item.isExpanded && item.children && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ 
                  height: "auto", 
                  opacity: 1,
                  transition: {
                    height: { type: "spring", stiffness: 400, damping: 35, mass: 0.6 },
                    opacity: { duration: 0.1 }
                  }
                }}
                exit={{ 
                  height: 0, 
                  opacity: 0,
                  transition: {
                    height: { type: "spring", stiffness: 400, damping: 35, mass: 0.6 },
                    opacity: { duration: 0.1 }
                  }
                }}
                className="overflow-hidden overflow-y-auto scrollbar-hide"
              >
                <div className="ml-0  pl-0 space-y-0.5 pb-2 pt-1">
                  <div className="space-y-0.5">
                    {item.children.map(child => {
                      const childIndex = flattenedItemsRef.current.findIndex(fi => fi.id === child.id);
                      return renderTreeItem(child, childIndex >= 0 ? childIndex : undefined);
                    })}
                  </div>
                  {hasMoreChildren.get(item.id) && (
                    <div className="flex justify-center py-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs text-muted-foreground"
                        disabled={isLoadingChildren.has(item.id)}
                        onClick={(e) => {
                          e.stopPropagation();
                          fetchChildren(item.id, childrenCache.get(item.id)?.length ?? 0);
                        }}
                      >
                        {isLoadingChildren.has(item.id) && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                        Load more…
                      </Button>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      );
    }

    // Virtual folder (directory import path abstraction): folder icon, expandable, no bundle
    if (item.type === 'folder' && !item.bundle) {
      const vfolderParams = item.id.startsWith('vfolder-') ? parseVfolderId(item.id) : null;
      return (
        <div key={item.id}>
          <div
            data-item-index={itemIndex}
            className={cn("group flex items-center mb-0.5 justify-between gap-2 rounded-md hover:bg-muted cursor-pointer transition-colors border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/30 w-full overflow-hidden", compact ? "py-1 px-2" : "py-2 px-3", item.isSelected && "bg-blue-50 dark:bg-blue-900/50", isFocused && "ring-1 ring-inset ring-primary")}
            style={getIndentationStyle(item.level)}
            onClick={(e) => {
              e.stopPropagation();
              if (bundleClickTimeoutRef.current) {
                clearTimeout(bundleClickTimeoutRef.current);
              }
              bundleClickTimeoutRef.current = setTimeout(() => {
                toggleExpanded(item.id);
                bundleClickTimeoutRef.current = null;
              }, 100);
            }}
          >
            <div className="ml-1 w-4 h-4 flex items-center justify-center shrink-0">
              {canExpand && (
                <Button variant="ghost" size="sm" className="h-4 w-4 p-0" onClick={(e) => { e.stopPropagation(); toggleExpanded(item.id); }}>
                  {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <motion.div animate={{ rotate: item.isExpanded ? 90 : 0 }} transition={{ type: "spring", stiffness: 400, damping: 30 }}><ChevronRight className="h-3 w-3" /></motion.div>}
                </Button>
              )}
            </div>
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="w-4 h-4 flex items-center justify-center shrink-0">
                    <Folder className="h-4 w-4 text-amber-600 dark:text-amber-500" />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>Virtual folder — computed from path, browsable only. Materialize to create a real bundle.</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <div className="flex-1 min-w-0 overflow-hidden">
              <span className="text-sm font-normal truncate text-muted-foreground flex-1">{item.name}</span>
            </div>
            <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              {renderItemActions ? renderItemActions(item) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={(e) => { e.stopPropagation(); onItemView?.(item); }}
                  title="View contents"
                >
                  <Eye className="h-4 w-4" />
                </Button>
              )}
              {vfolderParams && onMaterializeVfolder && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    onMaterializeVfolder({ bundleId: vfolderParams.bundleId, pathPrefix: vfolderParams.pathPrefix, name: item.name });
                  }}
                  title="Materialize as bundle"
                >
                  <FolderInput className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
          <AnimatePresence initial={false}>
            {item.isExpanded && item.children && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1, transition: { height: { type: "spring", stiffness: 400, damping: 35, mass: 0.6 }, opacity: { duration: 0.1 } } }}
                exit={{ height: 0, opacity: 0, transition: { height: { type: "spring", stiffness: 400, damping: 35, mass: 0.6 }, opacity: { duration: 0.1 } } }}
                className="overflow-hidden overflow-y-auto scrollbar-hide"
              >
                <div className="ml-0 pl-0 space-y-0.5 pb-2 pt-1">
                  <div className="space-y-0.5">
                    {item.children.map(child => {
                      const childIndex = flattenedItemsRef.current.findIndex(fi => fi.id === child.id);
                      return renderTreeItem(child, childIndex >= 0 ? childIndex : undefined);
                    })}
                  </div>
                  {hasMoreChildren.get(item.id) && (
                    <div className="flex justify-center py-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs text-muted-foreground"
                        disabled={isLoadingChildren.has(item.id)}
                        onClick={(e) => {
                          e.stopPropagation();
                          fetchChildren(item.id, childrenCache.get(item.id)?.length ?? 0);
                        }}
                      >
                        {isLoadingChildren.has(item.id) && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                        Load more…
                      </Button>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      );
    }

    // Check for dataset ingestion job
    const jobInfo = getJobInfo(item);
    const isJobActive = jobInfo && ['pending', 'downloading', 'extracting', 'processing'].includes(jobInfo.status);
    
    return (
      <div key={item.id}>
        <div
          data-item-index={itemIndex}
          className={cn("group flex items-center justify-between gap-2 hover:bg-muted/50 cursor-pointer transition-colors rounded-md w-full overflow-hidden", compact ? "py-1 px-2" : "py-1.5 px-3", item.isSelected && "bg-blue-50 dark:bg-blue-900/50 rounded-none border-blue-500", isDragOverAsset && "bg-green-100 dark:bg-green-900", isFocused && "ring-1 ring-inset ring-primary", isJobActive && "bg-blue-50/50 dark:bg-blue-900/30")}
          style={getIndentationStyle(item.level)}
          onContextMenu={(e) => handleContextMenu(e, item)}
          onClick={() => handleItemClick(item)}
          onDoubleClick={() => handleItemDoubleClickInternal(item)}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDraggedOverAssetId(item.id);
            setIsDraggedOverTopLevel(false);
            if (dragOverTimeout) {
              clearTimeout(dragOverTimeout);
              setDragOverTimeout(null);
            }
          }}
          onDragLeave={(e) => { 
            e.preventDefault(); 
            e.stopPropagation(); 
            setDraggedOverAssetId(null); 
          }}
          onDrop={(e) => { 
            e.preventDefault(); 
            e.stopPropagation(); 
            handleDropOnAsset(item, e); 
          }}
          draggable onDragStart={(e) => {
            e.stopPropagation();
            if (isItemSealed(item)) {
              e.preventDefault();
              toast.error('Cannot move items from a sealed bundle.');
              return;
            }
            // Use simplified drag data with IDs
            const assetId = parseInt(item.id.replace(/^(asset-|child-)/, ''));
            
            const itemsToDrag: any[] = [];
            if (selectedItems.has(item.id)) {
              selectedItems.forEach(id => {
                if (id.startsWith('asset-') || id.startsWith('child-')) {
                  itemsToDrag.push({ id: parseInt(id.replace(/^(asset-|child-)/, '')) });
                }
              });
            } else {
              itemsToDrag.push({ id: assetId });
            }

            if (itemsToDrag.length > 0) {
              // Check if we have mixed selection (assets + bundles)
              const hasSelectedBundles = Array.from(selectedItems).some(id => id.startsWith('bundle-'));
              if (hasSelectedBundles && selectedItems.has(item.id)) {
                // Use mixed format when bundles are also selected
                const mixedItems: any[] = [];
                selectedItems.forEach(id => {
                  if (id.startsWith('bundle-')) {
                    mixedItems.push({ type: 'bundle', item: { id: parseInt(id.replace('bundle-', '')) } });
                  } else if (id.startsWith('asset-') || id.startsWith('child-')) {
                    mixedItems.push({ type: 'asset', item: { id: parseInt(id.replace(/^(asset-|child-)/, '')) } });
                  }
                });
                e.dataTransfer.setData('application/json', JSON.stringify({ type: 'mixed', items: mixedItems }));
              } else {
                // Use legacy format for assets only
                e.dataTransfer.setData('application/json', JSON.stringify({ type: 'assets', items: itemsToDrag }));
              }
            }
          }}
        >
          {/* Left fixed section: expand, checkbox, icon */}
          <div className="ml-1 w-4 h-4 flex items-center justify-center shrink-0">
            {canExpand && (
              <Button variant="ghost" size="sm" className="h-4 w-4 p-0" onClick={(e) => { e.stopPropagation(); toggleExpanded(item.id); }}>
                {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <motion.div animate={{ rotate: item.isExpanded ? 90 : 0 }} transition={{ type: "spring", stiffness: 300, damping: 25 }}><ChevronRight className="h-3 w-3" /></motion.div>}
              </Button>
            )}
          </div>
          <Checkbox checked={item.isSelected} onCheckedChange={() => toggleSelected(item.id, true)} onClick={(e) => e.stopPropagation()} className="h-4 w-4 rounded-sm shrink-0 border-secondart data-[state=checked]:bg-secondart data-[state=checked]:text-secondart-foreground" />
          {renderItemBadge?.(item)}
          {/* Relevance score badge - between checkbox and icon (works for both semantic and text search) */}
          {item.asset && searchScoreMap.has(item.asset.id) && (
            <RelevanceBadge 
              score={searchScoreMap.get(item.asset.id)!} 
              size="sm"
              className="shrink-0"
            />
          )}
          {item.asset?.kind && (
            <div className="w-4 h-4 flex items-center justify-center shrink-0">
              {getAssetIcon(item.asset.kind, 'h-4 w-4')}
            </div>
          )}

          {/* Middle flexible section: name + metadata */}
          <div className="flex-1 overflow-hidden" onClick={(e) => { if (e.detail === 3) { e.stopPropagation(); handleEditItem(item); } }}>
            {isEditing ? (
              <div className="flex items-center gap-0.5">
                <Input value={editingItem.value} onChange={(e) => setEditingItem({ ...editingItem, value: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') handleSaveEditing(); if (e.key === 'Escape') handleCancelEdit(); }} autoFocus className="h-7 text-sm" onClick={(e) => e.stopPropagation()} />
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); handleSaveEditing();}}><Check className="h-4 w-4 text-green-600"/></Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); handleCancelEdit();}}><X className="h-4 w-4 text-red-600"/></Button>
              </div>
            ) : (
              <div className="flex items-center gap-2 overflow-hidden">
                <span className="text-sm font-normal truncate flex-1 max-w-32 sm:max-w-40 md:max-w-64 lg:max-w-96">{item.name}</span>
                {/* Dataset ingestion progress indicator */}
                {isJobActive && jobInfo && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {jobInfo.stage_message || (typeof jobInfo.cursor_state?.message === 'string' ? jobInfo.cursor_state.message : '') || `${jobInfo.status}...`}
                    </span>
                    {jobInfo.progress_pct !== undefined && jobInfo.progress_pct > 0 && (
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        ({Math.round(jobInfo.progress_pct)}%)
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right fixed section: date + actions - always at end */}
          <div className="flex items-center gap-2 shrink-0">
            {item.asset && !isEditing && (() => {
              const raw = item.asset.updated_at;
              if (!raw) return null;
              const d = new Date(raw);
              if (!Number.isFinite(d.getTime())) return null;
              return (
                <span className="text-xs text-muted-foreground whitespace-nowrap hidden sm:block">
                  {formatDistanceToNowStrict(d, { addSuffix: true })}
                </span>
              );
            })()}
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {renderItemActions ? renderItemActions(item) : (
                item.type === 'folder' && (
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={(e) => { e.stopPropagation(); handleItemClick(item); }} title="View Details"><Eye className="h-4 w-4" /></Button>
                )
              )}
            </div>
          </div>
        </div>
        <AnimatePresence initial={false}>
          {item.isExpanded && item.children && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ 
                height: "auto", 
                opacity: 1,
                transition: {
                  height: { type: "spring", stiffness: 400, damping: 35, mass: 0.6 },
                  opacity: { duration: 0.1 }
                }
              }}
              exit={{ 
                height: 0, 
                opacity: 0,
                transition: {
                  height: { type: "spring", stiffness: 400, damping: 35, mass: 0.6 },
                  opacity: { duration: 0.1 }
                }
              }}
              className="overflow-hidden overflow-y-auto scrollbar-hide"
            >
              <div className="ml-0 border-l-2 border-slate-200 dark:border-slate-700 pl-2 space-y-1 pb-2 pt-1">
                <div className="space-y-1">
                  {item.children.map(child => {
                    const childIndex = flattenedItemsRef.current.findIndex(fi => fi.id === child.id);
                    return renderTreeItem(child, childIndex >= 0 ? childIndex : undefined);
                  })}
                </div>
                {hasMoreChildren.get(item.id) && (
                  <div className="flex justify-center py-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs text-muted-foreground"
                      disabled={isLoadingChildren.has(item.id)}
                      onClick={(e) => {
                        e.stopPropagation();
                        fetchChildren(item.id, childrenCache.get(item.id)?.length ?? 0);
                      }}
                    >
                      {isLoadingChildren.has(item.id) && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                      Load more…
                    </Button>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }, [toggleSelected, toggleExpanded, handleItemClick, handleItemDoubleClickInternal, handleEditItem, handleSaveEditing, handleCancelEdit, isLoadingChildren, toggleBundleSelection, isBundleFullySelected, isBundlePartiallySelected, editingItem, draggedOverBundleId, draggedOverAssetId, handleDropOnBundle, handleDropOnAsset, renderItemActions, focusedIndex, getJobInfo, activeJobs, isItemSealed, sealRejectedId, hasMoreChildren, childrenCache, fetchChildren]);

  // Get flat list of visible items for keyboard navigation (respecting hierarchy/expansion)
  const flattenedItems = useMemo(() => {
    const flatten = (items: AssetTreeItem[]): AssetTreeItem[] => {
      const result: AssetTreeItem[] = [];
      items.forEach(item => {
        result.push(item);
        // Check if item is expanded and has children (handles both folders and asset containers)
        if (item.isExpanded && item.children && item.children.length > 0) {
          result.push(...flatten(item.children));
        }
      });
      return result;
    };
    const flattened = flatten(filteredTree);
    flattenedItemsRef.current = flattened;
    return flattened;
  }, [filteredTree, expandedItems]);

  // Keyboard navigation handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if search input or container has focus
      const activeElement = document.activeElement;
      const isSearchFocused = activeElement === searchInputRef.current;
      const isContainerFocused = containerRef.current?.contains(activeElement);
      
      if (!isSearchFocused && !isContainerFocused) return;
      if (flattenedItems.length === 0) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setFocusedIndex(prev => {
            const newIndex = prev + 1;
            return newIndex >= flattenedItems.length ? 0 : newIndex;
          });
          break;
        
        case 'ArrowUp':
          e.preventDefault();
          setFocusedIndex(prev => {
            const newIndex = prev - 1;
            return newIndex < 0 ? flattenedItems.length - 1 : newIndex;
          });
          break;
        
        case 'ArrowRight':
          e.preventDefault();
          if (focusedIndex >= 0 && focusedIndex < flattenedItems.length) {
            const item = flattenedItems[focusedIndex];
            // Expand folders or asset containers
            if ((item.type === 'folder' || item.isContainer) && !expandedItems.has(item.id)) {
              // Use toggleExpanded which properly handles async child loading
              toggleExpanded(item.id);
            }
          }
          break;
        
        case 'ArrowLeft':
          e.preventDefault();
          if (focusedIndex >= 0 && focusedIndex < flattenedItems.length) {
            const item = flattenedItems[focusedIndex];
            // Collapse folders or asset containers
            if ((item.type === 'folder' || item.isContainer) && expandedItems.has(item.id)) {
              // Use toggleExpanded for consistency
              toggleExpanded(item.id);
            }
          }
          break;
        
        case 'Enter':
          e.preventDefault();
          if (focusedIndex >= 0 && focusedIndex < flattenedItems.length) {
            const item = flattenedItems[focusedIndex];
            handleItemDoubleClickInternal(item);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusedIndex, flattenedItems, expandedItems, toggleExpanded, handleItemDoubleClickInternal]);

  // Scroll focused item into view (manually control scroll to prevent scrolling parent containers)
  useEffect(() => {
    if (focusedIndex >= 0 && containerRef.current && scrollContainerRef.current) {
      // Find the element with the matching data-item-index attribute
      const focusedElement = containerRef.current.querySelector(`[data-item-index="${focusedIndex}"]`) as HTMLElement;
      
      if (focusedElement) {
        // Get the ScrollArea's viewport element (Radix UI wraps content in a viewport div)
        const scrollViewport = scrollContainerRef.current.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement;
        
        if (scrollViewport) {
          // Calculate positions relative to the scroll container
          const elementRect = focusedElement.getBoundingClientRect();
          const containerRect = scrollViewport.getBoundingClientRect();
          
          // Calculate how far the element is from the visible area
          const elementTop = elementRect.top - containerRect.top + scrollViewport.scrollTop;
          const elementBottom = elementTop + elementRect.height;
          const visibleTop = scrollViewport.scrollTop;
          const visibleBottom = visibleTop + scrollViewport.clientHeight;
          
          // Scroll only if element is not fully visible
          if (elementTop < visibleTop) {
            // Element is above visible area - scroll up
            scrollViewport.scrollTo({ top: elementTop - 10, behavior: 'smooth' });
          } else if (elementBottom > visibleBottom) {
            // Element is below visible area - scroll down
            scrollViewport.scrollTo({ top: elementBottom - scrollViewport.clientHeight + 10, behavior: 'smooth' });
          }
        }
      }
    }
  }, [focusedIndex]);

  return (
    <>
    <div
      className={cn("h-full w-full flex flex-col overflow-hidden min-w-0 bg-background", compact && "gap-0")}
    >
        {/* Compact search bar - minimal design for inline usage */}
        {compact && (
          <div className="flex-none p-2 border-b bg-background">
            <div className="flex items-center gap-2">
              <InputGroup className="flex-grow">
                <InputGroupAddon>
                  {isSearching ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Search className="h-3.5 w-3.5" />
                  )}
                </InputGroupAddon>
                <InputGroupInput 
                  ref={searchInputRef}
                  placeholder={useSemanticMode && isSemanticAvailable ? "Semantic search..." : "Text search..."} 
                  className="text-sm h-8" 
                  value={searchTerm} 
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onKeyDown={(e) => {
                    // Handle navigation keys - let window handler take over once navigation starts
                    if (e.key === 'ArrowDown' && focusedIndex === -1 && flattenedItemsRef.current.length > 0) {
                      // First arrow down - move focus to first item
                      e.preventDefault();
                      setFocusedIndex(0);
                    } else if (e.key === 'ArrowUp' && focusedIndex === -1) {
                      // First arrow up - move focus to last item
                      e.preventDefault();
                      if (flattenedItemsRef.current.length > 0) {
                        setFocusedIndex(flattenedItemsRef.current.length - 1);
                      }
                    }
                    // For all other cases (including when focusedIndex >= 0), let the window handler manage it
                  }}
                />
              </InputGroup>
              {/* Semantic search toggle - compact mode */}
              {isSemanticAvailable && (
                <div className="flex items-center gap-1.5">
                  <Switch
                    id="semantic-toggle-compact"
                    checked={useSemanticMode}
                    onCheckedChange={setUseSemanticMode}
                    disabled={isSearching}
                    className="scale-75"
                  />
                  <Label 
                    htmlFor="semantic-toggle-compact" 
                    className="text-[10px] text-muted-foreground cursor-pointer whitespace-nowrap"
                  >
                    {useSemanticMode ? 'S' : 'T'}
                  </Label>
                </div>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 shrink-0"
                onClick={handleRefresh}
                disabled={isRefreshing}
                title="Refresh"
              >
                <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
              </Button>
            </div>
          </div>
        )}
      
        {/* Search and Filter - Full version for non-compact mode */}
        {!compact && (
          <div className="flex-none p-2 py-0 border-b min-w-0 overflow-hidden">
            <div className="flex items-center gap-1 sm:gap-2 min-w-0 pl-1 sm:pl-2 py-2 sm:py-3">
              <Checkbox 
                id="select-all" 
                checked={isAllSelected} 
                onCheckedChange={(checked) => handleSelectAll(Boolean(checked))} 
                disabled={allVisibleItemIds.size === 0} 
                aria-label="Select all visible items" 
                className="rounded-sm shrink-0"
              />
              <InputGroup className="flex-grow h-8 ml-1 sm:ml-2">
                <InputGroupAddon>
                  {isSearching ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Search className="h-3 w-3" />
                  )}
                </InputGroupAddon>
                <InputGroupInput
                  ref={searchInputRef}
                  placeholder={useSemanticMode && isSemanticAvailable ? "Semantic search..." : "Search..."}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </InputGroup>
              {/* Semantic search toggle - only show if available */}
              {isSemanticAvailable && (
                <div className="flex items-center gap-1 sm:gap-2 px-0.5 sm:px-2">
                  <Switch
                    id="semantic-toggle"
                    checked={useSemanticMode}
                    onCheckedChange={setUseSemanticMode}
                    disabled={isSearching}
                    className="scale-90 sm:scale-100"
                  />
                  <Label 
                    htmlFor="semantic-toggle" 
                    className="text-xs text-muted-foreground cursor-pointer whitespace-nowrap hidden sm:block"
                  >
                    {useSemanticMode ? 'Semantic' : 'Text'}
                  </Label>
                </div>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 sm:h-8 sm:w-8 p-0 shrink-0"
                onClick={handleRefresh}
                disabled={isRefreshing}
                title="Refresh"
              >
                <RefreshCw className={cn("h-3.5 w-3.5 sm:h-4 sm:w-4", isRefreshing && "animate-spin")} />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 w-7 sm:h-8 sm:w-auto p-0 sm:px-2 sm:gap-2 shrink-0">
                    <ArrowDown01 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                    <span className="hidden sm:inline">Filters</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64 p-2">
                  <div className="mb-3">
                    <DropdownMenuLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 pb-2">
                      Type Filter
                    </DropdownMenuLabel>
                    <div className="bg-muted/30 rounded-md p-1">
                      <DropdownMenuRadioGroup value={assetTypeFilter} onValueChange={(value) => setAssetTypeFilter(value as AssetKind | 'all')}>
                        <DropdownMenuRadioItem value="all" className="rounded-sm">
                          All Types
                        </DropdownMenuRadioItem>
                        {assetKinds.map(kind => (
                          <DropdownMenuRadioItem key={kind} value={kind} className="rounded-sm">
                            {kind.charAt(0).toUpperCase() + kind.slice(1).replace('_', ' ')}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </div>
                  </div>
                  
                  <DropdownMenuSeparator className="my-2" />
                  
                  <div>
                    <DropdownMenuLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 pb-2">
                      Sort By
                    </DropdownMenuLabel>
                    <div className="bg-muted/30 rounded-md p-1">
                      <DropdownMenuRadioGroup value={sortOption} onValueChange={setSortOption}>
                        <DropdownMenuRadioItem value="kind-updated_at-desc" className="rounded-sm">
                          <span className="flex items-center gap-2">
                            <span className="text-muted-foreground">📁</span>
                            Type, then Date
                          </span>
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="updated_at-desc" className="rounded-sm">
                          <span className="flex items-center gap-2">
                            <span className="text-muted-foreground">↓</span>
                            Recently Edited
                          </span>
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="updated_at-asc" className="rounded-sm">
                          <span className="flex items-center gap-2">
                            <span className="text-muted-foreground">↑</span>
                            Oldest First
                          </span>
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="name-asc" className="rounded-sm">
                          <span className="flex items-center gap-2">
                            <span className="text-muted-foreground">A→Z</span>
                            Name Ascending
                          </span>
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="name-desc" className="rounded-sm">
                          <span className="flex items-center gap-2">
                            <span className="text-muted-foreground">Z→A</span>
                            Name Descending
                          </span>
                        </DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </div>
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        )}

        {/* Asset Tree */}
        <div 
          className={cn("flex-1 min-h-0 overflow-hidden relative min-w-0 max-w-full", isDraggedOverTopLevel && !draggedOverBundleId && !draggedOverAssetId && "bg-blue-50 dark:bg-blue-900/50")}
          onDragOver={(e) => { 
            e.preventDefault(); 
            // Clear any existing timeout
            if (dragOverTimeout) {
              clearTimeout(dragOverTimeout);
            }
            
            // Set a timeout to show top-level drop zone only if we're not over a specific item
            const timeout = setTimeout(() => {
              if (!draggedOverBundleId && !draggedOverAssetId) {
                setIsDraggedOverTopLevel(true);
              }
            }, 100); // Small delay to allow child elements to set their drag states first
            
            setDragOverTimeout(timeout);
          }}
          onDragLeave={(e) => {
            // Clear timeout
            if (dragOverTimeout) {
              clearTimeout(dragOverTimeout);
              setDragOverTimeout(null);
            }

            // Reset when leaving the container (relatedTarget null = left the window)
            if (!e.relatedTarget || !e.currentTarget.contains(e.relatedTarget as Node)) {
              setIsDraggedOverTopLevel(false);
              setDraggedOverBundleId(null);
              setDraggedOverAssetId(null);
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            // Clear timeout
            if (dragOverTimeout) {
              clearTimeout(dragOverTimeout);
              setDragOverTimeout(null);
            }

            // Always reset top-level state on any drop
            setIsDraggedOverTopLevel(false);

            // Only handle top level drop if we're not over a specific item
            if (!draggedOverBundleId && !draggedOverAssetId) {
              handleDropOnTopLevel(e);
            }
          }}
        >
          <ScrollArea 
            className="h-full w-full min-w-0 max-w-full" 
            ref={scrollContainerRef}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onWheel={handleWheel}
          >
            {isDraggedOverTopLevel && !draggedOverBundleId && !draggedOverAssetId && (
              <div className="absolute inset-0 flex items-center justify-center bg-blue-50/90 dark:bg-blue-900/90 z-50 pointer-events-none">
                <div className="text-blue-600 dark:text-blue-300 text-lg font-medium flex items-center gap-2">
                  <Upload className="h-6 w-6" />
                  Drop here to move assets to top level
                </div>
              </div>
            )}
            <div
              className="w-full overflow-hidden min-h-full"
              onContextMenu={(e) => handleContextMenu(e, null)}
              style={{
                transform: `translateY(${pullOffset}px)`,
                transition: isDragging.current ? 'none' : 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                willChange: isDragging.current ? 'transform' : 'auto'
              }}
            >
              {/* Pull-to-refresh indicator */}
              {pullOffset > 0 && (
                <div className="flex items-center justify-center py-2 text-muted-foreground">
                  <div className="flex items-center gap-2">
                    {isRefreshing ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        <span className="text-xs">Refreshing...</span>
                      </>
                    ) : pullOffset >= 60 ? (
                      <>
                        <RefreshCw className="h-4 w-4" />
                        <span className="text-xs">Release to refresh</span>
                      </>
                    ) : (
                      <>
                        <RefreshCw className="h-4 w-4" style={{ transform: `rotate(${Math.min(pullOffset * 2, 180)}deg)` }} />
                        <span className="text-xs">Pull to refresh</span>
                      </>
                    )}
                  </div>
                </div>
              )}
            {isLoadingRoot && rootNodes.length === 0 && previousRootNodesRef.current.length === 0 ? (
              <div className="flex items-center justify-center h-32">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <span className="ml-2 text-muted-foreground">Loading...</span>
              </div>
            ) : isSearchActive ? (
              /* ── Tiered search results ── */
              (() => {
                const hasNameMatches = searchNameBundleItems.length > 0 || searchNameAssetItems.length > 0;
                const hasContentResults = searchContentItems.length > 0;
                const hasChildResults = queryChildResults.length > 0;
                const hasAnyResults = hasNameMatches || hasContentResults || hasChildResults;

                if (isSearching && !hasAnyResults) {
                  return (
                    <div className="flex items-center justify-center h-32">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      <span className="ml-2 text-muted-foreground">Searching...</span>
                    </div>
                  );
                }

                if (!hasAnyResults) {
                  return (
                    <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                      <FolderOpen className="h-8 w-8 mb-2 opacity-50" />
                      <h3 className="text-lg font-medium mb-2">No results</h3>
                      <p className="text-sm text-center">
                        No items match &quot;{debouncedSearchTerm}&quot;
                      </p>
                    </div>
                  );
                }

                return (
                  <div ref={containerRef} className="px-2 md:px-0 mt-2 w-full overflow-hidden">
                    {/* Tier 1: Name matches (bundles + title hits) */}
                    {hasNameMatches && (
                      <div className="mb-1">
                        <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                          Name matches
                        </div>
                        <div className="space-y-0.5">
                          {searchNameBundleItems.map(item => renderTreeItem(item))}
                          {searchNameAssetItems.map(item => renderTreeItem(item))}
                        </div>
                      </div>
                    )}

                    {/* Tier 2: Content matches (FTS/semantic, top-level only) */}
                    {hasContentResults && (
                      <div className="mb-1">
                        {hasNameMatches && (
                          <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                            Content matches
                          </div>
                        )}
                        <div className="space-y-0.5">
                          {searchContentItems.map(item => renderTreeItem(item))}
                        </div>
                      </div>
                    )}

                    {/* Tier 3: Child/page matches (collapsed groups) */}
                    {hasChildResults && (
                      <div className="mb-1">
                        <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                          Page matches
                        </div>
                        <div className="space-y-0.5">
                          {queryChildResults.map(group => {
                            const isExpanded = expandedItems.has(`child-group-${group.parent_asset_id}`);
                            return (
                              <div key={`child-group-${group.parent_asset_id}`}>
                                <button
                                  className="flex items-center gap-1.5 w-full px-2 py-1 text-xs text-muted-foreground hover:bg-accent/50 rounded-sm"
                                  onClick={() => {
                                    const key = `child-group-${group.parent_asset_id}`;
                                    const next = new Set(expandedItems);
                                    if (next.has(key)) next.delete(key); else next.add(key);
                                    setExpandedItems(next);
                                  }}
                                >
                                  {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                  <Layers className="h-3 w-3" />
                                  <span className="truncate">{group.parent_title}</span>
                                  <Badge variant="secondary" className="ml-auto text-[9px] px-1 py-0">
                                    {group.matches.length} page{group.matches.length !== 1 ? 's' : ''}
                                  </Badge>
                                </button>
                                {isExpanded && group.matches.map(m => {
                                  const treeNode = assetReadToAssetNode(m.asset);
                                  const treeItem = convertAssetNodeToTreeItem(treeNode, 1);
                                  return renderTreeItem({ ...treeItem, asset: m.asset });
                                })}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()
            ) : filteredTree.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                <FolderOpen className="h-8 w-8 mb-2 opacity-50" />
                <h3 className="text-lg font-medium mb-2">No items found</h3>
                <p className="text-sm text-center">No items available.</p>
              </div>
            ) : (
              <div ref={containerRef} className="px-2 md:px-0 mt-2 space-y-0.5 w-full overflow-hidden">
                {filteredTree.map(item => {
                  const itemIndex = flattenedItemsRef.current.findIndex(fi => fi.id === item.id);
                  return renderTreeItem(item, itemIndex >= 0 ? itemIndex : undefined);
                })}
              </div>
            )}
            </div>
          </ScrollArea >
        </div>
      </div>

      {/* Right-click context menu — portaled to body so fixed + clientX/Y match the cursor
          (ancestors with transform/filter e.g. resizable panels, backdrop-blur break fixed positioning). */}
      {contextMenu &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed z-50 min-w-[180px] rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onClick={() => setContextMenu(null)}
          >
            {renderContextMenu ? renderContextMenu(contextMenu.item) : contextMenu.item && (
              <>
                <button
                  className="relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
                  onClick={() => handleItemClick(contextMenu.item!)}
                >
                  <Eye className="mr-2 h-4 w-4" /> View Details
                </button>
                <button
                  className="relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
                  onClick={() => handleEditItem(contextMenu.item!)}
                >
                  <Edit3 className="mr-2 h-4 w-4" /> Rename
                </button>
              </>
            )}
          </div>,
          document.body,
        )}
    </>
  );
} 