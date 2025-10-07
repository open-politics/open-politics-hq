'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { 
  Search, 
  Upload, 
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
  Settings,
  LayoutGrid,
  List,
  ChevronLeft,
  FileIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import {
  AssetRead,
  AssetKind,
  BundleRead,
  BundlesService,
} from '@/client';
import { useAssetStore } from '@/zustand_stores/storeAssets';
import { useBundleStore } from '@/zustand_stores/storeBundles';
import { useTreeStore } from '@/zustand_stores/storeTree';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { useDebounce } from '@/hooks/useDebounce';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import AssetCardComponent from './Views/AssetCardComponent';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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

// Helper Functions (can be moved to a utils file later)
export const getAssetIcon = (kind: AssetKind, className?: string) => {
    const iconClass = cn("h-4 w-4", className);
    switch (kind) {
      case 'pdf': return <FileText className={cn(iconClass, "text-red-600")} />;
      case 'csv': return <FileSpreadsheet className={cn(iconClass, "text-green-600")} />;
      case 'article': return <FileText className={cn(iconClass, "text-blue-600")} />;
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
  
export const formatAssetKind = (kind: AssetKind): string => {
      if (kind === 'csv_row') return 'Row';
      if (kind === 'pdf') return 'PDF';
      if (kind === 'csv') return 'CSV';
      if (kind === 'mbox') return 'Email';
      return kind
          .replace(/_/g, ' ')
          .split(' ')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');
  }
  
export const getAssetBadgeClass = (kind: AssetKind): string => {
    switch (kind) {
      case 'pdf': return "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/50 dark:text-red-300 dark:border-red-800";
      case 'csv': return "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/50 dark:text-green-300 dark:border-green-800";
      case 'csv_row': return "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/50 dark:text-emerald-300 dark:border-emerald-800";
      case 'image': return "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/50 dark:text-purple-300 dark:border-purple-800";
      case 'video': return "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/50 dark:text-orange-300 dark:border-orange-800";
      case 'audio': return "bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-900/50 dark:text-teal-300 dark:border-teal-800";
      case 'mbox':
      case 'email': return "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/50 dark:text-blue-300 dark:border-blue-800";
      case 'web': return "bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-900/50 dark:text-sky-300 dark:border-sky-800";
      case 'text':
      case 'text_chunk': return "bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-900/50 dark:text-indigo-300 dark:border-indigo-800";
      default: return "bg-slate-100 text-slate-800 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700";
    }
  };

interface AssetSelectorProps {
    selectedItems: Set<string>;
    onSelectionChange: (selectedIds: Set<string>) => void;
    // Props to control available actions, e.g. hide 'delete' button
    // For now, we'll keep it simple and just manage selection
    onItemView?: (item: AssetTreeItem) => void;
    onItemDoubleClick?: (item: AssetTreeItem) => void;
    // Prop to allow parent component to provide actions for the dropdown menu
    renderItemActions?: (item: AssetTreeItem) => React.ReactNode;
}

export default function AssetSelector({
    selectedItems,
    onSelectionChange,
    onItemView,
    onItemDoubleClick,
    renderItemActions,
}: AssetSelectorProps) {
  const { activeInfospace } = useInfospaceStore();
  
  // NEW: Use tree store for efficient loading
  const {
    rootNodes,
    childrenCache,
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
  } = useBundleStore();

  // UI State
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearchTerm = useDebounce(searchTerm, 300);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [assetTypeFilter, setAssetTypeFilter] = useState<AssetKind | 'all'>('all');
  const [sortOption, setSortOption] = useState('updated_at-desc');
  
  // Inline editing state
  const [editingItem, setEditingItem] = useState<{ id: string; value: string } | null>(null);
  
  // Data fetching state - NOW REMOVED! Using tree store instead
  // const [bundleAssets, setBundleAssets] = useState<Map<number, AssetRead[]>>(new Map());
  // const [childAssets, setChildAssets] = useState<Map<number, AssetRead[]>>(new Map());
  // const [isLoadingChildren, setIsLoadingChildren] = useState<Set<number>>(new Set());

  // Drag and drop state
  const [draggedOverBundleId, setDraggedOverBundleId] = useState<string | null>(null);
  const [isDraggedOverTopLevel, setIsDraggedOverTopLevel] = useState(false);
  const [draggedOverAssetId, setDraggedOverAssetId] = useState<string | null>(null);
  const [dragOverTimeout, setDragOverTimeout] = useState<NodeJS.Timeout | null>(null);

  // View mode state
  const [viewMode, setViewMode] = useState<'list' | 'card'>('list');
  const [cardViewFolder, setCardViewFolder] = useState<AssetTreeItem | null>(null);

  // Pull-to-refresh state
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef<number>(0);
  const isPullingRef = useRef(false);
  const wheelTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastWheelTimeRef = useRef<number>(0);

  const fetchingRef = useRef(false);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (dragOverTimeout) {
        clearTimeout(dragOverTimeout);
      }
      if (wheelTimeoutRef.current) {
        clearTimeout(wheelTimeoutRef.current);
      }
    };
  }, [dragOverTimeout]);

  // Pull-to-refresh handlers
  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    
    setIsRefreshing(true);
    const startTime = Date.now();
    
    try {
      const { clearCache, fetchRootTree } = useTreeStore.getState();
      await clearCache();
      await fetchRootTree();
      
      // Ensure minimum duration of 600ms for smooth UX (prevents flickering)
      const elapsed = Date.now() - startTime;
      const minDuration = 600;
      if (elapsed < minDuration) {
        await new Promise(resolve => setTimeout(resolve, minDuration - elapsed));
      }
      
      toast.success('Refreshed');
    } catch (error) {
      toast.error('Failed to refresh');
    } finally {
      // Smooth fade out
      setTimeout(() => {
        setIsRefreshing(false);
        // Delay reset for smooth transition
        setTimeout(() => {
          setPullDistance(0);
        }, 200);
      }, 100);
    }
  }, [isRefreshing]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer || isRefreshing) return;
    
    const scrollTop = scrollContainer.scrollTop;
    if (scrollTop === 0) {
      startYRef.current = e.touches[0].clientY;
      isPullingRef.current = true;
    }
  }, [isRefreshing]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isPullingRef.current || isRefreshing) return;
    
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer || scrollContainer.scrollTop > 0) {
      isPullingRef.current = false;
      setPullDistance(0);
      return;
    }

    const currentY = e.touches[0].clientY;
    const distance = Math.max(0, currentY - startYRef.current);
    
    // Elastic resistance curve for natural feel
    const resistance = 0.5;
    const maxPull = 100;
    const elasticDistance = maxPull * (1 - Math.exp(-distance * resistance / maxPull));
    
    setPullDistance(elasticDistance);
  }, [isRefreshing]);

  const handleTouchEnd = useCallback(() => {
    if (!isPullingRef.current) return;
    
    isPullingRef.current = false;
    
    // Trigger refresh if pulled more than 50px
    if (pullDistance > 50) {
      // Keep indicator visible during refresh
      setPullDistance(60);
      handleRefresh();
    } else {
      // Smooth spring back
      setPullDistance(0);
    }
  }, [pullDistance, handleRefresh]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer || isRefreshing) return;
    
    const now = Date.now();
    const timeSinceLastWheel = now - lastWheelTimeRef.current;
    
    // Detect scroll up at top
    if (scrollContainer.scrollTop === 0 && e.deltaY < 0) {
      e.preventDefault();
      lastWheelTimeRef.current = now;
      
      // Throttle updates for performance
      if (timeSinceLastWheel < 16) return; // ~60fps
      
      const distance = Math.abs(e.deltaY) * 0.4;
      setPullDistance(prev => {
        const newDistance = Math.min(prev + distance, 100);
        
        // Trigger refresh when crossing threshold
        if (newDistance >= 50 && prev < 50) {
          setTimeout(() => {
            setPullDistance(60);
            handleRefresh();
          }, 100);
        }
        return newDistance;
      });
      
      // Clear existing timeout
      if (wheelTimeoutRef.current) {
        clearTimeout(wheelTimeoutRef.current);
      }
      
      // Gradual decay reset
      wheelTimeoutRef.current = setTimeout(() => {
        setPullDistance(prev => {
          if (prev > 0 && prev < 50) {
            const newVal = Math.max(0, prev - 10);
            if (newVal > 0) {
              // Continue decay
              wheelTimeoutRef.current = setTimeout(() => {
                setPullDistance(p => Math.max(0, p - 10));
              }, 100);
            }
            return newVal;
          }
          return prev;
        });
      }, 150);
    }
  }, [isRefreshing, handleRefresh]);

  // NEW: Fetch tree data when infospace changes (single efficient call!)
  useEffect(() => {
    if (activeInfospace?.id && !fetchingRef.current) {
      fetchingRef.current = true;
      console.log('[AssetSelector] Fetching tree for infospace:', activeInfospace.id);
      fetchRootTree().finally(() => {
        fetchingRef.current = false;
      });
    }
  }, [activeInfospace?.id, fetchRootTree]);

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
  
  // Generate hierarchical asset tree
  // NEW: Convert TreeNodes to AssetTreeItems (much simpler!)
  const assetTree = useMemo(() => {
    console.log('[AssetSelector] Building tree from', rootNodes.length, 'root nodes');
    
    const convertToTreeItem = (node: any, level: number = 0): AssetTreeItem => {
      const isExpanded = expandedItems.has(node.id);
      const isSelected = selectedItems.has(node.id);
      
      // Get children from cache if node is expanded
      let children: AssetTreeItem[] | undefined;
      if (isExpanded) {
        const cachedChildren = childrenCache.get(node.id);
        if (cachedChildren && cachedChildren.length > 0) {
          children = cachedChildren.map(child => convertToTreeItem(child, level + 1));
        }
      }
      
      // Create minimal asset/bundle objects for display (icons, styling, etc.)
      let asset: AssetRead | undefined;
      let bundle: BundleRead | undefined;
      
      if (node.type === 'asset') {
        // Create minimal asset object with data from TreeNode
        const assetId = parseInt(node.id.replace('asset-', ''));
        asset = {
          id: assetId,
          title: node.name,
          kind: node.kind,
          is_container: node.is_container || false,
          stub: node.stub || false,
          processing_status: node.processing_status,
          updated_at: node.updated_at,
          created_at: node.created_at,
          // Minimal required fields
          infospace_id: activeInfospace?.id || 0,
          parent_asset_id: null,
          text_content: '',
          metadata: {},
          uuid: '',
          part_index: null,
          source_id: null,
        } as AssetRead;
      } else if (node.type === 'bundle') {
        // Create minimal bundle object with data from TreeNode
        const bundleId = parseInt(node.id.replace('bundle-', ''));
        bundle = {
          id: bundleId,
          name: node.name,
          description: '',
          infospace_id: activeInfospace?.id || 0,
          parent_bundle_id: node.parent_id ? parseInt(node.parent_id.replace('bundle-', '')) : null,
          updated_at: node.updated_at,
          created_at: node.created_at || node.updated_at,
          asset_count: node.asset_count || 0,
          child_bundle_count: node.child_bundle_count || 0,
        } as BundleRead;
      }
      
      return {
        id: node.id,
        type: node.type === 'bundle' ? 'folder' : 'asset',
        name: node.name,
        level,
        isExpanded,
        isSelected,
        parentId: node.parent_id,
        isContainer: node.type === 'bundle' || node.is_container,
        children,
        asset,  // Now populated for icons/styling
        bundle, // Now populated for styling
      };
    };
    
    const tree = rootNodes.map(node => convertToTreeItem(node, 0));
    console.log('[AssetSelector] Generated', tree.length, 'root tree items');

    const [sortKey, sortDirection] = sortOption.split('-') as [SortKey, SortDirection];
    const sortItemsRecursively = (items: AssetTreeItem[]): AssetTreeItem[] => {
        const sortedItems = [...items].sort((a, b) => {
            if (a.type === 'folder' && b.type !== 'folder') return -1;
            if (a.type !== 'folder' && b.type === 'folder') return 1;

            let valA: string | number = 0;
            let valB: string | number = 0;

            switch(sortKey) {
                case 'name':
                    valA = a.name.toLowerCase();
                    valB = b.name.toLowerCase();
                    break;
                case 'updated_at':
                    valA = a.asset ? new Date(a.asset.updated_at).getTime() : (a.bundle ? new Date(a.bundle.updated_at).getTime() : 0);
                    valB = b.asset ? new Date(b.asset.updated_at).getTime() : (b.bundle ? new Date(b.bundle.updated_at).getTime() : 0);
                    break;
                case 'kind':
                    valA = a.asset?.kind || ' ';
                    valB = b.asset?.kind || ' ';
                    break;
            }
            
            if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
            if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
            
            if (a.name.toLowerCase() < b.name.toLowerCase()) return -1;
            if (a.name.toLowerCase() > b.name.toLowerCase()) return 1;

            return 0;
        });
        return sortedItems.map(item => ({ ...item, children: item.children ? sortItemsRecursively(item.children) : undefined }));
    };
    return sortItemsRecursively(tree);
  }, [rootNodes, childrenCache, expandedItems, selectedItems, sortOption]);

  // Filter tree based on search and type
  const filteredTree = useMemo(() => {
    const filterItems = (items: AssetTreeItem[]): AssetTreeItem[] => {
      return items.reduce((acc: AssetTreeItem[], item) => {
        const filteredChildren = item.children ? filterItems(item.children) : undefined;
        const searchMatch = !debouncedSearchTerm.trim() || item.name.toLowerCase().includes(debouncedSearchTerm.toLowerCase());
        let keepItem = false;
        if (item.type === 'folder') {
          if ((filteredChildren && filteredChildren.length > 0) || (searchMatch && assetTypeFilter === 'all')) {
            keepItem = true;
          }
        } else {
          const typeMatch = assetTypeFilter === 'all' || item.asset?.kind === assetTypeFilter;
          if (searchMatch && typeMatch) {
            keepItem = true;
          }
        }
        if (keepItem) acc.push({ ...item, children: filteredChildren });
        return acc;
      }, []);
    };
    return filterItems(assetTree);
  }, [assetTree, debouncedSearchTerm, assetTypeFilter]);

  // NEW: Lazy load children when expanding nodes
  const toggleExpanded = useCallback(async (itemId: string) => {
    const isCurrentlyExpanded = expandedItems.has(itemId);
    setExpandedItems(prev => {
      const newSet = new Set(prev);
      if (isCurrentlyExpanded) newSet.delete(itemId);
      else newSet.add(itemId);
      return newSet;
    });

    // Lazy load children if expanding and not already cached
    if (!isCurrentlyExpanded && !childrenCache.has(itemId)) {
      console.log('[AssetSelector] Lazy loading children for:', itemId);
      try {
        await fetchChildren(itemId);
      } catch (error) {
        console.error(`[AssetSelector] Failed to fetch children for ${itemId}:`, error);
      }
    }
  }, [expandedItems, childrenCache, fetchChildren]);

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
    if (!multiSelect) {
      onSelectionChange(new Set([itemId]));
    } else {
      const newSet = new Set(selectedItems);
      if (newSet.has(itemId)) newSet.delete(itemId);
      else newSet.add(itemId);
      onSelectionChange(newSet);
    }
  }, [selectedItems, onSelectionChange]);

  const handleCardSelect = useCallback((item: AssetTreeItem, multiSelect?: boolean) => {
    toggleSelected(item.id, multiSelect);
  }, [toggleSelected]);

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
      setCardViewFolder(item);
      onSelectionChange(new Set());
    } else if (onItemView) {
      // Fetch full data for view
      if (item.type === 'asset' && item.asset) {
        const fullAsset = await useTreeStore.getState().getFullAsset(item.asset.id);
        if (fullAsset) {
          onItemView({ ...item, asset: fullAsset });
          return;
        }
      }
      onItemView(item);
    }
  }, [onItemDoubleClick, onItemView, onSelectionChange]);

  // Helper to recursively collect all child IDs from tree
  const collectAllDescendantIds = useCallback((nodeId: string): string[] => {
    const ids: string[] = [nodeId];
    const children = childrenCache.get(nodeId) || [];
    children.forEach(child => {
      ids.push(...collectAllDescendantIds(child.id));
    });
    return ids;
  }, [childrenCache]);

  const toggleBundleSelection = useCallback((bundleId: number, select: boolean) => {
    const bundleItemId = `bundle-${bundleId}`;
    const allIds = collectAllDescendantIds(bundleItemId);
    const newSet = new Set(selectedItems);
    
    if (select) {
      allIds.forEach(id => newSet.add(id));
    } else {
      allIds.forEach(id => newSet.delete(id));
    }
    onSelectionChange(newSet);
  }, [selectedItems, onSelectionChange, collectAllDescendantIds]);
  
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
    // Extract bundle ID from node ID (format: "bundle-123")
    if (!bundleItem.id.startsWith('bundle-')) return;
    const destinationBundleId = parseInt(bundleItem.id.replace('bundle-', ''));
    setDraggedOverBundleId(null);
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
    // Extract asset ID from node ID (format: "asset-123")
    if (!targetItem.id.startsWith('asset-')) return;
    const targetAssetId = parseInt(targetItem.id.replace('asset-', ''));
    
    setDraggedOverAssetId(null);
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

  const renderTreeItem = useCallback((item: AssetTreeItem) => {
    const hasChildren = item.children && item.children.length > 0;
    const canExpand = hasChildren || item.isContainer;
    const isLoading = isLoadingChildren.has(item.id);
    const isFolder = item.type === 'folder';
    const isEditing = editingItem?.id === item.id;
    const isDragOver = draggedOverBundleId === item.id;
    const isDragOverAsset = draggedOverAssetId === item.id;
    
    if (item.type === 'folder' && item.bundle) {
      const bundleId = item.bundle.id;
      const isFullySelected = isBundleFullySelected(bundleId);
      const isPartiallySelected = isBundlePartiallySelected(bundleId);
      return (
        <div key={item.id}>
          <div
            className={cn("group flex items-center justify-between gap-2 py-2 px-3 hover:bg-muted cursor-pointer transition-colors border-t border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50", (isFullySelected || item.isSelected) && "bg-blue-100 dark:bg-blue-900/80 border-l-4 border-blue-500 !border-y-blue-500/50", isDragOver && "bg-blue-100 dark:bg-blue-900 ring-1 ring-blue-500")}
            style={getIndentationStyle(item.level)}
            onClick={(e) => { e.stopPropagation(); toggleExpanded(item.id); }}
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
            <div className="w-4 h-4 flex items-center justify-center">
              {canExpand && <Button variant="ghost" size="sm" className="h-4 w-4 p-0" onClick={(e) => {e.stopPropagation(); toggleExpanded(item.id);}}> {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <ChevronRight className={cn("h-3 w-3 transition-transform duration-200", item.isExpanded && "rotate-90")} />} </Button>}
            </div>
            <Checkbox checked={isFullySelected || isPartiallySelected} onCheckedChange={(checked) => toggleBundleSelection(bundleId, !!checked)} onClick={(e) => e.stopPropagation()} className={cn("h-4 w-4", isPartiallySelected && !isFullySelected && "data-[state=checked]:bg-primary/50")} title={isFullySelected ? "Deselect all" : "Select all"} />
            <div className="w-4 h-4 flex items-center justify-center">
              <div className="relative">
                <Folder className={cn("h-4 w-4 text-blue-600 transition-opacity duration-200", item.isExpanded && "opacity-0")} />
                <FolderOpen className={cn("h-4 w-4 text-blue-600 absolute inset-0 transition-opacity duration-200", !item.isExpanded && "opacity-0")} />
              </div>
            </div>
            <div className="flex-1 min-w-0" onDoubleClick={(e) => { e.stopPropagation(); handleEditItem(item); }}>
              <div className="flex items-center gap-2">
                {isEditing ? (
                  <div className="flex items-center gap-1">
                    <Input value={editingItem.value} onChange={(e) => setEditingItem({ ...editingItem, value: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') handleSaveEditing(); if (e.key === 'Escape') handleCancelEdit(); }} autoFocus className="h-7 text-sm" onClick={(e) => e.stopPropagation()} />
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); handleSaveEditing();}}><Check className="h-4 w-4 text-green-600"/></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); handleCancelEdit();}}><X className="h-4 w-4 text-red-600"/></Button>
                  </div>
                ) : (
                  <>
                    <span className="text-sm font-semibold truncate">{item.name}</span>
                    {hasChildren && <Badge variant="secondary" className="text-xs">{item.children?.length} items</Badge>}
                    <div className="md:hidden flex items-center gap-1">
                      {item.type === 'folder' && (
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={(e) => { e.stopPropagation(); handleItemClick(item); }} title="Bundle Details">
                          <View className="h-4 w-4" />
                        </Button>
                      )}
                      {renderItemActions ? renderItemActions(item) : (
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={(e) => { e.stopPropagation(); handleItemClick(item); }} title="View Details"><Eye className="h-4 w-4" /></Button>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
            <div className="hidden md:flex items-center gap-1">
              {item.type === 'folder' && (
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={(e) => { e.stopPropagation(); handleItemClick(item); }} title="Bundle Details">
                  <View className="h-4 w-4" />
                </Button>
              )}
              {renderItemActions ? renderItemActions(item) : (
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={(e) => { e.stopPropagation(); handleItemClick(item); }} title="View Details"><Eye className="h-4 w-4" /></Button>
              )}
            </div>
          </div>
          <div
            data-state={item.isExpanded ? "open" : "closed"}
            className="overflow-hidden transition-all duration-800 ease-out data-[state=closed]:animate-slide-up data-[state=open]:animate-slide-down data-[state=closed]:h-0 data-[state=open]:h-auto max-h-72 overflow-y-auto"
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
    
    return (
      <div key={item.id}>
        <div
          className={cn("group flex items-center gap-2.5 py-1.5 px-3 hover:bg-muted/50 cursor-pointer transition-colors rounded-md", item.isSelected && "bg-blue-50 dark:bg-blue-900/50 border-l-4 rounded-none border-blue-500", isDragOverAsset && "bg-green-100 dark:bg-green-900 ring-1 ring-green-500")}
          style={getIndentationStyle(item.level)}
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
          <div className="w-4 h-4 flex items-center justify-center">{canExpand && <Button variant="ghost" size="sm" className="h-4 w-4 p-0" onClick={(e) => { e.stopPropagation(); toggleExpanded(item.id); }}>{isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <ChevronRight className={cn("h-3 w-3 transition-transform duration-200", item.isExpanded && "rotate-90")} />}</Button>}</div>
          <Checkbox checked={item.isSelected} onCheckedChange={() => toggleSelected(item.id, true)} onClick={(e) => e.stopPropagation()} className="h-4 w-4" />
          <div className="w-4 h-4 flex items-center justify-center">{item.asset && getAssetIcon(item.asset.kind)}</div>
          <div className="flex-1 min-w-0 overflow-hidden" onDoubleClick={(e) => { e.stopPropagation(); handleEditItem(item); }}>
            <div className="flex items-center gap-1.5">
              {isEditing ? (
                  <div className="flex items-center gap-0.5">
                    <Input value={editingItem.value} onChange={(e) => setEditingItem({ ...editingItem, value: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') handleSaveEditing(); if (e.key === 'Escape') handleCancelEdit(); }} autoFocus className="h-7 text-sm" onClick={(e) => e.stopPropagation()} />
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); handleSaveEditing();}}><Check className="h-4 w-4 text-green-600"/></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); handleCancelEdit();}}><X className="h-4 w-4 text-red-600"/></Button>
                  </div>
                ) : (
                  <>
                    <span className="text-sm font-medium truncate">{item.name}</span>
                    <div className="md:hidden flex items-center gap-1">
                      {renderItemActions ? renderItemActions(item) : (
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={(e) => { e.stopPropagation(); handleItemClick(item); }} title="View Details"><Eye className="h-4 w-4" /></Button>
                      )}
                    </div>
                  </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-4 ml-auto pl-4">
            {item.asset && <div className="text-xs text-muted-foreground truncate hidden group-hover:block md:block">{formatDistanceToNow(new Date(item.asset.updated_at), { addSuffix: true })}</div>}
            <div className="hidden md:flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {renderItemActions ? renderItemActions(item) : (
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={(e) => { e.stopPropagation(); handleItemClick(item); }} title="View Details"><Eye className="h-4 w-4" /></Button>
              )}
            </div>
          </div>
        </div>
        <div
          data-state={item.isExpanded ? "open" : "closed"}
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
      </div>
    );
  }, [toggleSelected, toggleExpanded, handleItemClick, handleItemDoubleClickInternal, handleEditItem, handleSaveEditing, handleCancelEdit, isLoadingChildren, toggleBundleSelection, isBundleFullySelected, isBundlePartiallySelected, editingItem, draggedOverBundleId, draggedOverAssetId, handleDropOnBundle, handleDropOnAsset, renderItemActions]);

  const itemsForView = useMemo(() => {
    if (viewMode === 'card' && cardViewFolder) return cardViewFolder.children || [];
    return filteredTree;
  }, [viewMode, cardViewFolder, filteredTree]);

  return (
    <div className="h-full w-full flex flex-col overflow-hidden min-w-0">
        {/* Search and Filter */}
        <div className="flex-none p-3 border-b min-w-0 overflow-hidden">
          <div className="flex items-center gap-2 min-w-0">
            <Checkbox id="select-all" checked={isAllSelected} onCheckedChange={(checked) => handleSelectAll(Boolean(checked))} disabled={allVisibleItemIds.size === 0} aria-label="Select all visible items" />
            <div className="relative flex-grow">
              <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search assets..." className="pl-8 h-9" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
            </div>
            <Select value={assetTypeFilter} onValueChange={(value) => setAssetTypeFilter(value as AssetKind | 'all')}>
              <SelectTrigger className="w-[180px] h-9"><SelectValue placeholder="Filter by type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {assetKinds.map(kind => <SelectItem key={kind} value={kind}>{kind.charAt(0).toUpperCase() + kind.slice(1).replace('_', ' ')}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={sortOption} onValueChange={setSortOption}>
              <SelectTrigger className="w-[180px] h-9"><SelectValue placeholder="Sort by" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="updated_at-desc">Date Modified (Newest)</SelectItem>
                <SelectItem value="updated_at-asc">Date Modified (Oldest)</SelectItem>
                <SelectItem value="name-asc">Name (A-Z)</SelectItem>
                <SelectItem value="name-desc">Name (Z-A)</SelectItem>
                <SelectItem value="kind-asc">Kind (A-Z)</SelectItem>
                <SelectItem value="kind-desc">Kind (Z-A)</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1 rounded-md bg-muted p-0.5">
              <Button variant={viewMode === 'list' ? 'secondary' : 'ghost'} size="sm" className="h-7 px-2" onClick={() => setViewMode('list')}><List className="h-4 w-4" /></Button>
              <Button variant={viewMode === 'card' ? 'secondary' : 'ghost'} size="sm" className="h-7 px-2" onClick={() => setViewMode('card')}><LayoutGrid className="h-4 w-4" /></Button>
            </div>
          </div>
          {cardViewFolder && viewMode === 'card' && (
            <div className="mt-2">
              <Button variant="outline" size="sm" onClick={() => { setCardViewFolder(null); onSelectionChange(new Set()); }}>
                <ChevronLeft className="h-4 w-4 mr-2" /> Back to root
              </Button>
              <span className="ml-2 text-sm font-medium text-muted-foreground">/ {cardViewFolder.name}</span>
            </div>
          )}
        </div>

        {/* Asset Tree */}
        <div 
          className={cn("flex-1 min-h-0 overflow-hidden relative min-w-0 max-w-full", isDraggedOverTopLevel && !draggedOverBundleId && !draggedOverAssetId && "bg-blue-50 dark:bg-blue-900/50 ring-2 ring-blue-500 ring-inset")}
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
            
            // Only set to false if we're leaving the container itself, not a child
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setIsDraggedOverTopLevel(false); 
            }
          }}
          onDrop={(e) => { 
            e.preventDefault(); 
            // Clear timeout
            if (dragOverTimeout) {
              clearTimeout(dragOverTimeout);
              setDragOverTimeout(null);
            }
            
            // Only handle top level drop if we're not over a specific item
            if (!draggedOverBundleId && !draggedOverAssetId) {
              handleDropOnTopLevel(e); 
            }
          }}
        >
          {/* Pull-to-refresh indicator */}
          <div 
            className="absolute top-0 left-0 right-0 flex items-center justify-center z-10 pointer-events-none"
            style={{ 
              height: `${pullDistance}px`,
              opacity: pullDistance > 0 ? Math.min(pullDistance / 30, 1) : 0,
              transform: `translateY(${pullDistance > 0 ? 0 : -10}px) scale(${Math.min(pullDistance / 50, 1)})`,
              transition: isPullingRef.current ? 'none' : 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)'
            }}
          >
            <div 
              className="flex items-center gap-2 px-4 py-2 bg-primary/10 backdrop-blur-md rounded-full border border-primary/20 shadow-lg"
              style={{
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
              }}
            >
              <Loader2 
                className={cn(
                  "h-4 w-4 text-primary",
                  isRefreshing && "animate-spin"
                )}
                style={{ 
                  transform: !isRefreshing ? `rotate(${pullDistance * 4}deg)` : undefined,
                  transition: isRefreshing ? 'none' : 'transform 0.2s ease-out'
                }}
              />
              <span 
                className="text-xs font-medium text-primary whitespace-nowrap"
                style={{
                  transition: 'opacity 0.2s ease-out'
                }}
              >
                {isRefreshing ? 'Refreshing...' : pullDistance > 50 ? 'Release to refresh' : 'Pull to refresh'}
              </span>
            </div>
          </div>

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
              style={{ 
                paddingTop: `${pullDistance}px`,
                transition: isPullingRef.current ? 'none' : 'padding-top 0.4s cubic-bezier(0.4, 0, 0.2, 1)'
              }}
            >
            {isLoadingRoot ? (
              <div className="flex items-center justify-center h-32"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /><span className="ml-2 text-muted-foreground">Loading...</span></div>
            ) : itemsForView.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                <FolderOpen className="h-8 w-8 mb-2 opacity-50" />
                <h3 className="text-lg font-medium mb-2">No items found</h3>
                <p className="text-sm text-center">
                  {debouncedSearchTerm ? `No items match "${debouncedSearchTerm}"` : cardViewFolder ? "This folder is empty." : "No items available."}
                </p>
              </div>
            ) : viewMode === 'list' ? (
              <div className="p-2 space-y-1 pb-4">{itemsForView.map(item => renderTreeItem(item))}</div>
            ) : (
              <AssetCardComponent items={itemsForView} onItemSelect={handleCardSelect} onItemDoubleClick={handleItemDoubleClickInternal} onItemView={handleItemClick} selectedItemIds={selectedItems} />
            )}
            </div>
            <ScrollBar />
          </ScrollArea>
        </div>
      </div>
  );
} 