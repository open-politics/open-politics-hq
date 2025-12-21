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
  Edit3,
  Check,
  Link as LinkIcon,
  EyeOff,
  View,
  Settings,
  ChevronLeft,
  FileIcon,
  RadioTower,
  Menu,
  Newspaper,
  Folder,
  Shredder,
  Asterisk
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNowStrict } from 'date-fns';
import { toast } from 'sonner';
import {
  AssetRead,
  AssetKind,
  BundleRead,
  AssetUpdate,
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
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import AssetDetailView from './Views/AssetDetailView';
import CreateAssetDialog from './Helper/AssetCreateDataSourceDialog';
import EditAssetOverlay from './Helper/EditAssetOverlay';
import { AssetTransferPopover } from './Helper/AssetTransferPopover';
import ArticleComposer from './Composer/ArticleComposer';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import BundleEditDialog from './Helper/BundleEditDialog';
import CreateBundleDialog from './Helper/CreateBundleDialog';
import BundleDetailView from './Views/BundleDetailView';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ButtonGroup,
  ButtonGroupSeparator,
} from '@/components/ui/button-group';
import AssetSelector, { AssetTreeItem } from './AssetSelector';
import { useShareableStore } from '@/zustand_stores/storeShareables';
import ShareItemDialog from './Helper/ShareItemDialog';
import { ResourceType } from '@/client';
import { TextSpanHighlightProvider } from '@/components/collection/contexts/TextSpanHighlightContext';
import { useIsMobile } from '@/hooks/use-mobile';
import DataSourceManager from '../sources/DataSourceManager';
import { AssetFeedView } from './Feed';
import { useSemanticSearch } from '@/hooks/useSemanticSearch';
import { useProvidersStore } from '@/zustand_stores/storeProviders';
import type { AssetFeedItem } from './Feed/types';
import { Form } from 'react-hook-form';

    


type SortKey = 'name' | 'updated_at' | 'kind';
type SortDirection = 'asc' | 'desc';

interface AssetManagerProps {
  onLoadIntoRunner?: (runId: number, runName: string) => void;
}

export default function AssetManager({ onLoadIntoRunner }: AssetManagerProps) {
  const { activeInfospace } = useInfospaceStore();
  
  // NEW: Use tree store for efficient loading
  const {
    rootNodes,
    childrenCache,
    isLoadingRoot,
    isLoadingChildren,
    totalBundles,
    totalAssets,
    error: treeError,
    fetchRootTree,
    fetchChildren,
    getFullAsset,
    clearCache,
  } = useTreeStore();
  
  // Still need asset/bundle stores for mutations (create, update, delete)
  const {
    deleteAsset,
    updateAsset,
  } = useAssetStore();
  
  const {
    deleteBundle,
    addAssetToBundle,
    removeAssetFromBundle,
    updateBundle,
  } = useBundleStore();
  
  const { exportResource, exportResourcesBatch, importResource, exportMixedBatch } = useShareableStore();

  // UI State - search term is managed by AssetSelector, we track it here for feed
  const [searchTermFromSelector, setSearchTermFromSelector] = useState('');
  const debouncedSearchTerm = useDebounce(searchTermFromSelector, 300);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [activeDetail, setActiveDetail] = useState<{ type: 'asset' | 'bundle'; id: number } | null>(null);
  const [selectedAssetInBundle, setSelectedAssetInBundle] = useState<number | null>(null);
  const [highlightAssetId, setHighlightAssetId] = useState<number | null>(null);
  const [assetTypeFilter, setAssetTypeFilter] = useState<AssetKind | 'all'>('all');
  const [sortOption, setSortOption] = useState('updated_at-desc');
  const [useSemanticMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('assetSelector_searchMode') === 'semantic';
    }
    return true; // Default to semantic, matching AssetSelector
  });
  
  // Semantic search for feed
  const semanticSearchEnabled = useSemanticMode && !!activeInfospace?.embedding_model && debouncedSearchTerm.trim().length > 0;
  const { results: semanticResults } = useSemanticSearch({
    query: debouncedSearchTerm,
    enabled: semanticSearchEnabled,
    limit: 100,
    assetKinds: assetTypeFilter !== 'all' ? [assetTypeFilter] : undefined,
  });
  
  // Convert semantic results to feed items
  const semanticFeedItems = useMemo<AssetFeedItem[]>(() => {
    if (!semanticSearchEnabled || semanticResults.length === 0) {
      return [];
    }
    return semanticResults.map(result => ({
      asset: result.asset,
      score: result.score,
    }));
  }, [semanticSearchEnabled, semanticResults]);
  
  // Dialog state
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [createDialogMode, setCreateDialogMode] = useState<'individual' | 'bundle'>('individual');
  const [createDialogInitialFocus, setCreateDialogInitialFocus] = useState<'file' | 'url' | 'text' | undefined>();
  
  // Inline editing state
  const [editingItem, setEditingItem] = useState<{ id: string; value: string } | null>(null);
  
  // Dialog state for overlays
  const [editingAsset, setEditingAsset] = useState<AssetRead | null>(null);
  const [editingBundle, setEditingBundle] = useState<BundleRead | null>(null);
  
  // Separate dialogs for different functions
  const [isCreateBundleOpen, setIsCreateBundleOpen] = useState(false);
  const [sharingItem, setSharingItem] = useState<AssetTreeItem | null>(null);
  
  // Article composer state
  const [isArticleComposerOpen, setIsArticleComposerOpen] = useState(false);
  const [articleComposerMode, setArticleComposerMode] = useState<'create' | 'edit'>('create');
  const [editingArticleId, setEditingArticleId] = useState<number | undefined>();
  
  // Data fetching state - NOW REMOVED! Using tree store instead
  // const [bundleAssets, setBundleAssets] = useState<Map<number, AssetRead[]>>(new Map());
  // const [childAssets, setChildAssets] = useState<Map<number, AssetRead[]>>(new Map());
  // const [isLoadingChildren, setIsLoadingChildren] = useState<Set<number>>(new Set());

  // Drag and drop state
  const [draggedOverBundleId, setDraggedOverBundleId] = useState<string | null>(null);

  // View mode state
  const [viewMode, setViewMode] = useState<'list' | 'card'>('list');
  const [cardViewFolder, setCardViewFolder] = useState<AssetTreeItem | null>(null);

  // Mobile responsive state
  const isMobile = useIsMobile();
  const [showMobileDetail, setShowMobileDetail] = useState(false);

  // Delete confirmation dialog state
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    type: 'asset' | 'bundle' | 'bulk-assets' | 'bulk-bundles';
    items: (AssetRead | BundleRead)[];
    isOpen: boolean;
  }>({ type: 'asset', items: [], isOpen: false });
  
  // Upload to existing bundle state
  const [uploadToBundle, setUploadToBundle] = useState<BundleRead | null>(null);

  const [showDataSourceManager, setShowDataSourceManager] = useState(false);

  const fetchingRef = useRef(false);

  // NEW: Fetch tree data when infospace changes (single efficient call!)
  useEffect(() => {
    if (activeInfospace?.id && !fetchingRef.current) {
      fetchingRef.current = true;
      console.log('[AssetManager] Fetching tree for infospace:', activeInfospace.id);
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
    // Also collect from cached children
    childrenCache.forEach(children => collectKinds(children));
    return Array.from(kinds).sort();
  }, [rootNodes, childrenCache]);

  // OLD N+1 FETCHING LOGIC - REMOVED! 🎉
  // This was causing 10-30 API calls on every page load
  // Now we have a single fetchRootTree() call above

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

  // NEW: Convert TreeNodes to AssetTreeItems (much simpler!)
  const assetTree = useMemo(() => {
    console.log('[AssetManager] Building tree from', rootNodes.length, 'root nodes');
    
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
    console.log('[AssetManager] Generated', tree.length, 'root tree items');

    const [sortKey, sortDirection] = sortOption.split('-') as [SortKey, SortDirection];

    const sortItemsRecursively = (items: AssetTreeItem[]): AssetTreeItem[] => {
        const sortedItems = [...items].sort((a, b) => {
            // Keep folders (bundles) before individual assets at the same level
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
                    // Bundles don't have a kind, they can be considered folders. Give them a low sort value to keep them together.
                    valA = a.asset?.kind || ' ';
                    valB = b.asset?.kind || ' ';
                    break;
            }
            
            if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
            if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
            
            // As a secondary sort, use name ascending
            if (a.name.toLowerCase() < b.name.toLowerCase()) return -1;
            if (a.name.toLowerCase() > b.name.toLowerCase()) return 1;

            return 0;
        });

        return sortedItems.map(item => {
            if (item.children) {
                return { ...item, children: sortItemsRecursively(item.children) };
            }
            return item;
        });
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
          // A folder is kept if it has children that passed the filter
          if (filteredChildren && filteredChildren.length > 0) {
            keepItem = true;
          } 
          // also keep if folder name matches search and we are not filtering by type
          else if (searchMatch && assetTypeFilter === 'all') {
            keepItem = true;
          }
        } else {
          // An asset is kept if it matches both search and type.
          const typeMatch = assetTypeFilter === 'all' || item.asset?.kind === assetTypeFilter;
          if (searchMatch && typeMatch) {
            keepItem = true;
          }
        }
        
        if (keepItem) {
          acc.push({ ...item, children: filteredChildren });
        }
        
        return acc;
      }, []);
    };
    
    return filterItems(assetTree);
  }, [assetTree, debouncedSearchTerm, assetTypeFilter]);

  // NEW: Handle item expansion with lazy loading
  const toggleExpanded = useCallback(async (itemId: string) => {
    const isCurrentlyExpanded = expandedItems.has(itemId);
    
    setExpandedItems(prev => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) {
        newSet.delete(itemId);
      } else {
        newSet.add(itemId);
      }
      return newSet;
    });

    // NEW: Lazy load children from tree store (works for both bundles and assets!)
    if (!isCurrentlyExpanded && !childrenCache.has(itemId)) {
      console.log('[AssetManager] Lazy loading children for:', itemId);
      try {
        await fetchChildren(itemId);
        // Children are now in the cache, tree will re-render automatically
      } catch (error) {
        console.error(`[AssetManager] Failed to fetch children for ${itemId}:`, error);
        toast.error('Failed to load children');
      }
    }
  }, [expandedItems, childrenCache, fetchChildren]);

  const allVisibleItemIds = useMemo(() => {
    const ids = new Set<string>();
    const collectIds = (items: AssetTreeItem[]) => {
      for (const item of items) {
        ids.add(item.id);
        if (item.children) {
          collectIds(item.children);
        }
      }
    };
    collectIds(filteredTree);
    return ids;
  }, [filteredTree]);

  const isAllSelected = useMemo(() => {
    if (allVisibleItemIds.size === 0) return false;
    for (const id of allVisibleItemIds) {
      if (!selectedItems.has(id)) return false;
    }
    return true;
  }, [selectedItems, allVisibleItemIds]);

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedItems(new Set(allVisibleItemIds));
    } else {
      setSelectedItems(new Set());
    }
  };

  // Handle item selection
  const toggleSelected = useCallback((itemId: string, multiSelect?: boolean) => {
    if (!multiSelect) {
      setSelectedItems(new Set([itemId]));
    } else {
      setSelectedItems(prev => {
        const newSet = new Set(prev);
        if (newSet.has(itemId)) {
          newSet.delete(itemId);
        } else {
          newSet.add(itemId);
        }
        return newSet;
      });
    }
  }, []);

  const handleCardSelect = useCallback((item: AssetTreeItem, multiSelect?: boolean) => {
    toggleSelected(item.id, multiSelect);
  }, [toggleSelected]);

  // Handle asset viewing
  // Navigation flow:
  // - Clicking bundle -> shows bundle detail view
  // - Clicking asset with parent -> shows parent asset detail with child highlighted
  // - Clicking top-level asset -> shows asset detail view
  // - Back button -> returns to feed (sets activeDetail to null)
  const handleItemView = useCallback((item: AssetTreeItem) => {
    if (item.type === 'folder' && item.bundle) {
        setActiveDetail({ type: 'bundle', id: item.bundle.id });
        setHighlightAssetId(null);
    } else if (item.asset) {
        if (item.asset.parent_asset_id) {
            setActiveDetail({ type: 'asset', id: item.asset.parent_asset_id });
            setHighlightAssetId(item.asset.id);
        } else {
            setActiveDetail({ type: 'asset', id: item.asset.id });
            setHighlightAssetId(null);
        }
    }
    // Open mobile detail sheet when on mobile
    if (isMobile) {
        setShowMobileDetail(true);
    }
  }, [isMobile]);

  const handleItemDoubleClick = useCallback((item: AssetTreeItem) => {
    // In AssetManager, double-click should open the detail view.
    handleItemView(item);
  }, [handleItemView]);

  // Bulk delete functionality
  const handleBulkDelete = useCallback(() => {
    // NEW: Simplified - we only need IDs for deletion
    const bundleIds: number[] = [];
    const assetIds: number[] = [];
    
    selectedItems.forEach(itemId => {
      if (itemId.startsWith('bundle-')) {
        bundleIds.push(parseInt(itemId.replace('bundle-', '')));
      } else if (itemId.startsWith('asset-') || itemId.startsWith('child-')) {
        assetIds.push(parseInt(itemId.replace(/^(asset-|child-)/, '')));
      }
    });

    // Create minimal items for confirmation dialog
    // IMPORTANT: Must include 'kind' field for assets to distinguish from bundles
    const items: any[] = [
      ...bundleIds.map(id => ({ id, name: `Bundle ${id}` })),
      ...assetIds.map(id => ({ id, title: `Asset ${id}`, kind: 'text' as AssetKind }))
    ];

    if (bundleIds.length > 0 && assetIds.length > 0) {
      setDeleteConfirmation({ type: 'bulk-assets', items, isOpen: true });
    } else if (bundleIds.length > 0) {
      setDeleteConfirmation({ type: 'bulk-bundles', items, isOpen: true });
    } else if (assetIds.length > 0) {
      setDeleteConfirmation({ type: 'bulk-assets', items, isOpen: true });
    }
  }, [selectedItems]);

  const handleDeleteAsset = async (asset: AssetRead, skipConfirmation = false) => {
    if (!skipConfirmation) {
      setDeleteConfirmation({ type: 'asset', items: [asset], isOpen: true });
      return;
    }
    try {
      await deleteAsset(asset.id);
      toast.success(`Asset "${asset.title}" deleted.`);
      if (activeDetail?.type === 'asset' && activeDetail.id === asset.id) setActiveDetail(null);
      
      // Refresh tree
      clearCache();
      await fetchRootTree();
    } catch (error) { 
      toast.error('Failed to delete asset.'); 
    }
  };

  const handleDeleteBundle = async (bundle: BundleRead, skipConfirmation = false) => {
    if (!skipConfirmation) {
      setDeleteConfirmation({ type: 'bundle', items: [bundle], isOpen: true });
      return;
    }
    try {
      await deleteBundle(bundle.id);
      toast.success(`Bundle "${bundle.name}" deleted.`);
      if (activeDetail?.type === 'bundle' && activeDetail.id === bundle.id) setActiveDetail(null);
      
      // Refresh tree
      clearCache();
      await fetchRootTree();
    } catch (error) { 
      toast.error('Failed to delete bundle.'); 
    }
  };

  const executeDelete = useCallback(async () => {
    if (!activeInfospace?.id) return;
    
    const { items } = deleteConfirmation;
    const assetsToDelete = items.filter(item => 'kind' in item) as AssetRead[];
    const bundlesToDelete = items.filter(item => 'name' in item && !('kind' in item)) as BundleRead[];
    
    try {
      // Use unified tree delete endpoint - much cleaner!
      // Deleting bundles will automatically delete their assets
      const { TreeNavigationService } = await import('@/client');
      
      const nodeIds = [
        ...bundlesToDelete.map(b => `bundle-${b.id}`),
        ...assetsToDelete.map(a => `asset-${a.id}`)
      ];
      
      await TreeNavigationService.deleteTreeNodes({
        infospaceId: activeInfospace.id,
        requestBody: { node_ids: nodeIds }
      });
      
      const totalCount = assetsToDelete.length + bundlesToDelete.length;
      toast.success(`Successfully deleted ${totalCount} item(s).`);
      setSelectedItems(new Set());
      setActiveDetail(null);
      
      // Refresh tree after deletion
      clearCache();
      await fetchRootTree();
    } catch (error) {
      console.error('Delete error:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`Failed to delete: ${message}`); 
      // Still refresh tree to show current state
      clearCache();
      await fetchRootTree();
    } finally {
      setDeleteConfirmation({ type: 'asset', items: [], isOpen: false });
    }
  }, [deleteConfirmation, clearCache, fetchRootTree, activeInfospace]);

  const handleEditAsset = (asset: AssetRead) => setEditingAsset(asset);
  const handleSaveAsset = async (assetId: number, updateData: AssetUpdate) => {
    await updateAsset(assetId, updateData);
  };

  const handleEditBundle = (bundle: BundleRead) => setEditingBundle(bundle);
  const handleSaveBundle = async (bundleId: number, updateData: { name?: string; description?: string }) => {
    try {
      await updateBundle(bundleId, updateData);
      setEditingBundle(null);
      toast.success('Bundle updated.');
    } catch (error) { toast.error('Failed to update bundle.'); }
  };

  const handleExportItem = useCallback(async (item: AssetTreeItem) => {
    if (!activeInfospace?.id) {
        toast.error("No active infospace selected.");
        return;
    }
    const resourceType: ResourceType = item.type === 'folder' ? 'bundle' : 'asset';
    const resourceId = item.bundle?.id ?? item.asset?.id;

    if (!resourceId) {
        toast.error("Invalid item for export.");
        return;
    }
    
    toast.info(`Exporting ${item.name}...`);
    try {
        await exportResource(resourceType, resourceId, activeInfospace.id);
        // Success toast is handled by the store
    } catch (error: any) {
        toast.error(error.message || `Failed to export ${item.name}.`);
    }
  }, [activeInfospace, exportResource]);

  const handleBulkExport = useCallback(async () => {
    if (!activeInfospace?.id) {
        toast.error("No active infospace selected.");
        return;
    }

    const assetIds: number[] = [];
    const bundleIds: number[] = [];

    selectedItems.forEach(itemId => {
        if (itemId.startsWith('bundle-')) {
            const bundleId = parseInt(itemId.replace('bundle-', ''));
            bundleIds.push(bundleId);
        } else if (itemId.startsWith('asset-') || itemId.startsWith('child-')) {
            const assetId = parseInt(itemId.replace(/^(asset-|child-)/, ''));
            // NEW: Skip parent check for now - export all selected assets
            // (we could fetch full asset data if parent check is critical)
            if (!itemId.startsWith('child-')) { // Skip child assets
              assetIds.push(assetId);
            }
        }
    });

    if (assetIds.length === 0 && bundleIds.length === 0) {
        toast.info("No items selected for export.");
        return;
    }

    try {
        toast.info(`Exporting ${assetIds.length} assets and ${bundleIds.length} folders...`);
        await exportMixedBatch(activeInfospace.id, assetIds, bundleIds);
    } catch (error: any) {
      toast.error(error.message || 'Failed to start bulk export.');
    }
  }, [selectedItems, activeInfospace, exportMixedBatch]);

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
        const file = event.target.files[0];
        if (!activeInfospace?.id) {
            toast.error("No active infospace to import into.");
            return;
        }
        toast.info(`Importing ${file.name}...`);
        try {
            const result = await importResource(file, activeInfospace.id);
            if (result) {
                toast.success(`Import successful: ${result.message}`);
                // NEW: Refresh tree data
                clearCache();
                await fetchRootTree();
            }
        } finally {
          // Reset file input to allow re-uploading the same file
          event.target.value = '';
        }
    }
  };

  const handleCreateEmptyBundle = () => setIsCreateBundleOpen(true);
  const handleUploadToBundle = (bundle: BundleRead) => {
    setUploadToBundle(bundle);
    setCreateDialogMode('bundle');
    setIsCreateDialogOpen(true);
  };

  const handleCreateArticle = () => {
    setArticleComposerMode('create');
    setEditingArticleId(undefined);
    setIsArticleComposerOpen(true);
  };

  const handleEditArticle = (asset: AssetRead) => {
    setArticleComposerMode('edit');
    setEditingArticleId(asset.id);
    setIsArticleComposerOpen(true);
  };

  // NEW: Simplified transfer items (no need for full data!)
  const transferItems = useMemo(() => {
    const items: Array<{ id: number; type: 'asset' | 'bundle'; title: string }> = [];
    selectedItems.forEach(itemId => {
      if (itemId.startsWith('bundle-')) {
        const bundleId = parseInt(itemId.replace('bundle-', ''));
        // Use tree node name if available, otherwise use ID
        const node = rootNodes.find(n => n.id === itemId) || 
                     Array.from(childrenCache.values()).flat().find(n => n.id === itemId);
        items.push({ id: bundleId, type: 'bundle', title: node?.name || `Bundle ${bundleId}` });
      } else if (itemId.startsWith('asset-') || itemId.startsWith('child-')) {
        const assetId = parseInt(itemId.replace(/^(asset-|child-)/, ''));
        const node = rootNodes.find(n => n.id === itemId) || 
                     Array.from(childrenCache.values()).flat().find(n => n.id === itemId);
        items.push({ id: assetId, type: 'asset', title: node?.name || `Asset ${assetId}` });
      }
    });
    return items;
  }, [selectedItems, rootNodes, childrenCache]);


  const renderItemActions = (item: AssetTreeItem) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={(e) => e.stopPropagation()}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuLabel>{item.type === 'folder' ? 'Folder' : 'Asset'} Actions</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => handleItemView(item)}><Eye className="mr-2 h-4 w-4" /> View Details</DropdownMenuItem>
        {item.type === 'folder' && item.bundle && (
          <>
            {/* redundant */}
            {/* <DropdownMenuItem onClick={() => setActiveDetail({ type: 'bundle', id: item.bundle!.id })}><View className="mr-2 h-4 w-4" /> Bundle Details</DropdownMenuItem> */}
            <DropdownMenuItem onClick={() => handleUploadToBundle(item.bundle!)}><Upload className="mr-2 h-4 w-4" /> Add Files</DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleEditBundle(item.bundle!)}><Settings className="mr-2 h-4 w-4" /> Edit Details</DropdownMenuItem>
          </>
        )}
        {item.type === 'asset' && item.asset && (
          <>
            <DropdownMenuItem onClick={() => handleEditAsset(item.asset!)}><Settings className="mr-2 h-4 w-4" /> Edit Details</DropdownMenuItem>
            {item.asset.kind === 'article' && (
              <DropdownMenuItem onClick={() => handleEditArticle(item.asset!)}><FileText className="mr-2 h-4 w-4" /> Edit Article</DropdownMenuItem>
            )}
          </>
        )}
        <DropdownMenuItem onClick={() => setSharingItem(item)}><Share2 className="mr-2 h-4 w-4" /> Share</DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExportItem(item)}><Download className="mr-2 h-4 w-4" /> Export</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-red-600" onClick={() => item.asset ? handleDeleteAsset(item.asset) : item.bundle ? handleDeleteBundle(item.bundle) : null}>
          <Trash2 className="mr-2 h-4 w-4" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  if (!activeInfospace) {
    return <div className="flex items-center justify-center h-full"><p>Please select an Infospace.</p></div>;
  }

  if (showDataSourceManager) {
    return <DataSourceManager onClose={() => {
      setShowDataSourceManager(false);
      // Refresh tree in case new assets were created by sources
      clearCache();
      fetchRootTree();
    }} />;
  }

  return (
    <TextSpanHighlightProvider>
      <div className="flex flex-col h-full w-full min-w-0 px-1 sm:px-2 scrollbar-hide">
        <div className="flex items-center hidden sm:flex justify-between mb-3 px-2">
          
        </div>
        <div className="flex-none mb-3 md:mb-1 px-2">
          {isMobile ? (
            /* Mobile Layout - Organized in rows with button groups */
            <div className="space-y-2">
              {/* Content Creation Actions */}
              <div className="flex flex-wrap items-center gap-2">
                {/* Upload + URL + Sources group */}
                <ButtonGroup className="bg-muted/60">
                  <Button 
                    variant="outline" 
                    onClick={() => { setCreateDialogMode('individual'); setCreateDialogInitialFocus('file'); setIsCreateDialogOpen(true); }} 
                    className="h-8 px-3 text-xs"
                  >
                    <Upload className="h-3.5 w-3.5 mr-1.5" /> 
                    Upload
                  </Button>
                  <Button 
                    variant="outline" 
                    onClick={() => { setCreateDialogMode('individual'); setCreateDialogInitialFocus('url'); setIsCreateDialogOpen(true); }} 
                    className="h-8 px-3 text-xs"
                  >
                    <LinkIcon className="h-3.5 w-3.5 mr-1.5" /> 
                    URL
                  </Button>
                  <Button 
                    variant="outline" 
                    onClick={() => setShowDataSourceManager(true)} 
                    className="h-8 px-3 text-xs"
                  >
                    <RadioTower className="h-3.5 w-3.5 mr-1.5" /> 
                    Sources
                  </Button>
                </ButtonGroup>
                
                {/* Article + Folder group */}
                <ButtonGroup>
                  <Button 
                    variant="outline" 
                    onClick={handleCreateArticle} 
                    className="h-8 px-3 text-xs"
                  >
                    <FileText className="h-3.5 w-3.5 mr-1.5" /> 
                    Article
                  </Button>
                  <Button 
                    variant="outline" 
                    onClick={handleCreateEmptyBundle} 
                    className="h-8 px-3 text-xs"
                  >
                    <FolderPlus className="h-3.5 w-3.5 mr-1.5" /> 
                    Folder
                  </Button>
                </ButtonGroup>
                
                {/* Import - standalone */}
                <Button 
                  variant="outline" 
                  onClick={() => document.getElementById('import-file-input')?.click()} 
                  className="h-8 px-3 text-xs"
                >
                  <Download className="h-3.5 w-3.5 mr-1.5" /> 
                  Import
                </Button>
                
                {/* Feed View button for mobile */}
                <Button 
                  variant="default" 
                  onClick={() => {
                    setActiveDetail(null);
                    setShowMobileDetail(true);
                  }} 
                  className="h-8 px-3 text-xs bg-amber-600 hover:bg-amber-700"
                >
                  <Folder className="h-3.5 w-3.5 mr-1.5" /> 
                  Latest/ Feed
                </Button>
              </div>
              
              <input type="file" id="import-file-input" style={{ display: 'none' }} onChange={handleImportFile} accept=".zip,.json" />
              
              {/* Selection Actions - Always visible to prevent layout jump */}
              <div className={cn(
                "flex items-center justify-between gap-2 p-1.5 rounded-md transition-all",
                selectedItems.size > 0 ? "bg-muted/30" : "bg-transparent"
              )}>
                <Badge 
                  variant="secondary" 
                  className={cn(
                    "text-[10px] h-6 rounded-full px-2 transition-opacity",
                    selectedItems.size === 0 && "opacity-40"
                  )}
                >
                  {selectedItems.size}
                </Badge>
                <ButtonGroup>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={handleBulkExport}
                    disabled={selectedItems.size === 0}
                    className="h-6 px-2 text-[10px]"
                  >
                    <Download className="h-3 w-3" /> 
                  </Button>
                  <ButtonGroupSeparator />
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={handleBulkDelete}
                    disabled={selectedItems.size === 0}
                    className="h-6 px-2 text-[10px] text-red-600 hover:text-red-700"
                  >
                    <Trash2 className="h-3 w-3" /> 
                  </Button>
                  <ButtonGroupSeparator />
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => setSelectedItems(new Set())}
                    disabled={selectedItems.size === 0}
                    className="h-6 w-6 p-0"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </ButtonGroup>
              </div>
            </div>
          ) : (
            /* Desktop Layout - With button groups */
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex flex-wrap gap-2">
                {/* Upload + URL + Sources group */}
                <ButtonGroup>
                  <Button 
                    variant="outline" 
                    onClick={() => { setCreateDialogMode('individual'); setCreateDialogInitialFocus('file'); setIsCreateDialogOpen(true); }} 
                    className="h-8 px-3 text-xs"
                  >
                    <Upload className="h-3.5 w-3.5 mr-1.5" /> 
                    Upload
                  </Button>
                  <Button 
                    variant="outline" 
                    onClick={() => { setCreateDialogMode('individual'); setCreateDialogInitialFocus('url'); setIsCreateDialogOpen(true); }} 
                    className="h-8 px-3 text-xs"
                  >
                    <LinkIcon className="h-3.5 w-3.5 mr-1.5" /> 
                    URL
                  </Button>
                  <Button 
                    variant="outline" 
                    onClick={() => setShowDataSourceManager(true)} 
                    className="h-8 px-3 text-xs"
                  >
                    <RadioTower className="h-3.5 w-3.5 mr-1.5" /> 
                    Sources
                  </Button>
                </ButtonGroup>
                
                {/* Article + Folder group */}
                <ButtonGroup>
                  <Button 
                    variant="outline" 
                    onClick={handleCreateArticle} 
                    className="h-8 px-3 text-xs"
                  >
                    <FileText className="h-3.5 w-3.5 mr-1.5" /> 
                    Article
                  </Button>
                  <Button 
                    variant="outline" 
                    onClick={handleCreateEmptyBundle} 
                    className="h-8 px-3 text-xs"
                  >
                    <FolderPlus className="h-3.5 w-3.5 mr-1.5" /> 
                    Folder
                  </Button>
                </ButtonGroup>
                
                {/* Import - standalone */}
                <Button 
                  variant="outline" 
                  onClick={() => document.getElementById('import-file-input')?.click()} 
                  className="h-8 px-3 text-xs"
                >
                  <Download className="h-3.5 w-3.5 mr-1.5" /> 
                  Import
                </Button>
                
                <input type="file" id="import-file-input" style={{ display: 'none' }} onChange={handleImportFile} accept=".zip,.json" />
              </div>
              {/* Selection Actions - Always visible to prevent layout jump */}
              <div className="flex items-center gap-2">
                <Badge 
                  variant="secondary" 
                  className={cn(
                    "text-xs h-7 px-2.5 transition-opacity",
                    selectedItems.size === 0 && "opacity-40"
                  )}
                >
                  {selectedItems.size}
                </Badge>
                <ButtonGroup>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={handleBulkExport}
                    disabled={selectedItems.size === 0}
                    className="h-7 px-2.5 text-xs"
                  >
                    <Download className="h-3.5 w-3.5 mr-1" /> 
                    Export
                  </Button>
                  <ButtonGroupSeparator />
                  <AssetTransferPopover selectedItems={transferItems} onComplete={() => setSelectedItems(new Set())} />
                  <ButtonGroupSeparator />
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={handleBulkDelete}
                    disabled={selectedItems.size === 0}
                    className="h-7 px-2.5 text-xs text-red-600 hover:text-red-700"
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" /> 
                    Delete
                  </Button>
                  <ButtonGroupSeparator />
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => setSelectedItems(new Set())}
                    disabled={selectedItems.size === 0}
                    className="h-7 w-7 p-0"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </ButtonGroup>
              </div>
            </div>
          )}
        </div>

        {/* Main Content */}
        <div className="flex-1 min-h-0 min-w-0 overflow-hidden p-1 pb-3 backdrop-blur">
          {isMobile ? (
            /* Mobile Layout - Tree view with side sheet for details */
            <>
              <div className="h-full w-full min-w-0 overflow-hidden mb-4 md:mb-0">
                <AssetSelector
                  selectedItems={selectedItems}
                  onSelectionChange={setSelectedItems}
                  onItemView={handleItemView}
                  onItemDoubleClick={handleItemDoubleClick}
                  renderItemActions={renderItemActions}
                  onSearchTermChange={setSearchTermFromSelector}
                />
              </div>
              
              {/* Mobile Detail Sheet - slides in from right */}
              <Sheet open={showMobileDetail} onOpenChange={setShowMobileDetail}>
                <SheetContent side="right" className="w-full sm:w-full flex flex-col p-0">
                  
                  <div className="flex-1 mt-10 overflow-y-auto scrollbar-hide">
                    {activeDetail?.type === 'asset' ? (
                      <AssetDetailView
                        selectedAssetId={activeDetail.id}
                        highlightAssetIdOnOpen={highlightAssetId}
                        onEdit={handleEditAsset}
                        schemas={[]}
                        onLoadIntoRunner={onLoadIntoRunner}
                      />
                    ) : activeDetail?.type === 'bundle' ? (
                      <BundleDetailView
                        selectedBundleId={activeDetail.id}
                        onLoadIntoRunner={onLoadIntoRunner}
                        selectedAssetId={selectedAssetInBundle}
                        onAssetSelect={setSelectedAssetInBundle}
                        highlightAssetId={highlightAssetId}
                      />
                    ) : (
                      /* Feed View for mobile when opened without detail */
                      <AssetFeedView
                        items={semanticSearchEnabled && semanticFeedItems.length > 0 ? semanticFeedItems : undefined}
                        infospaceId={semanticSearchEnabled && semanticFeedItems.length > 0 ? undefined : activeInfospace?.id}
                        availableKinds={assetKinds}
                        layout="list"
                        onAssetClick={(asset) => {
                          setActiveDetail({ type: 'asset', id: asset.id });
                        }}
                        title={semanticSearchEnabled && semanticFeedItems.length > 0 ? `Search Results (${semanticFeedItems.length})` : "Recent Items"}
                        cardSize="sm"
                        columns={2}
                        emptyMessage={semanticSearchEnabled ? "No results found." : "No items yet."}
                      />
                    )}
                  </div>
                </SheetContent>
              </Sheet>
            </>
          ) : (
            /* Desktop Layout - Resizable panels */
            <ResizablePanelGroup direction="horizontal" className="h-full w-full min-w-0 mx-auto rounded-lg border-primary/60 overflow-hidden">
              <ResizablePanel 
                defaultSize={55} 
                minSize={20} 
                maxSize={80} 
                className="overflow-hidden min-w-0"
              >
                <div className="h-full w-full overflow-hidden min-w-0">
                  <AssetSelector
                    selectedItems={selectedItems}
                    onSelectionChange={setSelectedItems}
                    onItemView={handleItemView}
                    onItemDoubleClick={handleItemDoubleClick}
                    renderItemActions={renderItemActions}
                    onSearchTermChange={setSearchTermFromSelector}
                  />
                </div>
              </ResizablePanel>

              <ResizableHandle withHandle className="bg-border" />

              <ResizablePanel 
                defaultSize={45} 
                minSize={20} 
                maxSize={80}
                className="overflow-hidden"
              >
                <div className="h-full w-full border-l overflow-hidden flex flex-col">
                  {activeDetail?.type === 'asset' ? (
                    <>
                      {/* Back to Feed button */}
                      <div className="flex-none px-4 py-2 flex items-center gap-2 border-b">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setActiveDetail(null);
                            setHighlightAssetId(null);
                          }}
                          className="h-7 px-2 text-xs gap-1"
                          title="Back to Home Feed View"
                        >
                          <ChevronLeft className="h-4 w-4" />
                          <span className="hidden sm:inline">Back to Home Feed</span>
                        </Button>
                      </div>
                      <div className="flex-1 overflow-hidden">
                        <AssetDetailView
                          selectedAssetId={activeDetail.id}
                          highlightAssetIdOnOpen={highlightAssetId}
                          onEdit={handleEditAsset}
                          schemas={[]}
                          onLoadIntoRunner={onLoadIntoRunner}
                        />
                      </div>
                    </>
                  ) : activeDetail?.type === 'bundle' ? (
                    <>
                      {/* Back to Feed button */}
                      <div className="flex-none px-4 py-2 flex items-center gap-2 border-b">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setActiveDetail(null);
                            setSelectedAssetInBundle(null);
                            setHighlightAssetId(null);
                          }}
                          className="h-7 px-2 text-xs gap-1"
                          title="Back to Home Feed View"
                        >
                          <ChevronLeft className="h-4 w-4" />
                          <span className="hidden sm:inline">Back to Home Feed</span>
                        </Button>
                      </div>
                      <div className="flex-1 overflow-hidden">
                        <BundleDetailView
                          selectedBundleId={activeDetail.id}
                          onLoadIntoRunner={onLoadIntoRunner}
                          selectedAssetId={selectedAssetInBundle}
                          onAssetSelect={setSelectedAssetInBundle}
                          highlightAssetId={highlightAssetId}
                        />
                      </div>
                    </>
                  ) : (
                    /* Feed View - shown when no item is selected */
                    <AssetFeedView
                      items={semanticSearchEnabled && semanticFeedItems.length > 0 ? semanticFeedItems : undefined}
                      infospaceId={semanticSearchEnabled && semanticFeedItems.length > 0 ? undefined : activeInfospace?.id}
                      availableKinds={assetKinds}
                      onAssetClick={(asset) => {
                        setActiveDetail({ type: 'asset', id: asset.id });
                        setHighlightAssetId(null);
                      }}
                      title={"latest"}
                      cardSize="md"
                      columns="auto"
                      layout="bento"
                      emptyMessage={semanticSearchEnabled ? "No results found." : "No items yet. Add some content to see them here."}
                    />
                  )}
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          )}
        </div>

        {/* Dialogs */}
        <CreateAssetDialog open={isCreateDialogOpen} onClose={() => { setIsCreateDialogOpen(false); setUploadToBundle(null); setCreateDialogInitialFocus(undefined); }} mode={createDialogMode} initialFocus={createDialogInitialFocus} existingBundleId={uploadToBundle?.id} existingBundleName={uploadToBundle?.name} />
        <CreateBundleDialog open={isCreateBundleOpen} onClose={() => setIsCreateBundleOpen(false)} />
        <ArticleComposer 
          open={isArticleComposerOpen} 
          onClose={() => {
            setIsArticleComposerOpen(false);
            setEditingArticleId(undefined);
          }} 
          mode={articleComposerMode}
          existingAssetId={editingArticleId}
        />
        {sharingItem && <ShareItemDialog item={sharingItem} onClose={() => setSharingItem(null)} />}
        {editingAsset && <EditAssetOverlay open={true} onClose={() => setEditingAsset(null)} asset={editingAsset} onSave={handleSaveAsset} />}
        {editingBundle && <BundleEditDialog open={true} onClose={() => setEditingBundle(null)} bundle={editingBundle} onSave={handleSaveBundle} />}

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={deleteConfirmation.isOpen} onOpenChange={(open) => !open && setDeleteConfirmation({ type: 'asset', items: [], isOpen: false })}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm Deletion</AlertDialogTitle>
              <AlertDialogDescription>
                {(() => {
                  const { items } = deleteConfirmation;
                  const count = items.length;
                  const assets = items.filter(item => 'kind' in item);
                  const bundles = items.filter(item => 'name' in item && !('kind' in item));
                  if (count === 1) {
                      if (assets.length === 1) return `Are you sure you want to delete the asset "${(assets[0] as AssetRead).title}"? This cannot be undone.`;
                      if (bundles.length === 1) return `Are you sure you want to delete the folder "${(bundles[0] as BundleRead).name}"? Assets inside will NOT be deleted. This cannot be undone.`;
                  }
                  let message = `Are you sure you want to delete ${items.length} items?`;
                  if (bundles.length > 0) message += ` Assets inside folders will NOT be deleted.`;
                  message += ` This action cannot be undone.`;
                  return message;
                })()}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={executeDelete} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TextSpanHighlightProvider>
  );
}