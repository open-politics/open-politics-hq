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
  const {
    assets,
    fetchAssets,
    isLoading: isLoadingAssets,
    error: assetError,
    fetchChildAssets,
    updateAsset, // Keep for inline editing
  } = useAssetStore();
  
  const {
    bundles,
    fetchBundles,
    isLoading: isLoadingBundles,
    error: bundleError,
    getBundleAssets,
    addAssetToBundle,
    removeAssetFromBundle,
    updateBundle, // Keep for inline editing
  } = useBundleStore();

  // UI State
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearchTerm = useDebounce(searchTerm, 300);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [assetTypeFilter, setAssetTypeFilter] = useState<AssetKind | 'all'>('all');
  const [sortOption, setSortOption] = useState('updated_at-desc');
  
  // Inline editing state
  const [editingItem, setEditingItem] = useState<{ id: string; value: string } | null>(null);
  
  // Data fetching state
  const [bundleAssets, setBundleAssets] = useState<Map<number, AssetRead[]>>(new Map());
  const [childAssets, setChildAssets] = useState<Map<number, AssetRead[]>>(new Map());
  const [isLoadingChildren, setIsLoadingChildren] = useState<Set<number>>(new Set());

  // Drag and drop state
  const [draggedOverBundleId, setDraggedOverBundleId] = useState<string | null>(null);

  // View mode state
  const [viewMode, setViewMode] = useState<'list' | 'card'>('list');
  const [cardViewFolder, setCardViewFolder] = useState<AssetTreeItem | null>(null);

  const fetchingRef = useRef(false);

  // Fetch data when infospace changes
  useEffect(() => {
    if (activeInfospace?.id && !fetchingRef.current) {
      fetchingRef.current = true;
      Promise.allSettled([
        fetchAssets(),
        fetchBundles(activeInfospace.id),
      ]).finally(() => {
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
    bundles.forEach(async (bundle) => {
      if (!bundleAssets.has(bundle.id)) {
        try {
          const assets = await getBundleAssets(bundle.id);
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
    const bundledAssetIds = new Set();
    bundles.forEach(bundle => {
      const bundleAssetList = bundleAssets.get(bundle.id) || [];
      bundleAssetList.forEach(asset => bundledAssetIds.add(asset.id));
    });
    
    const individualAssets = assets.filter(asset => 
      !asset.parent_asset_id && !bundledAssetIds.has(asset.id)
    );

    bundles.forEach(bundle => {
      const bundleAssetList = bundleAssets.get(bundle.id) || [];
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
  }, [assets, bundles, bundleAssets, childAssets, expandedItems, selectedItems, sortOption]);

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

  const toggleExpanded = useCallback(async (itemId: string) => {
    const isCurrentlyExpanded = expandedItems.has(itemId);
    setExpandedItems(prev => {
      const newSet = new Set(prev);
      if (isCurrentlyExpanded) newSet.delete(itemId);
      else newSet.add(itemId);
      return newSet;
    });

    if (!isCurrentlyExpanded && itemId.startsWith('asset-')) {
      const assetId = parseInt(itemId.replace('asset-', ''));
      const asset = assets.find(a => a.id === assetId);
      if (asset && asset.is_container && !childAssets.has(assetId)) {
        setIsLoadingChildren(prev => new Set([...prev, assetId]));
        try {
          const children = await fetchChildAssets(assetId);
          setChildAssets(prev => new Map(prev.set(assetId, children || [])));
        } catch (error) {
          console.error(`Failed to fetch children for asset ${assetId}:`, error);
        } finally {
          setIsLoadingChildren(prev => { const newSet = new Set(prev); newSet.delete(assetId); return newSet; });
        }
      }
    }
  }, [assets, childAssets, fetchChildAssets, expandedItems]);

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

  const handleItemClick = useCallback((item: AssetTreeItem) => {
    if (onItemView) onItemView(item);
  }, [onItemView]);

  const handleItemDoubleClickInternal = useCallback((item: AssetTreeItem) => {
    if (onItemDoubleClick) {
      onItemDoubleClick(item);
    } else if (item.type === 'folder') {
      setCardViewFolder(item);
      onSelectionChange(new Set());
    } else if (onItemView) {
      onItemView(item);
    }
  }, [onItemDoubleClick, onItemView, onSelectionChange]);

  const toggleBundleSelection = useCallback((bundleId: number, select: boolean) => {
    const bundleAssetList = bundleAssets.get(bundleId) || [];
    const newSet = new Set(selectedItems);
    const bundleItemId = `bundle-${bundleId}`;
    if (select) {
      newSet.add(bundleItemId);
      bundleAssetList.forEach(asset => {
        newSet.add(`asset-${asset.id}`);
        const children = childAssets.get(asset.id) || [];
        children.forEach(child => newSet.add(`child-${child.id}`));
      });
    } else {
      newSet.delete(bundleItemId);
      bundleAssetList.forEach(asset => {
        newSet.delete(`asset-${asset.id}`);
        const children = childAssets.get(asset.id) || [];
        children.forEach(child => newSet.delete(`child-${child.id}`));
      });
    }
    onSelectionChange(newSet);
  }, [bundleAssets, childAssets, selectedItems, onSelectionChange]);
  
  const isBundleFullySelected = useCallback((bundleId: number) => {
    const bundleAssetList = bundleAssets.get(bundleId) || [];
    if (!selectedItems.has(`bundle-${bundleId}`)) return false;
    return bundleAssetList.every(asset => {
      if (!selectedItems.has(`asset-${asset.id}`)) return false;
      const children = childAssets.get(asset.id) || [];
      return children.length === 0 || children.every(child => selectedItems.has(`child-${child.id}`));
    });
  }, [selectedItems, bundleAssets, childAssets]);

  const isBundlePartiallySelected = useCallback((bundleId: number) => {
    const bundleAssetList = bundleAssets.get(bundleId) || [];
    if (selectedItems.has(`bundle-${bundleId}`)) return false;
    return bundleAssetList.some(asset => {
      if (selectedItems.has(`asset-${asset.id}`)) return true;
      const children = childAssets.get(asset.id) || [];
      return children.some(child => selectedItems.has(`child-${child.id}`));
    });
  }, [selectedItems, bundleAssets, childAssets]);

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
        const promises = moveOperations.map(({ asset, sourceBundleId }) => {
            if (sourceBundleId && sourceBundleId !== destinationBundleId) {
                return removeAssetFromBundle(sourceBundleId, asset.id).then(() => addAssetToBundle(destinationBundleId, asset.id));
            }
            return addAssetToBundle(destinationBundleId, asset.id);
        });
        await Promise.all(promises);
        toast.success(`Successfully moved ${draggedAssets.length} asset(s).`);
        
        // Refresh bundles involved
        const bundlesToRefresh = new Set(moveOperations.map(op => op.sourceBundleId).filter(id => id !== null) as number[]);
        bundlesToRefresh.add(destinationBundleId);
        const refreshPromises = Array.from(bundlesToRefresh).map(id => getBundleAssets(id));
        const refreshedData = await Promise.all(refreshPromises);

        setBundleAssets(prev => {
            const newMap = new Map(prev);
            Array.from(bundlesToRefresh).forEach((bundleId, index) => newMap.set(bundleId, refreshedData[index]));
            return newMap;
        });
    } catch (error) {
        console.error('Drop error:', error);
        toast.error('Failed to move assets.');
    }
  }, [addAssetToBundle, removeAssetFromBundle, getBundleAssets, bundleAssets]);

  const getIndentationStyle = (level: number) => ({ paddingLeft: `${level * 1.5}rem` });

  const renderTreeItem = useCallback((item: AssetTreeItem) => {
    const hasChildren = item.children && item.children.length > 0;
    const canExpand = hasChildren || (item.asset?.is_container && item.type === 'asset');
    const isLoading = item.asset && isLoadingChildren.has(item.asset.id);
    const isFolder = item.type === 'folder';
    const isEditing = editingItem?.id === item.id;
    const isDragOver = draggedOverBundleId === item.id;
    
    if (item.type === 'folder' && item.bundle) {
      const bundleId = item.bundle.id;
      const isFullySelected = isBundleFullySelected(bundleId);
      const isPartiallySelected = isBundlePartiallySelected(bundleId);
      return (
        <div key={item.id}>
          <div
            className={cn("group flex items-center gap-2 py-2 px-3 hover:bg-muted cursor-pointer transition-colors border-t border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50", (isFullySelected || item.isSelected) && "bg-blue-100 dark:bg-blue-900/80 border-l-4 border-blue-500 !border-y-blue-500/50", isDragOver && "bg-blue-100 dark:bg-blue-900 ring-1 ring-blue-500")}
            style={getIndentationStyle(item.level)}
            onClick={(e) => { e.stopPropagation(); toggleExpanded(item.id); }}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDraggedOverBundleId(item.id); }}
            onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDraggedOverBundleId(null); }}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleDropOnBundle(item, e); }}
          >
            <div className="w-4 h-4 flex items-center justify-center">
              {canExpand && <Button variant="ghost" size="sm" className="h-4 w-4 p-0" onClick={(e) => {e.stopPropagation(); toggleExpanded(item.id);}}> {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : item.isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />} </Button>}
            </div>
            <Checkbox checked={isFullySelected || isPartiallySelected} onCheckedChange={(checked) => toggleBundleSelection(bundleId, !!checked)} onClick={(e) => e.stopPropagation()} className={cn("h-4 w-4", isPartiallySelected && !isFullySelected && "data-[state=checked]:bg-primary/50")} title={isFullySelected ? "Deselect all" : "Select all"} />
            <div className="w-4 h-4 flex items-center justify-center">{item.isExpanded ? <FolderOpen className="h-4 w-4 text-blue-600" /> : <Folder className="h-4 w-4 text-blue-600" />}</div>
            <div className="flex-1 min-w-0" onDoubleClick={(e) => { e.stopPropagation(); handleEditItem(item); }}>
              <div className="flex items-center gap-2">
                {isEditing ? (
                  <div className="flex items-center gap-1">
                    <Input value={editingItem.value} onChange={(e) => setEditingItem({ ...editingItem, value: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') handleSaveEditing(); if (e.key === 'Escape') handleCancelEdit(); }} autoFocus className="h-7 text-sm" onClick={(e) => e.stopPropagation()} />
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); handleSaveEditing();}}><Check className="h-4 w-4 text-green-600"/></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); handleCancelEdit();}}><X className="h-4 w-4 text-red-600"/></Button>
                  </div>
                ) : <span className="text-sm font-semibold truncate">{item.name}</span>}
                {hasChildren && <Badge variant="secondary" className="text-xs">{item.children?.length} items</Badge>}
              </div>
            </div>
            <div className="flex items-center justify-end gap-1 ml-auto opacity-0 group-hover:opacity-100 transition-opacity pl-4">
              {renderItemActions ? renderItemActions(item) : (
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={(e) => { e.stopPropagation(); handleItemClick(item); }} title="View Details"><Eye className="h-4 w-4" /></Button>
              )}
            </div>
          </div>
          {item.isExpanded && item.children && <div className="ml-4 border-l-2 border-slate-200 dark:border-slate-700 pl-0 space-y-0.5">{item.children.map(child => renderTreeItem(child))}</div>}
        </div>
      );
    }
    
    return (
      <div key={item.id}>
        <div
          className={cn("group flex items-center gap-2.5 py-1.5 px-3 hover:bg-muted/50 cursor-pointer transition-colors rounded-md", item.isSelected && "bg-blue-50 dark:bg-blue-900/50 border-l-4 rounded-none border-blue-500")}
          style={getIndentationStyle(item.level)}
          onClick={() => handleItemClick(item)}
          onDoubleClick={() => handleItemDoubleClickInternal(item)}
          draggable onDragStart={(e) => {
            e.stopPropagation();
            const draggedItem = item.asset;
            if (!draggedItem) return;
            
            const itemsToDrag: AssetRead[] = [];
            if (selectedItems.has(item.id)) {
              selectedItems.forEach(id => {
                if (id.startsWith('asset-') || id.startsWith('child-')) {
                  const assetId = parseInt(id.replace(/^(asset-|child-)/, ''));
                  const asset = assets.find(a => a.id === assetId);
                  if (asset) {
                    itemsToDrag.push(asset);
                  }
                }
              });
            } else {
              itemsToDrag.push(draggedItem);
            }

            if (itemsToDrag.length > 0) {
              e.dataTransfer.setData('application/json', JSON.stringify({ type: 'assets', items: itemsToDrag }));
            }
          }}
        >
          <div className="w-4 h-4 flex items-center justify-center">{canExpand && <Button variant="ghost" size="sm" className="h-4 w-4 p-0" onClick={(e) => { e.stopPropagation(); toggleExpanded(item.id); }}>{isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : item.isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}</Button>}</div>
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
                    {item.asset?.kind && <Badge variant="outline" className={cn("text-xs flex-shrink-0", getAssetBadgeClass(item.asset.kind))}>{formatAssetKind(item.asset.kind)}</Badge>}
                    <span className="text-sm font-medium truncate">{item.name}</span>
                  </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-4 ml-auto pl-4">
            {item.asset && <div className="text-xs text-muted-foreground truncate hidden group-hover:block md:block">{formatDistanceToNow(new Date(item.asset.updated_at), { addSuffix: true })}</div>}
            <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {renderItemActions ? renderItemActions(item) : (
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={(e) => { e.stopPropagation(); handleItemClick(item); }} title="View Details"><Eye className="h-4 w-4" /></Button>
              )}
            </div>
          </div>
        </div>
        {item.isExpanded && item.children && <div className="ml-4 border-l-2 border-slate-200 dark:border-slate-700 pl-2 space-y-1">{item.children.map(child => renderTreeItem(child))}</div>}
      </div>
    );
  }, [toggleSelected, toggleExpanded, handleItemClick, handleItemDoubleClickInternal, handleEditItem, handleSaveEditing, handleCancelEdit, isLoadingChildren, toggleBundleSelection, isBundleFullySelected, isBundlePartiallySelected, editingItem, draggedOverBundleId, handleDropOnBundle, assets, renderItemActions]);

  const itemsForView = useMemo(() => {
    if (viewMode === 'card' && cardViewFolder) return cardViewFolder.children || [];
    return filteredTree;
  }, [viewMode, cardViewFolder, filteredTree]);

  return (
    <div className="h-full flex flex-col">
        {/* Search and Filter */}
        <div className="flex-none p-3 border-b">
          <div className="flex items-center gap-2">
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
              <Button variant={viewMode === 'list' ? 'secondary' : 'ghost'} size="sm" className="h-7 px-2" onClick={() => setViewMode('list')}><Rows className="h-4 w-4" /></Button>
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
        <div className="flex-1 min-h-0 overflow-hidden">
          <ScrollArea className="h-full">
            {(isLoadingAssets || isLoadingBundles) ? (
              <div className="flex items-center justify-center h-32"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /><span className="ml-2 text-muted-foreground">Loading...</span></div>
            ) : (assetError || bundleError) ? (
              <div className="flex items-center justify-center h-32 text-red-500"><AlertCircle className="h-5 w-5 mr-2" /><span>Error: {assetError || bundleError}</span></div>
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
            <ScrollBar />
          </ScrollArea>
        </div>
      </div>
  );
} 