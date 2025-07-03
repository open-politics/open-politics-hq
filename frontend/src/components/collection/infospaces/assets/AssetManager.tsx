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
  AssetUpdate,
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
import AssetSelector, { AssetTreeItem } from './AssetSelector';
import { useShareableStore } from '@/zustand_stores/storeShareables';
import ShareItemDialog from './Helper/ShareItemDialog';
import { ResourceType } from '@/client';

type SortKey = 'name' | 'updated_at' | 'kind';
type SortDirection = 'asc' | 'desc';

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
    updateBundle,
  } = useBundleStore();
  const { exportResource, exportResourcesBatch, importResource, exportMixedBatch } = useShareableStore();

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
  const [sharingItem, setSharingItem] = useState<AssetTreeItem | null>(null);
  
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
  }, []);

  const handleItemDoubleClick = useCallback((item: AssetTreeItem) => {
    // In AssetManager, double-click should open the detail view.
    handleItemView(item);
  }, [handleItemView]);

  // Bulk delete functionality
  const handleBulkDelete = useCallback(() => {
    const selectedBundles: BundleRead[] = [];
    const selectedAssets: AssetRead[] = [];

    selectedItems.forEach(itemId => {
      if (itemId.startsWith('bundle-')) {
        const bundleId = parseInt(itemId.replace('bundle-', ''));
        const bundle = bundles.find(b => b.id === bundleId);
        if (bundle) selectedBundles.push(bundle);
      } else if (itemId.startsWith('asset-') || itemId.startsWith('child-')) {
        const assetId = parseInt(itemId.replace(/^(asset-|child-)/, ''));
        const asset = assets.find(a => a.id === assetId);
        if (asset) selectedAssets.push(asset);
      }
    });

    if (selectedBundles.length > 0 && selectedAssets.length > 0) {
      setDeleteConfirmation({ type: 'bulk-assets', items: [...selectedAssets, ...selectedBundles], isOpen: true });
    } else if (selectedBundles.length > 0) {
      setDeleteConfirmation({ type: 'bulk-bundles', items: selectedBundles, isOpen: true });
    } else if (selectedAssets.length > 0) {
      setDeleteConfirmation({ type: 'bulk-assets', items: selectedAssets, isOpen: true });
    }
  }, [selectedItems, bundles, assets]);

  const handleDeleteAsset = async (asset: AssetRead, skipConfirmation = false) => {
    if (!skipConfirmation) {
      setDeleteConfirmation({ type: 'asset', items: [asset], isOpen: true });
      return;
    }
    try {
      await deleteAsset(asset.id);
      toast.success(`Asset "${asset.title}" deleted.`);
      if (activeDetail?.type === 'asset' && activeDetail.id === asset.id) setActiveDetail(null);
    } catch (error) { toast.error('Failed to delete asset.'); }
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
    } catch (error) { toast.error('Failed to delete bundle.'); }
  };

  const executeDelete = useCallback(async () => {
    const { items } = deleteConfirmation;
    const assetsToDelete = items.filter(item => 'kind' in item) as AssetRead[];
    const bundlesToDelete = items.filter(item => 'name' in item && !('kind' in item)) as BundleRead[];
    
    const promises = [
      ...assetsToDelete.map(asset => deleteAsset(asset.id)),
      ...bundlesToDelete.map(bundle => deleteBundle(bundle.id)),
    ];
    
    try {
      await Promise.all(promises);
      const totalCount = assetsToDelete.length + bundlesToDelete.length;
      toast.success(`Successfully deleted ${totalCount} item(s).`);
      setSelectedItems(new Set());
      setActiveDetail(null);
    } catch (error) { toast.error('Some items could not be deleted.'); } finally {
      setDeleteConfirmation({ type: 'asset', items: [], isOpen: false });
    }
  }, [deleteConfirmation, deleteAsset, deleteBundle]);

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
            const asset = assets.find(a => a.id === assetId);
            if (asset && !asset.parent_asset_id) { // Only export top-level assets in bulk
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
  }, [selectedItems, activeInfospace, exportMixedBatch, assets]);

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
                // Refresh assets and bundles
                await fetchAssets();
                await fetchBundles(activeInfospace.id);
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

  const transferItems = useMemo(() => {
    const items: Array<{ id: number; type: 'asset' | 'bundle'; title: string }> = [];
    selectedItems.forEach(itemId => {
      if (itemId.startsWith('bundle-')) {
        const bundleId = parseInt(itemId.replace('bundle-', ''));
        const bundle = bundles.find(b => b.id === bundleId);
        if (bundle) items.push({ id: bundle.id, type: 'bundle', title: bundle.name });
      } else if (itemId.startsWith('asset-') || itemId.startsWith('child-')) {
        const assetId = parseInt(itemId.replace(/^(asset-|child-)/, ''));
        const asset = assets.find(a => a.id === assetId);
        if (asset) items.push({ id: asset.id, type: 'asset', title: asset.title });
      }
    });
    return items;
  }, [selectedItems, bundles, assets]);

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
            <DropdownMenuItem onClick={() => handleUploadToBundle(item.bundle!)}><Upload className="mr-2 h-4 w-4" /> Add Files</DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleEditBundle(item.bundle!)}><Settings className="mr-2 h-4 w-4" /> Edit Details</DropdownMenuItem>
          </>
        )}
        {item.type === 'asset' && item.asset && (
          <DropdownMenuItem onClick={() => handleEditAsset(item.asset!)}><Settings className="mr-2 h-4 w-4" /> Edit Details</DropdownMenuItem>
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
            <Button variant="default" onClick={() => { setCreateDialogMode('individual'); setCreateDialogInitialFocus('file'); setIsCreateDialogOpen(true); }} className="h-9"><Upload className="h-4 w-4 mr-2" /> Upload Assets</Button>
            <Button variant="outline" onClick={() => { setCreateDialogMode('individual'); setCreateDialogInitialFocus('url'); setIsCreateDialogOpen(true); }} className="h-9"><LinkIcon className="h-4 w-4 mr-2" /> Add from URL</Button>
            <Button variant="outline" onClick={handleCreateEmptyBundle} className="h-9"><FolderPlus className="h-4 w-4 mr-2" /> Create Folder</Button>
            <Button variant="outline" onClick={() => document.getElementById('import-file-input')?.click()} className="h-9"><Download className="h-4 w-4 mr-2" /> Import</Button>
            <input type="file" id="import-file-input" style={{ display: 'none' }} onChange={handleImportFile} accept=".zip,.json" />
          </div>
          <div className="flex items-center gap-2">
            {selectedItems.size > 0 && (
              <>
                <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/30">{selectedItems.size} selected</Badge>
                <Button variant="outline" size="sm" onClick={handleBulkDelete} className="h-7 px-2 text-red-600 hover:text-red-700 hover:bg-red-50"><Trash2 className="h-3 w-3 mr-1" /> Delete</Button>
                <Button variant="outline" size="sm" onClick={handleBulkExport} className="h-7 px-2"><Download className="h-3 w-3 mr-1" /> Export</Button>
                <AssetTransferPopover selectedItems={transferItems} onComplete={() => setSelectedItems(new Set())} />
                <Button variant="ghost" size="sm" onClick={() => setSelectedItems(new Set())} className="h-6 w-6 p-0"><X className="h-3 w-3" /></Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 min-h-0 overflow-hidden p-1 pb-3">
        <ResizablePanelGroup direction="horizontal" className="h-full w-full rounded-lg border-primary/60">
          <ResizablePanel defaultSize={40} minSize={25} maxSize={65} className="min-w-[400px]">
            <AssetSelector
                selectedItems={selectedItems}
                onSelectionChange={setSelectedItems}
                onItemView={handleItemView}
                onItemDoubleClick={handleItemDoubleClick}
                renderItemActions={renderItemActions}
            />
          </ResizablePanel>

          <ResizableHandle withHandle className="bg-border" />

          <ResizablePanel defaultSize={60} minSize={35} maxSize={75}>
            <div className="h-full border-l">
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
                <div className="h-full flex items-center justify-center p-6">
                  <div className="text-center">
                    <Eye className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="text-lg font-medium text-muted-foreground">Select an item to view its details</h3>
                  </div>
                </div>
              )}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {/* Dialogs */}
      <CreateAssetDialog open={isCreateDialogOpen} onClose={() => { setIsCreateDialogOpen(false); setUploadToBundle(null); setCreateDialogInitialFocus(undefined); }} mode={createDialogMode} initialFocus={createDialogInitialFocus} existingBundleId={uploadToBundle?.id} existingBundleName={uploadToBundle?.name} />
      <CreateBundleDialog open={isCreateBundleOpen} onClose={() => setIsCreateBundleOpen(false)} />
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
  );
}