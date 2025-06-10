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
  Rows,
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
} from '@/client/models';
import { useAssetStore } from '@/zustand_stores/storeAssets';
import { useBundleStore } from '@/zustand_stores/storeBundles';
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
import AssetCardComponent from './Views/AssetCardComponent';

type SortKey = 'name' | 'updated_at' | 'kind';
type SortDirection = 'asc' | 'desc';

// Simplified tree item types - bundles are now just folders
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

// Asset kind icon mapping
const getAssetIcon = (kind: AssetKind, className?: string) => {
  const iconClass = cn("h-4 w-4", className);
  switch (kind) {
    case 'pdf': return <FileText className={cn(iconClass, "text-red-600")} />;
    case 'csv': return <FileSpreadsheet className={cn(iconClass, "text-green-600")} />;
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

const formatAssetKind = (kind: AssetKind): string => {
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

const getAssetBadgeClass = (kind: AssetKind): string => {
  switch (kind) {
    case 'pdf': return "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/50 dark:text-red-300 dark:border-red-800";
    case 'csv': return "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/50 dark:text-green-300 dark:border-green-800";
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

interface AssetManagerProps {
  onLoadIntoRunner?: (runId: number, runName: string) => void;
}

export default function AssetManager({ onLoadIntoRunner }: AssetManagerProps) {
  const { activeInfospace } = useInfospaceStore();
  const {
    assets,
    fetchAssets,
    isLoading: isLoadingAssets,
    error: assetError,
    deleteAsset,
    fetchChildAssets,
    updateAsset,
  } = useAssetStore();
  
  const {
    bundles,
    fetchBundles,
    isLoading: isLoadingBundles,
    error: bundleError,
    deleteBundle,
    getBundleAssets,
    addAssetToBundle,
    removeAssetFromBundle,
  } = useBundleStore();

  // UI State
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearchTerm = useDebounce(searchTerm, 300);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [activeDetail, setActiveDetail] = useState<{ type: 'asset' | 'bundle'; id: number } | null>(null);
  const [selectedAssetInBundle, setSelectedAssetInBundle] = useState<number | null>(null);
  const [highlightAssetId, setHighlightAssetId] = useState<number | null>(null);
  const [assetTypeFilter, setAssetTypeFilter] = useState<AssetKind | 'all'>('all');
  const [sortOption, setSortOption] = useState('updated_at-desc');
  
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
  
  // Data fetching state
  const [bundleAssets, setBundleAssets] = useState<Map<number, AssetRead[]>>(new Map());
  const [childAssets, setChildAssets] = useState<Map<number, AssetRead[]>>(new Map());
  const [isLoadingChildren, setIsLoadingChildren] = useState<Set<number>>(new Set());

  // Drag and drop state
  const [draggedOverBundleId, setDraggedOverBundleId] = useState<string | null>(null);

  // View mode state
  const [viewMode, setViewMode] = useState<'list' | 'card'>('list');
  const [cardViewFolder, setCardViewFolder] = useState<AssetTreeItem | null>(null);

  // Delete confirmation dialog state
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    type: 'asset' | 'bundle' | 'bulk-assets' | 'bulk-bundles';
    items: (AssetRead | BundleRead)[];
    isOpen: boolean;
  }>({ type: 'asset', items: [], isOpen: false });
  
  // Transfer dialog state
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [transferItems, setTransferItems] = useState<(AssetRead | BundleRead)[]>([]);

  // Upload to existing bundle state
  const [uploadToBundle, setUploadToBundle] = useState<BundleRead | null>(null);

  const fetchingRef = useRef(false);

  // Fetch data when infospace changes
  useEffect(() => {
    if (activeInfospace?.id && !fetchingRef.current) {
      fetchingRef.current = true;
      console.log('Fetching assets and bundles for infospace:', activeInfospace.id);
      Promise.allSettled([
        fetchAssets(),
        fetchBundles(activeInfospace.id),
      ]).then((results) => {
        console.log('Fetch results:', results);
        console.log('Assets:', assets.length);
        console.log('Bundles:', bundles.length);
      }).finally(() => {
        fetchingRef.current = false;
      });
    }
  }, [activeInfospace?.id, fetchAssets, fetchBundles]);

  // Memoized asset kinds for filter dropdown
  const assetKinds = useMemo(() => {
    const kinds = new Set<AssetKind>();
    assets.forEach(asset => kinds.add(asset.kind));
    return Array.from(kinds).sort();
  }, [assets]);

  // Fetch bundle assets when bundles change
  useEffect(() => {
    console.log('Bundles changed, count:', bundles.length);
    bundles.forEach(async (bundle) => {
      console.log('Processing bundle:', bundle.name, bundle.id);
      if (!bundleAssets.has(bundle.id)) {
        try {
          const assets = await getBundleAssets(bundle.id);
          console.log(`Bundle ${bundle.name} has ${assets.length} assets`);
          setBundleAssets(prev => new Map(prev.set(bundle.id, assets)));
        } catch (error) {
          console.error(`Failed to fetch assets for bundle ${bundle.id}:`, error);
        }
      }
    });
  }, [bundles, bundleAssets, getBundleAssets]);

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
        await useBundleStore.getState().updateBundle(bundleId, { name: value });
        toast.success(`Bundle updated.`);
      } catch (error) {
        console.error('Error updating bundle:', error);
        toast.error('Failed to update bundle.');
      }
    }
  }, [editingItem, updateAsset]);

  const handleCancelEdit = () => {
    setEditingItem(null);
  };

  // Generate hierarchical asset tree
  const assetTree = useMemo(() => {
    const tree: AssetTreeItem[] = [];
    
    console.log('Generating asset tree with:', { 
      assetsCount: assets.length, 
      bundlesCount: bundles.length,
      bundleAssetsKeys: Array.from(bundleAssets.keys())
    });
    
    // Get individual assets (not in any bundle)
    const bundledAssetIds = new Set();
    bundles.forEach(bundle => {
      const bundleAssetList = bundleAssets.get(bundle.id) || [];
      bundleAssetList.forEach(asset => bundledAssetIds.add(asset.id));
    });
    
    const individualAssets = assets.filter(asset => 
      !asset.parent_asset_id && !bundledAssetIds.has(asset.id)
    );

    // Add bundles as folders FIRST (so they appear at the top)
    bundles.forEach(bundle => {
      const bundleAssetList = bundleAssets.get(bundle.id) || [];
      console.log(`Adding bundle "${bundle.name}" with ${bundleAssetList.length} assets`);
      const bundleItem: AssetTreeItem = {
        id: `bundle-${bundle.id}`,
        type: 'folder',
        name: bundle.name,
        bundle,
        level: 0,
        isExpanded: expandedItems.has(`bundle-${bundle.id}`),
        isSelected: selectedItems.has(`bundle-${bundle.id}`),
        isContainer: true,
        children: bundleAssetList.map(asset => {
          const assetChildren = childAssets.get(asset.id) || [];
          return {
            id: `asset-${asset.id}`,
            type: 'asset',
            name: asset.title,
            asset,
            level: 1,
            isExpanded: expandedItems.has(`asset-${asset.id}`),
            isSelected: selectedItems.has(`asset-${asset.id}`),
            parentId: `bundle-${bundle.id}`,
            isContainer: asset.is_container,
            children: assetChildren.length > 0 ? assetChildren.map(childAsset => ({
              id: `child-${childAsset.id}`,
              type: 'asset',
              name: childAsset.title,
              asset: childAsset,
              level: 2,
              isExpanded: false,
              isSelected: selectedItems.has(`child-${childAsset.id}`),
              parentId: `asset-${asset.id}`,
            })) : undefined,
          };
        }),
      };
      tree.push(bundleItem);
    });

    // Add individual assets after bundles
    individualAssets.forEach(asset => {
      const assetChildren = childAssets.get(asset.id) || [];
      tree.push({
        id: `asset-${asset.id}`,
        type: 'asset',
        name: asset.title,
        asset,
        level: 0,
        isExpanded: expandedItems.has(`asset-${asset.id}`),
        isSelected: selectedItems.has(`asset-${asset.id}`),
        isContainer: asset.is_container,
        children: assetChildren.length > 0 ? assetChildren.map(childAsset => ({
          id: `child-${childAsset.id}`,
          type: 'asset',
          name: childAsset.title,
          asset: childAsset,
          level: 1,
          isExpanded: false,
          isSelected: selectedItems.has(`child-${childAsset.id}`),
          parentId: `asset-${asset.id}`,
        })) : undefined,
      });
    });

    console.log('Generated tree items:', tree.length);

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
  }, [assets, bundles, bundleAssets, childAssets, expandedItems, selectedItems, sortOption]);

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

  // Handle item expansion
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

    // Move async operation outside of state setter to avoid setState during render
    if (!isCurrentlyExpanded && itemId.startsWith('asset-')) {
      const assetId = parseInt(itemId.replace('asset-', ''));
      const asset = assets.find(a => a.id === assetId);
      if (asset && asset.is_container && !childAssets.has(assetId)) {
        setIsLoadingChildren(prev => new Set([...prev, assetId]));
        try {
          const children = await fetchChildAssets(assetId);
          if (children) {
            setChildAssets(prev => new Map(prev.set(assetId, children)));
          }
        } catch (error) {
          console.error(`Failed to fetch children for asset ${assetId}:`, error);
        } finally {
          setIsLoadingChildren(prev => {
            const newSet = new Set(prev);
            newSet.delete(assetId);
            return newSet;
          });
        }
      }
    }
  }, [assets, childAssets, fetchChildAssets, expandedItems]);

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
  const handleAssetView = useCallback((asset: AssetRead) => {
    if (asset.parent_asset_id) {
      setActiveDetail({ type: 'asset', id: asset.parent_asset_id });
      setHighlightAssetId(asset.id);
    } else {
      setActiveDetail({ type: 'asset', id: asset.id });
      setHighlightAssetId(null);
    }
  }, []);

  // Handle item double click (for card view navigation)
  const handleItemDoubleClick = useCallback((item: AssetTreeItem) => {
    if (item.type === 'folder') {
      setCardViewFolder(item);
      setSelectedItems(new Set()); // Clear selection on navigation
    } else if (item.asset) {
      handleAssetView(item.asset);
    }
  }, [handleAssetView]);

  // Handle item view (for card view single click - similar to list view)
  const handleItemView = useCallback((item: AssetTreeItem) => {
    if (item.type === 'folder' && item.bundle) {
      setActiveDetail({ type: 'bundle', id: item.bundle.id });
    } else if (item.asset) {
      handleAssetView(item.asset);
    }
  }, [handleAssetView]);

  // Bulk select all assets in a bundle
  const toggleBundleSelection = useCallback((bundleId: number, select: boolean) => {
    const bundleAssetList = bundleAssets.get(bundleId) || [];
    setSelectedItems(prev => {
      const newSet = new Set(prev);
      const bundleItemId = `bundle-${bundleId}`;
      
      if (select) {
        // Select bundle and all its assets
        newSet.add(bundleItemId);
        bundleAssetList.forEach(asset => {
          newSet.add(`asset-${asset.id}`);
          // Also select child assets if any
          const children = childAssets.get(asset.id) || [];
          children.forEach(child => newSet.add(`child-${child.id}`));
        });
      } else {
        // Deselect bundle and all its assets
        newSet.delete(bundleItemId);
        bundleAssetList.forEach(asset => {
          newSet.delete(`asset-${asset.id}`);
          // Also deselect child assets if any
          const children = childAssets.get(asset.id) || [];
          children.forEach(child => newSet.delete(`child-${child.id}`));
        });
      }
      
      return newSet;
    });
  }, [bundleAssets, childAssets]);

  // Check if all assets in a bundle are selected
  const isBundleFullySelected = useCallback((bundleId: number) => {
    const bundleAssetList = bundleAssets.get(bundleId) || [];
    const bundleItemId = `bundle-${bundleId}`;
    
    if (!selectedItems.has(bundleItemId)) return false;
    
    return bundleAssetList.every(asset => {
      const assetSelected = selectedItems.has(`asset-${asset.id}`);
      const children = childAssets.get(asset.id) || [];
      const childrenSelected = children.length === 0 || children.every(child => selectedItems.has(`child-${child.id}`));
      return assetSelected && childrenSelected;
    });
  }, [selectedItems, bundleAssets, childAssets]);

  // Check if a bundle is partially selected
  const isBundlePartiallySelected = useCallback((bundleId: number) => {
    const bundleAssetList = bundleAssets.get(bundleId) || [];
    const bundleItemId = `bundle-${bundleId}`;
    
    if (selectedItems.has(bundleItemId)) return false; // Fully selected, not partial
    
    return bundleAssetList.some(asset => {
      const assetSelected = selectedItems.has(`asset-${asset.id}`);
      const children = childAssets.get(asset.id) || [];
      const someChildrenSelected = children.some(child => selectedItems.has(`child-${child.id}`));
      return assetSelected || someChildrenSelected;
    });
  }, [selectedItems, bundleAssets, childAssets]);

  // Drag and drop handler for bundles
  const handleDropOnBundle = useCallback(async (bundleItem: AssetTreeItem, e: React.DragEvent) => {
    if (!bundleItem.bundle) return;
    setDraggedOverBundleId(null);
    const data = e.dataTransfer.getData('application/json');
    if (!data) return;

    try {
        const { type, items: draggedAssets } = JSON.parse(data) as { type: string; items: AssetRead[] };
        if (type !== 'assets' || !Array.isArray(draggedAssets)) return;

        toast.info(`Moving ${draggedAssets.length} asset(s) to "${bundleItem.name}"...`);

        const destinationBundleId = bundleItem.bundle.id;
        const sourceBundleIds = new Set<number>();

        const moveOperations = draggedAssets.map(asset => {
            let sourceBundleId: number | null = null;
            for (const [bundleId, assetsInBundle] of bundleAssets.entries()) {
                if (assetsInBundle.some(a => a.id === asset.id)) {
                    sourceBundleId = bundleId;
                    break;
                }
            }
            return { asset, sourceBundleId };
        });

        const promises: Promise<any>[] = [];
        
        moveOperations.forEach(({ asset, sourceBundleId }) => {
            if (sourceBundleId && sourceBundleId !== destinationBundleId) {
                promises.push(removeAssetFromBundle(sourceBundleId, asset.id));
                sourceBundleIds.add(sourceBundleId);
            }
            promises.push(addAssetToBundle(destinationBundleId, asset.id));
        });

        await Promise.all(promises);
        
        toast.success(`Successfully moved ${draggedAssets.length} asset(s) to bundle.`);
        
        const bundlesToRefresh = new Set([...sourceBundleIds, destinationBundleId]);

        const refreshPromises = Array.from(bundlesToRefresh).map(async (bundleId) => {
            try {
                const assets = await getBundleAssets(bundleId);
                return { bundleId, assets };
            } catch (error) {
                console.error(`Failed to refresh assets for bundle ${bundleId}`, error);
                return { bundleId, assets: bundleAssets.get(bundleId) || [] };
            }
        });

        const refreshedData = await Promise.all(refreshPromises);

        setBundleAssets(prev => {
            const newMap = new Map(prev);
            refreshedData.forEach(({ bundleId, assets }) => {
                newMap.set(bundleId, assets);
            });
            return newMap;
        });

    } catch (error) {
        console.error('Drop error:', error);
        toast.error('Failed to move assets.');
    }
  }, [addAssetToBundle, removeAssetFromBundle, getBundleAssets, bundleAssets]);

  // Enhanced asset and bundle management methods
  const handleDeleteAsset = useCallback(async (asset: AssetRead, skipConfirmation = false) => {
    if (!skipConfirmation) {
      setDeleteConfirmation({
        type: 'asset',
        items: [asset],
        isOpen: true
      });
      return;
    }

    try {
      await deleteAsset(asset.id);
      toast.success(`Asset "${asset.title}" deleted successfully.`);
      if (activeDetail?.type === 'asset' && activeDetail.id === asset.id) {
        setActiveDetail(null);
      }
    } catch (error) {
      console.error('Error deleting asset:', error);
      toast.error('Failed to delete asset.');
    }
  }, [deleteAsset, activeDetail]);

  // Enhanced bundle deletion
  const handleDeleteBundle = useCallback(async (bundle: BundleRead, skipConfirmation = false) => {
    if (!skipConfirmation) {
      setDeleteConfirmation({
        type: 'bundle',
        items: [bundle],
        isOpen: true
      });
      return;
    }

    try {
      await deleteBundle(bundle.id);
      toast.success(`Bundle "${bundle.name}" deleted successfully.`);
      if (activeDetail?.type === 'bundle' && activeDetail.id === bundle.id) {
        setActiveDetail(null);
      }
    } catch (error) {
      console.error('Error deleting bundle:', error);
      toast.error('Failed to delete bundle.');
    }
  }, [deleteBundle, activeDetail]);

  // Bulk delete functionality
  const handleBulkDelete = useCallback(() => {
    const selectedBundles: BundleRead[] = [];
    const selectedAssets: AssetRead[] = [];

    selectedItems.forEach(itemId => {
      if (itemId.startsWith('bundle-')) {
        const bundleId = parseInt(itemId.replace('bundle-', ''));
        const bundle = bundles.find(b => b.id === bundleId);
        if (bundle) selectedBundles.push(bundle);
      } else if (itemId.startsWith('asset-')) {
        const assetId = parseInt(itemId.replace('asset-', ''));
        const asset = assets.find(a => a.id === assetId);
        if (asset) selectedAssets.push(asset);
      }
    });

    if (selectedBundles.length > 0 && selectedAssets.length > 0) {
      // Mixed selection - show combined dialog
      setDeleteConfirmation({
        type: 'bulk-assets', // We'll handle mixed in the dialog
        items: [...selectedAssets, ...selectedBundles],
        isOpen: true
      });
    } else if (selectedBundles.length > 0) {
      setDeleteConfirmation({
        type: 'bulk-bundles',
        items: selectedBundles,
        isOpen: true
      });
    } else if (selectedAssets.length > 0) {
      setDeleteConfirmation({
        type: 'bulk-assets',
        items: selectedAssets,
        isOpen: true
      });
    }
  }, [selectedItems, bundles, assets]);

  // Execute confirmed deletion
  const executeDelete = useCallback(async () => {
    const { type, items } = deleteConfirmation;
    
    try {
      if (type === 'asset') {
        const asset = items[0] as AssetRead;
        await handleDeleteAsset(asset, true);
      } else if (type === 'bundle') {
        const bundle = items[0] as BundleRead;
        await handleDeleteBundle(bundle, true);
      } else {
        // Bulk operations
        const assets = items.filter(item => 'kind' in item) as AssetRead[];
        const bundles = items.filter(item => 'name' in item && !('kind' in item)) as BundleRead[];
        
        const promises: Promise<any>[] = [];
        
        // Delete all assets
        assets.forEach(asset => {
          promises.push(handleDeleteAsset(asset, true));
        });
        
        // Delete all bundles
        bundles.forEach(bundle => {
          promises.push(handleDeleteBundle(bundle, true));
        });
        
        await Promise.all(promises);
        
        const totalCount = assets.length + bundles.length;
        toast.success(`Successfully deleted ${totalCount} item${totalCount > 1 ? 's' : ''}.`);
        
        // Clear selection and active detail
        setSelectedItems(new Set());
        setActiveDetail(null);
      }
    } catch (error) {
      console.error('Error during bulk delete:', error);
      toast.error('Some items could not be deleted.');
    } finally {
      setDeleteConfirmation({ type: 'asset', items: [], isOpen: false });
    }
  }, [deleteConfirmation, handleDeleteAsset, handleDeleteBundle]);

  // Asset editing
  const handleEditAsset = useCallback((asset: AssetRead) => {
    setEditingAsset(asset);
  }, []);

  const handleSaveAsset = useCallback(async (assetId: number, updateData: any) => {
    await updateAsset(assetId, updateData);
  }, [updateAsset]);

  // Bundle editing
  const handleEditBundle = useCallback((bundle: BundleRead) => {
    setEditingBundle(bundle);
  }, []);

  const handleSaveBundle = useCallback(async (bundleId: number, updateData: { name?: string; description?: string }) => {
    try {
      const { updateBundle } = useBundleStore.getState();
      await updateBundle(bundleId, updateData);
      setEditingBundle(null);
      toast.success('Bundle updated successfully.');
    } catch (error) {
      console.error('Error updating bundle:', error);
      toast.error('Failed to update bundle.');
    }
  }, []);

  // Create empty bundle
  const handleCreateEmptyBundle = useCallback(() => {
    setIsCreateBundleOpen(true);
  }, []);

  // Upload to existing bundle
  const handleUploadToBundle = useCallback((bundle: BundleRead) => {
    setUploadToBundle(bundle);
    setCreateDialogMode('bundle');
    setIsCreateDialogOpen(true);
  }, []);

  // Transfer functionality - enhanced to work with mixed items
  const handleTransferItems = useCallback(() => {
    const transferItems: Array<{ id: number; type: 'asset' | 'bundle'; title: string }> = [];
    
    selectedItems.forEach(itemId => {
      if (itemId.startsWith('bundle-')) {
        const bundleId = parseInt(itemId.replace('bundle-', ''));
        const bundle = bundles.find(b => b.id === bundleId);
        if (bundle) {
          transferItems.push({
            id: bundle.id,
            type: 'bundle',
            title: bundle.name
          });
        }
      } else if (itemId.startsWith('asset-')) {
        const assetId = parseInt(itemId.replace('asset-', ''));
        const asset = assets.find(a => a.id === assetId);
        if (asset) {
          transferItems.push({
            id: asset.id,
            type: 'asset',
            title: asset.title
          });
        }
      }
    });

    return transferItems;
  }, [selectedItems, bundles, assets]);

  // Generate indentation style based on level
  const getIndentationStyle = (level: number) => ({
    paddingLeft: `${level * 1.5}rem`
  });

  // Render asset tree item
  const renderTreeItem = useCallback((item: AssetTreeItem) => {
    const hasChildren = item.children && item.children.length > 0;
    const canExpand = hasChildren || (item.asset?.is_container && item.type === 'asset');
    const isLoading = item.asset && isLoadingChildren.has(item.asset.id);
    const isFolder = item.type === 'folder';
    const isEditing = editingItem?.id === item.id;
    const isDragOver = draggedOverBundleId === item.id;
    
    // Special handling for bundle headers
    if (item.type === 'folder' && item.bundle) {
      const bundleId = item.bundle.id;
      const isFullySelected = isBundleFullySelected(bundleId);
      const isPartiallySelected = isBundlePartiallySelected(bundleId);
      
      return (
        <div key={item.id}>
          <div
            className={cn(
              "group flex items-center gap-2 py-2 px-3 hover:bg-muted cursor-pointer transition-colors",
              "border-t border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50",
              (isFullySelected || item.isSelected) && "bg-blue-100 dark:bg-blue-900/80 border-l-4 border-blue-500 !border-y-blue-500/50",
              isDragOver && "bg-blue-100 dark:bg-blue-900 ring-1 ring-blue-500"
            )}
            style={getIndentationStyle(item.level)}
            onClick={(e) => { e.stopPropagation(); toggleExpanded(item.id); }}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDraggedOverBundleId(item.id); }}
            onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDraggedOverBundleId(null); }}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleDropOnBundle(item, e); }}
          >
            {/* Expand/Collapse button */}
            <div className="w-4 h-4 flex items-center justify-center">
              {canExpand && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-4 w-4 p-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleExpanded(item.id);
                  }}
                >
                  {isLoading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : item.isExpanded ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                </Button>
              )}
            </div>

            {/* Bundle selection checkbox - selects all assets in bundle */}
            <Checkbox
              checked={isFullySelected || isPartiallySelected}
              onCheckedChange={(checked) => toggleBundleSelection(bundleId, !!checked)}
              onClick={(e) => e.stopPropagation()}
              className={cn(
                "h-4 w-4",
                isPartiallySelected && !isFullySelected && "data-[state=checked]:bg-primary/50"
              )}
              title={isFullySelected ? "Deselect all items in bundle" : "Select all items in bundle"}
            />

            {/* Bundle icon */}
            <div className="w-4 h-4 flex items-center justify-center">
              {item.isExpanded ? 
                <FolderOpen className="h-4 w-4 text-blue-600" /> : 
                <Folder className="h-4 w-4 text-blue-600" />
              }
            </div>

            {/* Bundle name and metadata */}
            <div 
              className="flex-1 min-w-0"
              onDoubleClick={(e) => { e.stopPropagation(); handleEditItem(item); }}
            >
              <div className="flex items-center gap-2">
                {isEditing ? (
                  <div className="flex items-center gap-1">
                    <Input
                      value={editingItem.value}
                      onChange={(e) => setEditingItem({ ...editingItem, value: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveEditing();
                        if (e.key === 'Escape') handleCancelEdit();
                      }}
                      autoFocus
                      className="h-7 text-sm"
                      onClick={(e) => e.stopPropagation()}
                    />
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); handleSaveEditing();}}>
                      <Check className="h-4 w-4 text-green-600"/>
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); handleCancelEdit();}}>
                      <X className="h-4 w-4 text-red-600"/>
                    </Button>
                  </div>
                ) : (
                  <span className="text-sm font-semibold truncate">{item.name}</span>
                )}
                {hasChildren && (
                  <Badge variant="secondary" className="text-xs">
                    {item.children?.length} items
                  </Badge>
                )}
              </div>
            </div>

            {/* Bundle actions - middle */}
            <div className="flex items-center justify-end gap-1 ml-auto opacity-0 group-hover:opacity-100 transition-opacity pl-4">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={(e) => {
                  e.stopPropagation();
                  if (item.bundle) setActiveDetail({ type: 'bundle', id: item.bundle.id });
                }}
                title="View Details"
              >
                <Eye className="h-4 w-4" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Bundle Actions</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => setActiveDetail({ type: 'bundle', id: item.bundle!.id })}>
                    <Eye className="mr-2 h-4 w-4" />
                    View Details
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleUploadToBundle(item.bundle!)}>
                    <Upload className="mr-2 h-4 w-4" />
                    Add Files
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleEditItem(item)}>
                    <Edit3 className="mr-2 h-4 w-4" />
                    Edit Name
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleEditBundle(item.bundle!)}>
                    <Settings className="mr-2 h-4 w-4" />
                    Edit Details
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <Share2 className="mr-2 h-4 w-4" />
                    Share Bundle
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <Download className="mr-2 h-4 w-4" />
                    Export Bundle
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem 
                    className="text-red-600"
                    onClick={() => handleDeleteBundle(item.bundle!)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete Folder
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Render children */}
          {item.isExpanded && item.children && (
            <div className="ml-4 border-l-2 border-slate-200 dark:border-slate-700 pl-0 space-y-0.5">
              {item.children.map(child => renderTreeItem(child))}
            </div>
          )}
        </div>
      );
    }
    
    // Regular asset rendering
    return (
      <div key={item.id}>
        <div
          className={cn(
            "group flex items-center gap-2.5 py-1.5 px-3 hover:bg-muted/50 cursor-pointer transition-colors rounded-md",
            item.isSelected && "bg-blue-50 dark:bg-blue-900/50 border-l-4 rounded-none border-blue-500"
          )}
          style={getIndentationStyle(item.level)}
          onClick={(e) => {
            e.stopPropagation();
            // Only view the asset on click, don't select it
            if (item.asset) {
              handleAssetView(item.asset);
            }
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (item.asset) {
              handleAssetView(item.asset);
            }
          }}
          draggable
          onDragStart={(e) => {
            e.stopPropagation();
            const draggedItem = item.asset;
            if (!draggedItem) return;

            const itemsToDrag = selectedItems.has(item.id) 
              ? Array.from(selectedItems)
                  .map(id => {
                    if (id.startsWith('asset-')) {
                      const assetId = parseInt(id.replace('asset-', ''));
                      return assets.find(a => a.id === assetId);
                    }
                    return null;
                  })
                  .filter((a): a is AssetRead => a !== null)
              : [draggedItem];
              
            e.dataTransfer.setData('application/json', JSON.stringify({
              type: 'assets',
              items: itemsToDrag
            }));
          }}
        >
          {/* Expand/Collapse button */}
          <div className="w-4 h-4 flex items-center justify-center">
            {canExpand && (
              <Button
                variant="ghost"
                size="sm"
                className="h-4 w-4 p-0"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleExpanded(item.id);
                }}
              >
                {isLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : item.isExpanded ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
              </Button>
            )}
          </div>

          {/* Selection checkbox */}
          <Checkbox
            checked={item.isSelected}
            onCheckedChange={() => toggleSelected(item.id, true)}
            onClick={(e) => e.stopPropagation()}
            className="h-4 w-4"
          />

          {/* Icon */}
          <div className="w-4 h-4 flex items-center justify-center">
            {isFolder ? (
              item.isExpanded ? 
                <FolderOpen className="h-4 w-4 text-blue-600" /> : 
                <Folder className="h-4 w-4 text-blue-600" />
            ) : (
              item.asset && getAssetIcon(item.asset.kind)
            )}
          </div>

          {/* Name and metadata */}
          <div className="flex-1 min-w-0 overflow-hidden" onDoubleClick={(e) => { e.stopPropagation(); handleEditItem(item); }}>
            <div className="flex items-center gap-1.5">
              {isEditing ? (
                  <div className="flex items-center gap-0.5">
                    <Input
                      value={editingItem.value}
                      onChange={(e) => setEditingItem({ ...editingItem, value: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveEditing();
                        if (e.key === 'Escape') handleCancelEdit();
                      }}
                      autoFocus
                      className="h-7 text-sm"
                      onClick={(e) => e.stopPropagation()}
                    />
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); handleSaveEditing();}}>
                      <Check className="h-4 w-4 text-green-600"/>
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); handleCancelEdit();}}>
                      <X className="h-4 w-4 text-red-600"/>
                    </Button>
                  </div>
                ) : (
                  <>
                    {item.asset && item.asset.kind && (
                      <Badge variant="outline" className={cn("text-xs flex-shrink-0", getAssetBadgeClass(item.asset.kind))}>
                        {formatAssetKind(item.asset.kind)}
                      </Badge>
                    )}
                    <span className="text-sm font-medium truncate">{item.name}</span>
                  </>
              )}
            </div>
          </div>

          {/* Right-aligned content */}
          <div className="flex items-center gap-4 ml-auto pl-4">
            {/* Timestamp */}
            {item.asset && (
              <div className="text-xs text-muted-foreground truncate hidden group-hover:block md:block">
                {formatDistanceToNow(new Date(item.asset.updated_at), { addSuffix: true })}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={(e) => {
                  e.stopPropagation();
                  if (item.asset) handleAssetView(item.asset);
                }}
                title="View Details"
              >
                <Eye className="h-4 w-4" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Actions</DropdownMenuLabel>
                  {item.asset && (
                    <>
                      <DropdownMenuItem onClick={() => handleAssetView(item.asset!)}>
                        <Eye className="mr-2 h-4 w-4" />
                        View Details
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleEditItem(item)}>
                        <Edit3 className="mr-2 h-4 w-4" />
                        Edit Name
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleEditAsset(item.asset!)}>
                        <Settings className="mr-2 h-4 w-4" />
                        Edit Details
                      </DropdownMenuItem>
                      <DropdownMenuItem>
                        <Share2 className="mr-2 h-4 w-4" />
                        Share
                      </DropdownMenuItem>
                      <DropdownMenuItem>
                        <Download className="mr-2 h-4 w-4" />
                        Export
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem 
                        className="text-red-600"
                        onClick={() => handleDeleteAsset(item.asset!)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete Asset
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        {/* Render children */}
        {item.isExpanded && item.children && (
          <div className="ml-4 border-l-2 border-slate-200 dark:border-slate-700 pl-2 space-y-1">
            {item.children.map(child => renderTreeItem(child))}
          </div>
        )}
      </div>
    );
  }, [toggleSelected, toggleExpanded, handleAssetView, handleEditItem, handleSaveEditing, handleCancelEdit, handleDeleteAsset, handleDeleteBundle, handleUploadToBundle, handleEditBundle, isLoadingChildren, toggleBundleSelection, isBundleFullySelected, isBundlePartiallySelected, editingItem, draggedOverBundleId, handleDropOnBundle, assets]);

  const itemsForView = useMemo(() => {
    if (viewMode === 'card' && cardViewFolder) {
      return cardViewFolder.children || [];
    }
    return filteredTree;
  }, [viewMode, cardViewFolder, filteredTree]);

  if (!activeInfospace) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-center text-muted-foreground">
          Please select an Infospace to manage assets.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full max-w-screen-3xl mx-auto px-1 sm:px-2 overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-start gap-2 border-b border-primary/80 pb-2">
        <div className="flex items-center gap-0"> 
          <FileIcon className="h-5 w-5" />
          <h1 className="text-xl font-bold ml-1">Asset Manager</h1> 
        </div>
      </div>
      <div className="flex-none py-2 px-1 sm:px-2 border-b border-primary/80">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex flex-wrap gap-2">
            <Button 
              variant="default" 
              onClick={() => {
                setCreateDialogMode('individual');
                setCreateDialogInitialFocus('file');
                setIsCreateDialogOpen(true);
              }} 
              className="h-9 flex items-center"
            >
              <Upload className="h-4 w-4 mr-2" />
              Upload Assets
            </Button>
            <Button 
              variant="outline" 
              onClick={() => {
                setCreateDialogMode('individual');
                setCreateDialogInitialFocus('url');
                setIsCreateDialogOpen(true);
              }}
              className="h-9 flex items-center"
            >
              <LinkIcon className="h-4 w-4 mr-2" />
              Add from URL
            </Button>
            <Button 
              variant="outline" 
              onClick={handleCreateEmptyBundle}
              className="h-9 flex items-center"
            >
              <FolderPlus className="h-4 w-4 mr-2" />
              Create Folder
            </Button>
          </div>
          <div className="flex items-center gap-2">
            {selectedItems.size > 0 && (
              <>
                <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/30">
                  {selectedItems.size} selected
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleBulkDelete}
                  className="h-7 px-2 text-red-600 hover:text-red-700 hover:bg-red-50"
                >
                  <Trash2 className="h-3 w-3 mr-1" />
                  Delete
                </Button>
                <AssetTransferPopover
                  selectedItems={handleTransferItems()}
                  onComplete={() => setSelectedItems(new Set())}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedItems(new Set())}
                  className="h-6 w-6 p-0"
                >
                  <X className="h-3 w-3" />
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 min-h-0 overflow-hidden p-1 pb-3">
        
        <ResizablePanelGroup direction="horizontal" className="h-full w-full rounded-lg  border-primary/60">
          {/* Asset Tree Panel */}
          <ResizablePanel defaultSize={30} minSize={20} maxSize={65} className="min-w-[320px]">
            <div className="h-full flex flex-col">
              {/* Search and Filter */}
              <div className="flex-none p-3 border-b">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="select-all"
                    checked={isAllSelected}
                    onCheckedChange={(checked) => handleSelectAll(Boolean(checked))}
                    disabled={allVisibleItemIds.size === 0}
                    aria-label="Select all visible items"
                  />
                  <div className="relative flex-grow">
                    <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Search assets..."
                      className="pl-8 h-9"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                  </div>
                  <Select value={assetTypeFilter} onValueChange={(value) => setAssetTypeFilter(value as AssetKind | 'all')}>
                    <SelectTrigger className="w-[180px] h-9">
                      <SelectValue placeholder="Filter by type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Types</SelectItem>
                      {assetKinds.map(kind => (
                        <SelectItem key={kind} value={kind}>
                          {kind.charAt(0).toUpperCase() + kind.slice(1).replace('_', ' ')}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={sortOption} onValueChange={setSortOption}>
                    <SelectTrigger className="w-[180px] h-9">
                      <SelectValue placeholder="Sort by" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="updated_at-desc">Date Modified (Newest)</SelectItem>
                      <SelectItem value="updated_at-asc">Date Modified (Oldest)</SelectItem>
                      <SelectItem value="name-asc">Name (A-Z)</SelectItem>
                      <SelectItem value="name-desc">Name (Z-A)</SelectItem>
                      <SelectItem value="kind-asc">Kind (A-Z)</SelectItem>
                      <SelectItem value="kind-desc">Kind (Z-A)</SelectItem>
                    </SelectContent>
                  </Select>
                  {/* View Mode Toggle */}
                  <div className="flex items-center gap-1 rounded-md bg-muted p-0.5">
                    <Button
                      variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => setViewMode('list')}
                    >
                      <Rows className="h-4 w-4" />
                    </Button>
                    <Button
                      variant={viewMode === 'card' ? 'secondary' : 'ghost'}
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => setViewMode('card')}
                    >
                      <LayoutGrid className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                {cardViewFolder && viewMode === 'card' && (
                  <div className="mt-2">
                    <Button variant="outline" size="sm" onClick={() => { setCardViewFolder(null); setSelectedItems(new Set()); }}>
                      <ChevronLeft className="h-4 w-4 mr-2" />
                      Back to root
                    </Button>
                    <span className="ml-2 text-sm font-medium text-muted-foreground">/ {cardViewFolder.name}</span>
                  </div>
                )}
                {itemsForView.length > 0 && (
                  <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                    <span>{assets.length} assets</span>
                    <Separator orientation="vertical" className="h-3" />
                    <span>{bundles.length} folders</span>
                  </div>
                )}
              </div>

              {/* Asset Tree */}
              <div className="flex-1 min-h-0 overflow-hidden">
                <ScrollArea className="h-full">
                  {(isLoadingAssets || isLoadingBundles) ? (
                    <div className="flex items-center justify-center h-32">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      <span className="ml-2 text-muted-foreground">Loading...</span>
                    </div>
                  ) : (assetError || bundleError) ? (
                    <div className="flex items-center justify-center h-32 text-red-500">
                      <AlertCircle className="h-5 w-5 mr-2" />
                      <span>Error: {assetError || bundleError}</span>
                    </div>
                  ) : itemsForView.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                      <FolderOpen className="h-8 w-8 mb-2 opacity-50" />
                      <h3 className="text-lg font-medium mb-2">No items found</h3>
                      <p className="text-sm text-center">
                        {debouncedSearchTerm 
                          ? `No items match "${debouncedSearchTerm}"`
                          : cardViewFolder
                            ? "This folder is empty."
                            : "Upload assets or create folders to get started"
                        }
                      </p>
                    </div>
                  ) : viewMode === 'list' ? (
                    <div className="p-2 space-y-1 pb-4">
                      {itemsForView.map(item => renderTreeItem(item))}
                    </div>
                  ) : (
                    <AssetCardComponent 
                      items={itemsForView}
                      onItemSelect={handleCardSelect}
                      onItemDoubleClick={handleItemDoubleClick}
                      onItemView={handleItemView}
                      selectedItemIds={selectedItems}
                    />
                  )}
                  <ScrollBar />
                </ScrollArea>
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle className="bg-border" />

          {/* Detail Panel */}
          <ResizablePanel defaultSize={70} minSize={35} maxSize={75} className="min-w-[320px]">
            <div className="h-full border-l">
              {activeDetail?.type === 'asset' ? (
                <AssetDetailView
                  selectedAssetId={activeDetail.id}
                  highlightAssetIdOnOpen={highlightAssetId}
                  onEdit={handleEditAsset}
                  schemes={[]}
                  onLoadIntoRunner={onLoadIntoRunner}
                />
              ) : activeDetail?.type === 'bundle' ? (
                <BundleDetailView
                  selectedBundleId={activeDetail.id}
                  onLoadIntoRunner={onLoadIntoRunner}
                  selectedAssetId={selectedAssetInBundle}
                  onAssetSelect={(assetId) => {
                    if (assetId) {
                      // Keep bundle context, but show asset detail within
                      setSelectedAssetInBundle(assetId);
                    } else {
                      // Go back to bundle view
                      setSelectedAssetInBundle(null);
                    }
                  }}
                  highlightAssetId={highlightAssetId}
                />
              ) : (
                <div className="h-full flex items-center justify-center p-6">
                  <div className="text-center">
                    <Eye className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="text-lg font-medium text-muted-foreground mb-2">
                      Select an asset or bundle to view details
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      Choose any item from the tree to see its content and metadata.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {/* Dialogs */}
      <CreateAssetDialog
        open={isCreateDialogOpen}
        onClose={() => {
          setIsCreateDialogOpen(false);
          setUploadToBundle(null);
          setCreateDialogInitialFocus(undefined);
        }}
        mode={createDialogMode}
        initialFocus={createDialogInitialFocus}
        existingBundleId={uploadToBundle?.id}
        existingBundleName={uploadToBundle?.name}
      />

      {/* Create Empty Bundle Dialog */}
      <CreateBundleDialog
        open={isCreateBundleOpen}
        onClose={() => setIsCreateBundleOpen(false)}
      />

      {/* Asset Edit Dialog */}
      {editingAsset && (
        <EditAssetOverlay
          open={true}
          onClose={() => setEditingAsset(null)}
          asset={editingAsset}
          onSave={handleSaveAsset}
        />
      )}

      {/* Bundle Edit Dialog */}
      {editingBundle && (
        <BundleEditDialog
          open={true}
          onClose={() => setEditingBundle(null)}
          bundle={editingBundle}
          onSave={handleSaveBundle}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteConfirmation.isOpen} onOpenChange={(open) => 
        !open && setDeleteConfirmation({ type: 'asset', items: [], isOpen: false })
      }>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Deletion</AlertDialogTitle>
            <AlertDialogDescription>
              {(() => {
                const { type, items } = deleteConfirmation;
                const count = items.length;
                
                if (type === 'asset' && count === 1) {
                  const asset = items[0] as AssetRead;
                  return `Are you sure you want to delete the asset "${asset.title}"? This action cannot be undone.`;
                } else if (type === 'bundle' && count === 1) {
                  const bundle = items[0] as BundleRead;
                  return `Are you sure you want to delete the bundle "${bundle.name}"? This will remove the bundle but not the individual assets within it. This action cannot be undone.`;
                } else {
                  const assets = items.filter(item => 'kind' in item);
                  const bundles = items.filter(item => 'name' in item && !('kind' in item));
                  
                  let message = `Are you sure you want to delete `;
                  if (assets.length > 0 && bundles.length > 0) {
                    message += `${assets.length} asset${assets.length > 1 ? 's' : ''} and ${bundles.length} bundle${bundles.length > 1 ? 's' : ''}`;
                  } else if (assets.length > 0) {
                    message += `${assets.length} asset${assets.length > 1 ? 's' : ''}`;
                  } else {
                    message += `${bundles.length} bundle${bundles.length > 1 ? 's' : ''}`;
                  }
                  message += `? Bundles will be deleted, but the assets inside them will remain. This action cannot be undone.`;
                  return message;
                }
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={executeDelete} className="bg-red-600 hover:bg-red-700">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}