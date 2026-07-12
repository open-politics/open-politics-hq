'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
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
  FolderPlus,
  Edit3,
  Check,
  Link as LinkIcon,
  EyeOff,
  View,
  Settings,
  FileIcon,
  RadioTower,
  Rss,
  Menu,
  Newspaper,
  Folder,
  Shredder,
  Asterisk,
  Star,
  Lock,
  Unlock,
  ScanEye,
  Plus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { scrollBundleIntoView } from '@/lib/bundles/reveal';
import { formatDistanceToNowStrict } from 'date-fns';
import { toast } from 'sonner';
import {
  AssetRead,
  AssetKind,
  BundleRead,
  AssetUpdate,
  BundlesService,
} from '@/client';
import type { AssetNode } from '@/client';
import { useAssetStore } from '@/zustand_stores/storeAssets';
import { useBundleStore } from '@/zustand_stores/storeBundles';
import { useSourceStore } from '@/zustand_stores/storeSources';
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import BundleEditDialog from './Helper/BundleEditDialog';
import CreateBundleDialog from './Helper/CreateBundleDialog';
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
import ShareSelectionDialog from './Helper/ShareSelectionDialog';
import { ResourceType } from '@/client';
import { TextSpanHighlightProvider } from '@/components/collection/contexts/TextSpanHighlightContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { ChannelTabs, ChannelFeedContent } from './Feed/ChannelFeedView';
import { useAssetQuery } from '@/hooks/useAssetQuery';
import { useUserPreferencesStore, type Channel } from '@/zustand_stores/storeUserPreferences';
import { IconPickerDialog } from '@/components/collection/utilities/icons/IconPickerOverlay';
import { IconRenderer } from '@/components/collection/utilities/icons/icon-picker';
import { AssetFeedView } from './Feed';
import { useSemanticSearch } from '@/hooks/useSemanticSearch';
import { useProvidersStore } from '@/zustand_stores/storeProviders';
import { useDock } from '@/zustand_stores/storeDock';
import { useAssetDetail } from './Views/AssetDetailProvider';
import { DockHost } from '@/components/collection/intake/DockHost';
import { SourceList, type SourceStreamControls } from '@/components/collection/intake/sources/SourceList';
import { SourceStreams, type SourceStream } from './SourceStreams';
import type { AssetFeedItem } from './Feed/types';

    


type SortKey = 'name' | 'updated_at' | 'kind';
type SortDirection = 'asc' | 'desc';

// ─── Channel form (inline for dialog) ───

function ChannelForm({
  initial,
  onSave,
  onDelete,
  onCancel,
  isDefault,
  onSetDefault,
}: {
  initial: Channel | null;
  onSave: (data: Omit<Channel, 'id'>) => Promise<void>;
  onDelete?: () => Promise<void>;
  onCancel: () => void;
  isDefault?: boolean;
  onSetDefault?: () => Promise<void>;
}) {
  const [name, setName] = React.useState(initial?.name ?? '');
  const [selectedBundleIds, setSelectedBundleIds] = React.useState<Set<number>>(
    new Set(initial?.bundleIds ?? [])
  );
  const [query, setQuery] = React.useState(initial?.query ?? '');
  const [sort, setSort] = React.useState(initial?.sort ?? 'created_at_desc');
  const [view, setView] = React.useState<'list' | 'card' | 'bento'>(initial?.view ?? 'bento');
  const [icon, setIcon] = React.useState(initial?.icon ?? '');
  const [saving, setSaving] = React.useState(false);

  // Get available bundles from tree store
  const { rootNodes } = useTreeStore();
  const availableBundles = React.useMemo(() =>
    rootNodes
      .filter((n: any) => n.type === 'bundle')
      .map((n: any) => ({ id: parseInt(n.id.replace('bundle-', '')), name: n.name })),
    [rootNodes]
  );

  const toggleBundle = (id: number) => {
    setSelectedBundleIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    await onSave({
      name: name.trim(),
      icon: icon || undefined,
      bundleIds: Array.from(selectedBundleIds),
      query: query.trim() || undefined,
      sort,
      view,
    });
    setSaving(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 pt-2">
      <div className="flex gap-3">
        <div className="space-y-1 flex-1">
          <label className="text-xs font-medium text-foreground">Name</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="News Feed" className="h-8 text-sm" autoFocus />
        </div>
        <div className="space-y-1 shrink-0">
          <label className="text-xs font-medium text-foreground">Icon</label>
          <div className="flex items-center gap-2">
            {icon && <IconRenderer icon={icon} className="h-5 w-5" />}
            <IconPickerDialog onIconSelect={setIcon} defaultIcon={icon || undefined} />
          </div>
        </div>
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-foreground">Bundles</label>
        <div className="rounded-md border bg-muted/30 max-h-[200px] overflow-hidden">
          <AssetSelector
            compact
            bundlesOnly
            selectedItems={new Set(Array.from(selectedBundleIds).map(id => `bundle-${id}`))}
            onSelectionChange={(ids) => {
              const bundleIds = new Set<number>();
              ids.forEach(id => {
                if (id.startsWith('bundle-')) {
                  bundleIds.add(parseInt(id.replace('bundle-', '')));
                }
              });
              setSelectedBundleIds(bundleIds);
            }}
            onItemView={() => {}}
          />
        </div>
        <p className="text-[10px] text-muted-foreground">Select which bundles this channel draws from. None selected = all.</p>
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-foreground">AQL filter (optional)</label>
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="kind:web,article after:2025-01" className="h-8 text-sm" />
        <p className="text-[10px] text-muted-foreground">Additional AQL filters applied to this channel.</p>
      </div>
      <div className="flex gap-3">
        <div className="space-y-1 flex-1">
          <label className="text-xs font-medium text-foreground">Sort</label>
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="created_at_desc">Newest first</SelectItem>
              <SelectItem value="created_at_asc">Oldest first</SelectItem>
              <SelectItem value="title">Title A-Z</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1 flex-1">
          <label className="text-xs font-medium text-foreground">View</label>
          <Select value={view} onValueChange={(v: any) => setView(v)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="bento">Bento</SelectItem>
              <SelectItem value="card">Grid</SelectItem>
              <SelectItem value="list">List</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex items-center justify-between pt-2">
        <div>
          <div className="flex items-center gap-1">
            {onSetDefault && (
              <Button type="button" variant="ghost" size="sm" className="text-xs" disabled={isDefault} onClick={onSetDefault}>
                {isDefault ? 'Default' : 'Set as default'}
              </Button>
            )}
            {onDelete && (
              <Button type="button" variant="ghost" size="sm" className="text-red-600 hover:text-red-700 text-xs" onClick={onDelete}>
                <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
              </Button>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} className="text-xs">Cancel</Button>
          <Button type="submit" size="sm" disabled={!name.trim() || saving} className="text-xs">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
            {initial ? 'Save' : 'Create'}
          </Button>
        </div>
      </div>
    </form>
  );
}

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
    requestEnrichment,
  } = useAssetStore();
  
  const {
    deleteBundle,
    addAssetToBundle,
    removeAssetFromBundle,
    updateBundle,
    sealBundle,
    unsealBundle,
  } = useBundleStore();
  
  const { exportResource, exportResourcesBatch, importResource, exportMixedBatch } = useShareableStore();

  // UI State - search term is managed by AssetSelector, we track it here for feed
  const [searchTermFromSelector, setSearchTermFromSelector] = useState('');
  const debouncedSearchTerm = useDebounce(searchTermFromSelector, 300);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [assetTypeFilter, setAssetTypeFilter] = useState<AssetKind | 'all'>('all');
  const [sortOption, setSortOption] = useState('updated_at-desc');
  const [useSemanticMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('assetSelector_searchMode') === 'semantic';
    }
    return true; // Default to semantic, matching AssetSelector
  });
  
  // Semantic search for feed
  const semanticSearchEnabled = useSemanticMode && !!(activeInfospace?.enrichment_config as any)?.embedding?.model_name && debouncedSearchTerm.trim().length > 0;
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
  // Seed for the bundle dialog when invoked from a selection ("+Bundle"); null = empty bundle.
  const [bundleSeed, setBundleSeed] = useState<{ assetIds: number[]; childBundleIds: number[] } | null>(null);
  const [sharingItems, setSharingItems] = useState<AssetTreeItem[]>([]);
  

  // Detail (asset/bundle) summons into the global right dock — or an annotation
  // overlay when useAssetDetail() finds one in scope. One interface either way.
  const {
    openDetailOverlay,
    openBundleDetail,
    closeDetailOverlay,
    selectedAssetId: detailAssetId,
    selectedBundleId: detailBundleId,
  } = useAssetDetail();


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
    preview?: { message: string; bundles: number; destroyed_assets: number; unlinked: number; paused_sources?: number } | null;
    previewLoading?: boolean;
    previewError?: boolean;
    out_of?: number;  // collection being deleted from (ROOT = top level)
  }>({ type: 'asset', items: [], isOpen: false, preview: null, previewLoading: false });
  
  // Upload to existing bundle state
  const [uploadToBundle, setUploadToBundle] = useState<BundleRead | null>(null);

  // Web Search / Sources summon into the global right dock.
  const openDiscover = useDock((s) => s.openDiscover);
  const openComposer = useDock((s) => s.openComposer);
  const dockEntry = useDock((s) => s.entry);
  const acquireInlineHost = useDock((s) => s.acquireInlineHost);
  const releaseInlineHost = useDock((s) => s.releaseInlineHost);
  // Sources is a left rail (desktop) / sheet (mobile) — not dock content.
  const [showSourcesRail, setShowSourcesRail] = useState(false);

  // ─── Source→bundle streams (the wiring overlay) ───
  // A source streams into exactly one `output_bundle_id`; many sources may feed
  // the same bundle. The global toggle traces all of them at once; per-source
  // pins trace just the ones you care about. The set drawn is the union when
  // all-on, else the pinned set, kept in source-list order so the overlay's lane
  // assignment lines up with the rail. Reveal ids unfold each target's ancestors.
  const { sources } = useSourceStore();
  const sourceStreamsWrapRef = useRef<HTMLDivElement>(null);
  const [streamsAllOn, setStreamsAllOn] = useState(false);
  const [pinnedSourceIds, setPinnedSourceIds] = useState<Set<number>>(new Set());

  const activeSourceIds = useMemo(() => {
    if (streamsAllOn) return new Set(sources.filter((s) => s.output_bundle_id != null).map((s) => s.id));
    return pinnedSourceIds;
  }, [streamsAllOn, sources, pinnedSourceIds]);

  const sourceStreams = useMemo<SourceStream[]>(
    () =>
      sources
        .filter((s) => activeSourceIds.has(s.id) && s.output_bundle_id != null)
        .map((s) => ({ sourceId: s.id, bundleId: s.output_bundle_id as number })),
    [sources, activeSourceIds],
  );

  const revealBundleIds = useMemo(
    () => Array.from(new Set(sourceStreams.map((l) => l.bundleId))),
    [sourceStreams],
  );

  // Single (pinned) streams also OPEN their target bundle; the global toggle only
  // traces (no unfolding). Unpinning drops the bundle here → AssetSelector diffs
  // this set and collapses it again.
  const openBundleIds = useMemo(() => {
    const ids = new Set<number>();
    for (const s of sources) {
      if (pinnedSourceIds.has(s.id) && s.output_bundle_id != null) ids.add(s.output_bundle_id);
    }
    return Array.from(ids);
  }, [sources, pinnedSourceIds]);

  const handleToggleSourceStream = useCallback((sourceId: number) => {
    const adding = !pinnedSourceIds.has(sourceId);
    setPinnedSourceIds((prev) => {
      const next = new Set(prev);
      if (next.has(sourceId)) next.delete(sourceId);
      else next.add(sourceId);
      return next;
    });
    // Pulling a single source into view: once the tree has had a beat to unfold
    // (ancestor chain + the bundle itself), sit the bundle a third down so its
    // just-opened children have room below.
    if (adding) {
      const bundleId = sources.find((s) => s.id === sourceId)?.output_bundle_id;
      if (bundleId != null) scrollBundleIntoView(bundleId);
    }
  }, [pinnedSourceIds, sources]);

  const sourceStreamControls = useMemo<SourceStreamControls>(() => ({
    allOn: streamsAllOn,
    onToggleAll: () => setStreamsAllOn((v) => !v),
    activeSourceIds,
    onTogglePinned: handleToggleSourceStream,
  }), [streamsAllOn, activeSourceIds, handleToggleSourceStream]);

  // On desktop the dock lives inline as our third column, so the app-wide layout
  // dock stands down while we're mounted. Mobile keeps using the layout sheet.
  useEffect(() => {
    if (isMobile) return;
    acquireInlineHost();
    return releaseInlineHost;
  }, [isMobile, acquireInlineHost, releaseInlineHost]);

  // ─── Channel & favorites state ───
  const {
    preferences,
    addChannel,
    updateChannel,
    removeChannel,
    setActiveChannel,
  } = useUserPreferencesStore();
  const channels = preferences.channels ?? [];
  // Session-local channel selection. `undefined` = nothing picked yet this
  // session → land on the persisted active/default channel. Once the user picks
  // (including "All" = null), their choice wins. The old
  // `active ?? default ?? null` derivation could never represent an explicit
  // "All" when a default channel was set — selecting All wrote null, which the
  // `?? default_channel_id` fallback silently snapped back to the default,
  // making "All" unreachable.
  const [selectedChannelId, setSelectedChannelId] = useState<string | null | undefined>(undefined);
  // Landing channel = the pinned default (null = "All"). Session selection wins
  // once the user picks a tab. We intentionally don't fall back to the
  // persisted `active_channel_id` — that "last open" value would override the
  // pinned default on load and make "Pin as default" do nothing.
  const activeChannelId = selectedChannelId !== undefined
    ? selectedChannelId
    : (preferences.default_channel_id ?? null);
  const handleSelectChannel = useCallback((id: string | null) => {
    setSelectedChannelId(id);
    setActiveChannel(id);
  }, [setActiveChannel]);
  // Local favorite tracking — optimistic UI while tree refetches
  const [localFavorites, setLocalFavorites] = useState<Set<string>>(new Set());
  const [localUnfavorites, setLocalUnfavorites] = useState<Set<string>>(new Set());

  const [isChannelDialogOpen, setIsChannelDialogOpen] = useState(false);
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
  const setFavoritesView = useCallback(async (view: 'list' | 'card' | 'bento') => {
    await useUserPreferencesStore.getState().updatePreference('favorites_view', view);
  }, []);

  const setAllView = useCallback(async (view: 'list' | 'card' | 'bento') => {
    await useUserPreferencesStore.getState().updatePreference('all_view', view);
  }, []);

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

  // Convert AssetNodes from the tree store into AssetTreeItems for rendering.
  const assetTree = useMemo(() => {
    console.log('[AssetManager] Building tree from', rootNodes.length, 'root nodes');

    const convertToTreeItem = (node: AssetNode, level: number = 0, parentId?: string): AssetTreeItem => {
      const isExpanded = expandedItems.has(node.id);
      const isSelected = selectedItems.has(node.id);

      // Get children from cache if node is expanded
      let children: AssetTreeItem[] | undefined;
      if (isExpanded) {
        const cachedChildren = childrenCache.get(node.id);
        if (cachedChildren && cachedChildren.length > 0) {
          children = cachedChildren.map(child => convertToTreeItem(child, level + 1, node.id));
        }
      }

      // Create minimal asset/bundle objects for display (icons, styling, etc.)
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
          tags: node.tags || [],
          infospace_id: activeInfospace?.id || 0,
          parent_asset_id: node.parent_asset_id ?? null,
          text_content: '',
          metadata: {},
          uuid: '',
          part_index: node.part_index ?? null,
          source_id: null,
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
          tags: node.tags || [],
        } as BundleRead;
      }

      return {
        id: node.id,
        type: node.type === 'bundle' ? 'folder' : 'asset',
        name: node.name,
        level,
        isExpanded,
        isSelected,
        parentId,
        isContainer: node.type === 'bundle' || !!node.has_children,
        children,
        asset,
        bundle,
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
      openBundleDetail(item.bundle.id);
    } else if (item.asset) {
      // Breadcrumb context = the tree parent we opened it from (when a bundle).
      const fromBundle = item.parentId?.startsWith('bundle-') ? parseInt(item.parentId.slice(7), 10) : undefined;
      // Sub-assets (e.g. a PDF page) open their parent record.
      openDetailOverlay(item.asset.parent_asset_id ?? item.asset.id, fromBundle);
    }
  }, [openBundleDetail, openDetailOverlay]);

  const handleItemDoubleClick = useCallback((item: AssetTreeItem) => {
    // In AssetManager, double-click should open the detail view.
    handleItemView(item);
  }, [handleItemView]);

  // The collection an asset is deleted FROM = its parent in the tree. Deleting
  // removes membership there: last membership → destroyed, otherwise unlinked
  // (kept in its other collections). Built from the children cache — every cached
  // child's location is the bundle it's nested under.
  const ROOT = 0;
  const nodeParent = useMemo(() => {
    const m = new Map<string, number>();
    childrenCache.forEach((children, parentId) => {
      const outOf = parentId.startsWith('bundle-') ? parseInt(parentId.slice(7), 10) : ROOT;
      children.forEach((c: AssetNode) => m.set(c.id, outOf));
    });
    return m;
  }, [childrenCache]);

  // One out_of for a selection: the shared parent collection, else ROOT. Bundles
  // cascade regardless of out_of, so they don't constrain it.
  const outOfForSelection = useCallback((nodeIds: string[]): number => {
    const locs = new Set<number>();
    for (const id of nodeIds) {
      if (id.startsWith('bundle-')) continue;
      locs.add(nodeParent.get(id) ?? ROOT);
    }
    return locs.size === 1 ? Array.from(locs)[0] : ROOT;
  }, [nodeParent]);

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

    const confirmType = bundleIds.length > 0 ? 'bulk-bundles' : 'bulk-assets';
    if (items.length > 0) {
      const out_of = outOfForSelection(Array.from(selectedItems));
      setDeleteConfirmation({ type: confirmType as any, items, isOpen: true, preview: null, previewLoading: true, out_of });
      fetchDeletePreview(items, out_of);
    }
  }, [selectedItems, outOfForSelection]);

  const fetchDeletePreview = async (items: (AssetRead | BundleRead)[], out_of: number = ROOT) => {
    if (!activeInfospace?.id) return;
    try {
      const { TreeNavigationService } = await import('@/client');
      const nodeIds = items.map(item =>
        'kind' in item ? `asset-${item.id}` : `bundle-${item.id}`
      );
      const result = await TreeNavigationService.previewTreeDeletion({
        infospaceId: activeInfospace.id,
        requestBody: { node_ids: nodeIds, out_of },
      });
      setDeleteConfirmation(prev => ({ ...prev, preview: result as any, previewLoading: false, previewError: false }));
    } catch (err) {
      // Don't silently swallow — a failed preview must NOT look like a confident
      // "delete N items". Surface it so the user knows the impact is unknown.
      console.error('[AssetManager] Delete preview failed:', err);
      setDeleteConfirmation(prev => ({ ...prev, preview: null, previewLoading: false, previewError: true }));
    }
  };

  const handleDeleteAsset = async (asset: AssetRead, skipConfirmation = false) => {
    if (!skipConfirmation) {
      const out_of = nodeParent.get(`asset-${asset.id}`) ?? ROOT;
      setDeleteConfirmation({ type: 'asset', items: [asset], isOpen: true, preview: null, previewLoading: true, out_of });
      fetchDeletePreview([asset], out_of);
      return;
    }
    try {
      await deleteAsset(asset.id);
      toast.success(`Asset "${asset.title}" deleted.`);
      if (detailAssetId === asset.id) closeDetailOverlay();
      clearCache();
      await fetchRootTree();
    } catch (error) {
      toast.error('Failed to delete asset.');
    }
  };

  const handleDeleteBundle = async (bundle: BundleRead, skipConfirmation = false) => {
    if (!skipConfirmation) {
      setDeleteConfirmation({ type: 'bundle', items: [bundle], isOpen: true, preview: null, previewLoading: true, out_of: ROOT });
      fetchDeletePreview([bundle], ROOT);
      return;
    }
    try {
      await deleteBundle(bundle.id);
      toast.success(`Bundle "${bundle.name}" deleted.`);
      if (detailBundleId === bundle.id) closeDetailOverlay();
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
        requestBody: { node_ids: nodeIds, out_of: deleteConfirmation.out_of ?? ROOT }
      });
      
      const totalCount = assetsToDelete.length + bundlesToDelete.length;
      toast.success(`Successfully deleted ${totalCount} item(s).`);
      // Note any sources whose output bundle we just deleted — they're paused + flagged.
      const pausedSources = deleteConfirmation.preview?.paused_sources ?? 0;
      if (pausedSources > 0) {
        toast.warning(`${pausedSources} source${pausedSources !== 1 ? 's' : ''} paused — output bundle deleted. Re-point ${pausedSources !== 1 ? 'them' : 'it'} to resume.`);
      }
      setSelectedItems(new Set());
      closeDetailOverlay();

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
  }, [deleteConfirmation, clearCache, fetchRootTree, activeInfospace, closeDetailOverlay]);

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

  const handleSealBundle = async (bundle: BundleRead) => {
    const success = await sealBundle(bundle.id);
    if (success) { clearCache(); await fetchRootTree(); }
  };

  const handleUnsealBundle = async (bundle: BundleRead) => {
    const success = await unsealBundle(bundle.id);
    if (success) { clearCache(); await fetchRootTree(); }
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

  const handleCreateEmptyBundle = () => { setBundleSeed(null); setIsCreateBundleOpen(true); };
  const handleUploadToBundle = (bundle: BundleRead) => {
    setUploadToBundle(bundle);
    setCreateDialogMode('bundle');
    setIsCreateDialogOpen(true);
  };

  // Compose / edit articles in the dock (right column), so the middle AssetSelector
  // is the asset picker — drag assets straight from the tree into the editor.
  const handleCreateArticle = () => openComposer({ mode: 'create' });
  const handleEditArticle = (asset: AssetRead) => openComposer({ mode: 'edit', assetId: asset.id });

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

  // "+Bundle": gather the current selection into a new bundle. Assets become
  // members; selected bundles get nested as children. Opens the create dialog
  // pre-seeded so the user just names it.
  const handleCreateBundleFromSelection = useCallback(() => {
    const assetIds = transferItems.filter(i => i.type === 'asset').map(i => i.id);
    const childBundleIds = transferItems.filter(i => i.type === 'bundle').map(i => i.id);
    if (assetIds.length === 0 && childBundleIds.length === 0) return;
    setBundleSeed({ assetIds, childBundleIds });
    setIsCreateBundleOpen(true);
  }, [transferItems]);


  // Build AssetTreeItem[] from selection for sharing
  const buildShareItems = useCallback((clickedItem?: AssetTreeItem): AssetTreeItem[] => {
    // If items are selected (1 or more), share all of them
    if (selectedItems.size >= 1) {
      const items: AssetTreeItem[] = [];
      selectedItems.forEach(itemId => {
        const node = rootNodes.find(n => n.id === itemId) ||
                     Array.from(childrenCache.values()).flat().find(n => n.id === itemId);
        if (!node) return;
        const isBundle = itemId.startsWith('bundle-');
        const numericId = parseInt(itemId.replace(/^(bundle-|asset-|child-)/, ''));
        items.push({
          id: itemId,
          type: isBundle ? 'folder' : 'asset',
          name: node.name,
          level: 0,
          isExpanded: false,
          isSelected: true,
          isContainer: isBundle,
          bundle: isBundle ? { id: numericId, name: node.name } as any : undefined,
          asset: !isBundle ? { id: numericId, title: node.name } as any : undefined,
        });
      });
      if (items.length > 0) return items;
    }
    // Fallback: use the clicked item (context menu share without selection)
    if (clickedItem) return [clickedItem];
    return [];
  }, [selectedItems, rootNodes, childrenCache]);

  const handleShare = useCallback((item: AssetTreeItem) => {
    setSharingItems(buildShareItems(item));
  }, [buildShareItems]);

  const handleBulkShare = useCallback(() => {
    setSharingItems(buildShareItems());
  }, [buildShareItems]);

  // Bulk actions injected into the AssetSelector's own selection strip. Only the
  // manager surfaces destructive actions — inline pickers (chat, channel form)
  // leave the slot empty and keep just select-all / count / clear.
  const renderSelectionActions = useCallback(() => (
    <ButtonGroup>
      <Button variant="outline" size="sm" onClick={handleCreateBundleFromSelection} className="h-6 px-2 text-xs gap-1" title="Create bundle from selection">
        <FolderPlus className="h-3.5 w-3.5" />
        Bundle
      </Button>
      <ButtonGroupSeparator />
      <Button variant="outline" size="sm" onClick={handleBulkShare} className="h-6 px-2 text-xs" title="Share">
        <Share2 className="h-3.5 w-3.5" />
      </Button>
      <ButtonGroupSeparator />
      <Button variant="outline" size="sm" onClick={handleBulkExport} className="h-6 px-2 text-xs" title="Export">
        <Download className="h-3.5 w-3.5" />
      </Button>
      <ButtonGroupSeparator />
      <AssetTransferPopover selectedItems={transferItems} onComplete={() => setSelectedItems(new Set())} />
      <ButtonGroupSeparator />
      <Button variant="outline" size="sm" onClick={handleBulkDelete} className="h-6 px-2 text-xs text-red-600 hover:text-red-700" title="Delete">
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </ButtonGroup>
  ), [handleCreateBundleFromSelection, handleBulkShare, handleBulkExport, handleBulkDelete, transferItems]);

  const isItemFavorited = useCallback((item: AssetTreeItem): boolean => {
    // Check local overrides first (optimistic), then fall back to server data
    if (localFavorites.has(item.id)) return true;
    if (localUnfavorites.has(item.id)) return false;
    const tags = (item.asset?.tags ?? item.bundle?.tags ?? []) as string[];
    return tags.includes('favorite');
  }, [localFavorites, localUnfavorites]);

  const handleToggleFavorite = useCallback(async (item: AssetTreeItem) => {
    const isFav = isItemFavorited(item);
    const tags = (item.asset?.tags ?? item.bundle?.tags ?? []) as string[];
    const newTags = isFav ? tags.filter((t: string) => t !== 'favorite') : [...tags, 'favorite'];

    // Optimistic local update
    if (isFav) {
      setLocalFavorites(prev => { const n = new Set(prev); n.delete(item.id); return n; });
      setLocalUnfavorites(prev => new Set(prev).add(item.id));
    } else {
      setLocalUnfavorites(prev => { const n = new Set(prev); n.delete(item.id); return n; });
      setLocalFavorites(prev => new Set(prev).add(item.id));
    }

    try {
      if (item.asset) {
        await updateAsset(item.asset.id, { tags: newTags });
      } else if (item.bundle) {
        await updateBundle(item.bundle.id, { tags: newTags });
      }
      clearCache();
      await fetchRootTree();
    } catch {
      // Revert optimistic update
      if (isFav) {
        setLocalUnfavorites(prev => { const n = new Set(prev); n.delete(item.id); return n; });
        setLocalFavorites(prev => new Set(prev).add(item.id));
      } else {
        setLocalFavorites(prev => { const n = new Set(prev); n.delete(item.id); return n; });
        setLocalUnfavorites(prev => new Set(prev).add(item.id));
      }
      toast.error('Failed to update favorite');
    }
  }, [isItemFavorited, updateAsset, updateBundle, clearCache, fetchRootTree]);

  const renderItemBadge = useCallback((item: AssetTreeItem) => {
    const isFav = isItemFavorited(item);
    if (isFav) {
      return (
        <Star
          className="h-3.5 w-3.5 shrink-0 cursor-pointer fill-yellow-400 text-yellow-500"
          onClick={(e) => { e.stopPropagation(); handleToggleFavorite(item); }}
        />
      );
    }
    return (
      <Star
        className="h-3.5 w-3.5 shrink-0 cursor-pointer text-muted-foreground/40 invisible group-hover:visible hover:text-yellow-500"
        onClick={(e) => { e.stopPropagation(); handleToggleFavorite(item); }}
      />
    );
  }, [isItemFavorited, handleToggleFavorite]);

  const renderItemActions = (item: AssetTreeItem) => (
    <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={(e) => e.stopPropagation()}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuLabel>{item.type === 'folder' ? 'Folder' : 'Asset'} Actions</DropdownMenuLabel>
        {/* Only show view details on folders */}
        {item.type === 'folder' && <DropdownMenuItem onClick={() => handleItemView(item)}><Eye className="mr-2 h-4 w-4" /> View Details</DropdownMenuItem>}
        {item.type === 'folder' && item.bundle && (
          <>
            {!item.bundle.sealed && (
              <>
                <DropdownMenuItem onClick={() => handleUploadToBundle(item.bundle!)}><Upload className="mr-2 h-4 w-4" /> Add Files</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleEditBundle(item.bundle!)}><Settings className="mr-2 h-4 w-4" /> Edit Details</DropdownMenuItem>
              </>
            )}
            {item.bundle.sealed ? (
              <DropdownMenuItem onClick={() => handleUnsealBundle(item.bundle!)}><Unlock className="mr-2 h-4 w-4" /> Unseal</DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={() => handleSealBundle(item.bundle!)}><Lock className="mr-2 h-4 w-4" /> Seal</DropdownMenuItem>
            )}
          </>
        )}
        {item.type === 'asset' && item.asset && (
          <>
            <DropdownMenuItem onClick={() => handleEditAsset(item.asset!)}><Settings className="mr-2 h-4 w-4" /> Edit Details</DropdownMenuItem>
            {item.asset.kind === 'article' && (
              <DropdownMenuItem onClick={() => handleEditArticle(item.asset!)}><FileText className="mr-2 h-4 w-4" /> Edit Article</DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => requestEnrichment(item.asset!.id, 'ocr')}>
              <ScanEye className="mr-2 h-4 w-4" />
              {item.asset.enrichment_resolved?.includes('ocr') ? 'Re-run OCR' : 'Run OCR'}
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuItem onClick={() => handleToggleFavorite(item)}>
          <Star className={cn("mr-2 h-4 w-4", isItemFavorited(item) && "fill-yellow-400 text-yellow-500")} />
          {isItemFavorited(item) ? 'Unfavorite' : 'Favorite'}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleShare(item)}><Share2 className="mr-2 h-4 w-4" /> Share</DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExportItem(item)}><Download className="mr-2 h-4 w-4" /> Export</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-red-600"
          disabled={item.bundle?.sealed}
          onClick={() => item.asset ? handleDeleteAsset(item.asset) : item.bundle ? handleDeleteBundle(item.bundle) : null}
        >
          <Trash2 className="mr-2 h-4 w-4" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const ctxBtn = "relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground";
  const ctxSep = "my-1 h-px bg-border";

  const renderContextMenu = (item: AssetTreeItem | null) => {
    // Empty-space right-click
    if (!item) {
      return (
        <>
          <button className={ctxBtn} onClick={handleCreateArticle}>
            <FileText className="mr-2 h-4 w-4" /> New Article
          </button>
          <button className={ctxBtn} onClick={handleCreateEmptyBundle}>
            <FolderPlus className="mr-2 h-4 w-4" /> New Bundle
          </button>
        </>
      );
    }

    // Bundle
    if (item.type === 'folder' && item.bundle) {
      return (
        <>
          <button className={ctxBtn} onClick={() => handleItemView(item)}>
            <Eye className="mr-2 h-4 w-4" /> View Details
          </button>
          {!item.bundle.sealed && (
            <>
              <button className={ctxBtn} onClick={() => handleUploadToBundle(item.bundle!)}>
                <Upload className="mr-2 h-4 w-4" /> Add Files
              </button>
              <button className={ctxBtn} onClick={() => handleEditBundle(item.bundle!)}>
                <Settings className="mr-2 h-4 w-4" /> Edit Details
              </button>
            </>
          )}
          {item.bundle.sealed ? (
            <button className={ctxBtn} onClick={() => handleUnsealBundle(item.bundle!)}>
              <Unlock className="mr-2 h-4 w-4" /> Unseal
            </button>
          ) : (
            <button className={ctxBtn} onClick={() => handleSealBundle(item.bundle!)}>
              <Lock className="mr-2 h-4 w-4" /> Seal
            </button>
          )}
          <button className={ctxBtn} onClick={() => handleToggleFavorite(item)}>
            <Star className={cn("mr-2 h-4 w-4", isItemFavorited(item) && "fill-yellow-400 text-yellow-500")} />
            {isItemFavorited(item) ? 'Unfavorite' : 'Favorite'}
          </button>
          <button className={ctxBtn} onClick={() => handleShare(item)}>
            <Share2 className="mr-2 h-4 w-4" /> Share
          </button>
          <button className={ctxBtn} onClick={() => handleExportItem(item)}>
            <Download className="mr-2 h-4 w-4" /> Export
          </button>
          <div className={ctxSep} />
          <button
            className={cn(ctxBtn, "text-red-600", item.bundle.sealed && "opacity-50 pointer-events-none")}
            onClick={() => !item.bundle!.sealed && handleDeleteBundle(item.bundle!)}
          >
            <Trash2 className="mr-2 h-4 w-4" /> Delete
          </button>
        </>
      );
    }

    // Asset
    if (item.type === 'asset' && item.asset) {
      return (
        <>
          <button className={ctxBtn} onClick={() => handleItemView(item)}>
            <Eye className="mr-2 h-4 w-4" /> View Details
          </button>
          <button className={ctxBtn} onClick={() => handleEditAsset(item.asset!)}>
            <Settings className="mr-2 h-4 w-4" /> Edit Details
          </button>
          {item.asset.kind === 'article' && (
            <button className={ctxBtn} onClick={() => handleEditArticle(item.asset!)}>
              <FileText className="mr-2 h-4 w-4" /> Edit Article
            </button>
          )}
          <button className={ctxBtn} onClick={() => handleToggleFavorite(item)}>
            <Star className={cn("mr-2 h-4 w-4", isItemFavorited(item) && "fill-yellow-400 text-yellow-500")} />
            {isItemFavorited(item) ? 'Unfavorite' : 'Favorite'}
          </button>
          <button className={ctxBtn} onClick={() => handleShare(item)}>
            <Share2 className="mr-2 h-4 w-4" /> Share
          </button>
          <button className={ctxBtn} onClick={() => handleExportItem(item)}>
            <Download className="mr-2 h-4 w-4" /> Export
          </button>
          <div className={ctxSep} />
          <button className={cn(ctxBtn, "text-red-600")} onClick={() => handleDeleteAsset(item.asset!)}>
            <Trash2 className="mr-2 h-4 w-4" /> Delete
          </button>
        </>
      );
    }

    return null;
  };

  if (!activeInfospace) {
    return <div className="flex items-center justify-center h-full"><p>Please select an Infospace.</p></div>;
  }

  return (
    <TextSpanHighlightProvider>
      <div className="flex h-full min-h-0 flex-1 w-full min-w-0 flex-col overflow-hidden px-1 sm:px-2">
        <div className="flex items-center hidden sm:flex justify-between mb-3 px-2">
          
        </div>
        <div className="flex-none mb-3 md:mb-1 px-1">
          {isMobile ? (
            /* Mobile — C5: Add hub · Web Search · Sources · Write · Folder · Feed */
            <div className="flex flex-wrap items-center gap-2">
              <ButtonGroup>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" className="h-8 gap-1 px-3 text-xs rounded-xs">
                      <Plus className="h-3.5 w-3.5" /> Add <ChevronDown className="h-3.5 w-3.5 opacity-70" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-52">
                    <DropdownMenuItem onClick={() => { setCreateDialogMode('individual'); setCreateDialogInitialFocus('file'); setIsCreateDialogOpen(true); }}>
                      <Upload className="mr-2 h-4 w-4" /> Upload files
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { setCreateDialogMode('individual'); setCreateDialogInitialFocus('url'); setIsCreateDialogOpen(true); }}>
                      <LinkIcon className="mr-2 h-4 w-4" /> From URL(s)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { setCreateDialogMode('individual'); setCreateDialogInitialFocus('text'); setIsCreateDialogOpen(true); }}>
                      <Type className="mr-2 h-4 w-4" /> Paste text
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => openDiscover({ method: 'feed' })}>
                      <Rss className="mr-2 h-4 w-4" /> RSS feed
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => document.getElementById('import-file-input')?.click()}>
                      <Download className="mr-2 h-4 w-4" /> Import package
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button variant="ghost" size="sm" className="h-8 px-2.5 text-xs" onClick={() => openDiscover()}>
                  <Search className="mr-1.5 h-3.5 w-3.5" /> Web Search
                </Button>
                <Button variant="ghost" size="sm" className={cn('h-8 px-2.5 text-xs', showSourcesRail && 'bg-muted')} onClick={() => setShowSourcesRail((s) => !s)}>
                  <RadioTower className="mr-1.5 h-3.5 w-3.5" /> Sources
                </Button>
              </ButtonGroup>

              <ButtonGroup>
                <Button variant="ghost" size="sm" className="h-8 px-2.5 text-xs" onClick={handleCreateArticle}>
                  <FileText className="mr-1.5 h-3.5 w-3.5" /> Write
                </Button>
                <Button variant="ghost" size="sm" className="h-8 px-2.5 text-xs" onClick={handleCreateEmptyBundle}>
                  <FolderPlus className="mr-1.5 h-3.5 w-3.5" /> Folder
                </Button>
              </ButtonGroup>

              <Button
                variant="default"
                size="sm"
                className="ml-auto h-8 bg-amber-600 px-2.5 text-xs hover:bg-amber-700"
                onClick={() => setShowMobileDetail(true)}
              >
                <Folder className="mr-1.5 h-3.5 w-3.5" /> Feed
              </Button>

              <input type="file" id="import-file-input" style={{ display: 'none' }} onChange={handleImportFile} accept=".zip,.json" />
            </div>
          ) : (
            /* Desktop — C5: Add hub · Web Search · Sources ┆ Write · Folder */
            <div className="flex items-center justify-between gap-2">
              <ButtonGroup>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" className="h-8 gap-1 px-3 text-xs">
                      <Plus className="h-3.5 w-3.5" /> Add <ChevronDown className="h-3.5 w-3.5 opacity-70" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-52">
                    <DropdownMenuItem onClick={() => { setCreateDialogMode('individual'); setCreateDialogInitialFocus('file'); setIsCreateDialogOpen(true); }}>
                      <Upload className="mr-2 h-4 w-4" /> Upload files
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { setCreateDialogMode('individual'); setCreateDialogInitialFocus('url'); setIsCreateDialogOpen(true); }}>
                      <LinkIcon className="mr-2 h-4 w-4" /> From URL(s)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { setCreateDialogMode('individual'); setCreateDialogInitialFocus('text'); setIsCreateDialogOpen(true); }}>
                      <Type className="mr-2 h-4 w-4" /> Paste text
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => openDiscover({ method: 'feed' })}>
                      <Rss className="mr-2 h-4 w-4" /> RSS feed
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => document.getElementById('import-file-input')?.click()}>
                      <Download className="mr-2 h-4 w-4" /> Import package
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button variant="ghost" size="sm" className="h-8 px-2.5 text-xs" onClick={() => openDiscover()}>
                  <Search className="mr-1.5 h-3.5 w-3.5" /> Web Search
                </Button>
                <Button variant="ghost" size="sm" className={cn('h-8 px-2.5 text-xs', showSourcesRail && 'bg-muted')} onClick={() => setShowSourcesRail((s) => !s)}>
                  <RadioTower className="mr-1.5 h-3.5 w-3.5" /> Sources
                </Button>
              </ButtonGroup>

              <input type="file" id="import-file-input" style={{ display: 'none' }} onChange={handleImportFile} accept=".zip,.json" />

              <ButtonGroup>
                <Button variant="ghost" size="sm" className="h-8 px-2.5 text-xs" onClick={handleCreateArticle}>
                  <FileText className="mr-1.5 h-3.5 w-3.5" /> Write
                </Button>
                <Button variant="ghost" size="sm" className="h-8 px-2.5 text-xs" onClick={handleCreateEmptyBundle}>
                  <FolderPlus className="mr-1.5 h-3.5 w-3.5" /> Folder
                </Button>
              </ButtonGroup>
            </div>
          )}
        </div>

        {/* Main Content */}
        <div className="flex-1 min-h-0 min-w-0 overflow-hidden p-1 backdrop-blur">
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
                  renderContextMenu={renderContextMenu}
                  renderItemBadge={renderItemBadge}
                  renderSelectionActions={renderSelectionActions}
                  onSearchTermChange={setSearchTermFromSelector}
                />
              </div>

              {/* Mobile Detail Sheet - slides in from right */}
              <Sheet open={showMobileDetail} onOpenChange={setShowMobileDetail}>
                <SheetContent side="right" className="flex w-full flex-col p-0 sm:w-full">
                  
                  <div className="mt-10 flex min-h-0 flex-1 flex-col overflow-hidden">
                    {/* Feed (home). Tapping an item closes this sheet and opens the dock sheet. */}
                    <div className="flex h-full flex-col overflow-hidden">
                      <div className="flex-none border-b px-2 py-1.5">
                        <ChannelTabs
                          channels={channels}
                          activeChannelId={activeChannelId}
                          onSelect={handleSelectChannel}
                          onAddChannel={() => { setEditingChannel(null); setIsChannelDialogOpen(true); }}
                          onEditChannel={(ch) => { setEditingChannel(ch); setIsChannelDialogOpen(true); }}
                          favoritesView={preferences.favorites_view ?? 'list'}
                          onSetFavoritesView={setFavoritesView}
                          allView={preferences.all_view ?? 'list'}
                          onSetAllView={setAllView}
                          defaultChannelId={preferences.default_channel_id}
                          onSetDefault={async (id) => { await useUserPreferencesStore.getState().updatePreference('default_channel_id', id); }}
                        />
                      </div>
                      <div className="flex-1 min-h-0 overflow-hidden">
                        <ChannelFeedContent
                          channelId={activeChannelId}
                          channels={channels}
                          onAssetClick={(asset) => { setShowMobileDetail(false); openDetailOverlay(asset.id, (asset as any).bundle_ids?.find((b: number) => b && b !== 0)); }}
                          onBundleClick={(bundleId) => { setShowMobileDetail(false); openBundleDetail(bundleId); }}
                        />
                      </div>
                    </div>
                  </div>
                </SheetContent>
              </Sheet>

              {/* Mobile Sources rail → left sheet (desktop shows it as a column). */}
              <Sheet open={showSourcesRail} onOpenChange={setShowSourcesRail}>
                <SheetContent side="left" className="flex w-[88vw] flex-col p-0 sm:w-[360px]">
                  <div className="mt-10 flex min-h-0 flex-1 flex-col overflow-hidden">
                    <SourceList mode="panel" init={undefined} fullscreen={false} close={() => setShowSourcesRail(false)} escalate={() => {}} />
                  </div>
                </SheetContent>
              </Sheet>
            </>
          ) : (
            /* Desktop — Sources rail (toggle) · AssetSelector · Feed/Dock */
            <div ref={sourceStreamsWrapRef} className="relative flex h-full min-h-0 w-full min-w-0">
              {/* Sources rail — fixed width, no drag handle. When streams are
                  being traced, open a gutter to its right so the curves have a
                  channel to fan out into instead of piling up on the seam. */}
              {showSourcesRail && (
                <div className={cn('h-full w-60 shrink-0 overflow-hidden transition-[margin] duration-300', sourceStreams.length > 0 && 'mr-12')}>
                  <SourceList mode="panel" init={undefined} fullscreen={false} close={() => setShowSourcesRail(false)} escalate={() => {}} streams={sourceStreamControls} />
                </div>
              )}

              <ResizablePanelGroup direction="horizontal" className="h-full min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg border-primary/60">
                <ResizablePanel defaultSize={40} minSize={18} maxSize={70} className="min-h-0 min-w-0 overflow-hidden">
                  <div className="h-full w-full overflow-hidden min-w-0 pr-1">
                    <AssetSelector
                      selectedItems={selectedItems}
                      onSelectionChange={setSelectedItems}
                      onItemView={handleItemView}
                      onItemDoubleClick={handleItemDoubleClick}
                      renderItemActions={renderItemActions}
                      renderContextMenu={renderContextMenu}
                      renderItemBadge={renderItemBadge}
                      renderSelectionActions={renderSelectionActions}
                      onSearchTermChange={setSearchTermFromSelector}
                      revealBundleIds={revealBundleIds}
                      openBundleIds={openBundleIds}
                    />
                  </div>
                </ResizablePanel>

                <ResizableHandle withHandle className="bg-border" />

                <ResizablePanel defaultSize={60} minSize={20} maxSize={82} className="min-h-0 min-w-0 overflow-hidden">
                  {dockEntry ? (
                    <DockHost />
                  ) : (
                    <div className="flex h-full min-h-0 w-full flex-col border-l overflow-hidden">
                      {/* Feed (home) — the dock's default view; detail/discover replace it here. */}
                      <div className="flex-none border-b px-2 py-1.5">
                        <ChannelTabs
                          channels={channels}
                          activeChannelId={activeChannelId}
                          onSelect={handleSelectChannel}
                          onAddChannel={() => { setEditingChannel(null); setIsChannelDialogOpen(true); }}
                          onEditChannel={(ch) => { setEditingChannel(ch); setIsChannelDialogOpen(true); }}
                          favoritesView={preferences.favorites_view ?? 'list'}
                          onSetFavoritesView={setFavoritesView}
                          allView={preferences.all_view ?? 'list'}
                          onSetAllView={setAllView}
                          defaultChannelId={preferences.default_channel_id}
                          onSetDefault={async (id) => { await useUserPreferencesStore.getState().updatePreference('default_channel_id', id); }}
                        />
                      </div>
                      <div className="flex-1 min-h-0 overflow-hidden">
                        <ChannelFeedContent
                          channelId={activeChannelId}
                          channels={channels}
                          onAssetClick={(asset) => openDetailOverlay(asset.id, (asset as any).bundle_ids?.find((b: number) => b && b !== 0))}
                          onBundleClick={(bundleId) => openBundleDetail(bundleId)}
                        />
                      </div>
                    </div>
                  )}
                </ResizablePanel>
              </ResizablePanelGroup>

              {/* Source→bundle streams — drawn over the rail + tree, anchored by
                  data-source-id / data-bundle-id. No-ops when nothing is traced. */}
              <SourceStreams containerRef={sourceStreamsWrapRef} streams={sourceStreams} />
            </div>
          )}
        </div>

        {/* Dialogs */}
        <CreateAssetDialog open={isCreateDialogOpen} onClose={() => { setIsCreateDialogOpen(false); setUploadToBundle(null); setCreateDialogInitialFocus(undefined); }} mode={createDialogMode} initialFocus={createDialogInitialFocus} existingBundleId={uploadToBundle?.id} existingBundleName={uploadToBundle?.name} />
        <CreateBundleDialog
          open={isCreateBundleOpen}
          onClose={() => { setIsCreateBundleOpen(false); setBundleSeed(null); }}
          initialAssetIds={bundleSeed?.assetIds}
          initialChildBundleIds={bundleSeed?.childBundleIds}
          onCreated={async () => {
            if (bundleSeed) setSelectedItems(new Set());
            clearCache();
            await fetchRootTree();
          }}
        />
        {sharingItems.length > 0 && <ShareSelectionDialog items={sharingItems} onClose={() => setSharingItems([])} />}
        {editingAsset && <EditAssetOverlay open={true} onClose={() => setEditingAsset(null)} asset={editingAsset} onSave={handleSaveAsset} />}
        {editingBundle && <BundleEditDialog open={true} onClose={() => setEditingBundle(null)} bundle={editingBundle} onSave={handleSaveBundle} />}

        {/* Channel Create/Edit Dialog */}
        <AlertDialog open={isChannelDialogOpen} onOpenChange={(open) => { if (!open) { setIsChannelDialogOpen(false); setEditingChannel(null); } }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{editingChannel ? 'Edit Channel' : 'New Channel'}</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <ChannelForm
                  initial={editingChannel}
                  onSave={async (data) => {
                    if (editingChannel) {
                      await updateChannel(editingChannel.id, data);
                    } else {
                      await addChannel(data);
                    }
                    setIsChannelDialogOpen(false);
                    setEditingChannel(null);
                  }}
                  onDelete={editingChannel ? async () => {
                    await removeChannel(editingChannel.id);
                    setIsChannelDialogOpen(false);
                    setEditingChannel(null);
                  } : undefined}
                  onCancel={() => { setIsChannelDialogOpen(false); setEditingChannel(null); }}
                  isDefault={editingChannel ? preferences.default_channel_id === editingChannel.id : false}
                  onSetDefault={editingChannel ? async () => {
                    await useUserPreferencesStore.getState().updatePreference('default_channel_id', editingChannel.id);
                  } : undefined}
                />
              </AlertDialogDescription>
            </AlertDialogHeader>
          </AlertDialogContent>
        </AlertDialog>

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={deleteConfirmation.isOpen} onOpenChange={(open) => !open && setDeleteConfirmation({ type: 'asset', items: [], isOpen: false, preview: null })}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm Deletion</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2">
                  {deleteConfirmation.previewLoading ? (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Analyzing impact...
                    </div>
                  ) : deleteConfirmation.preview ? (
                    <>
                      <p>{deleteConfirmation.preview.message}</p>
                      <div className="flex flex-wrap gap-3 text-xs pt-1">
                        {deleteConfirmation.preview.bundles > 0 && (
                          <span className="text-orange-600 dark:text-orange-400">{deleteConfirmation.preview.bundles} bundle{deleteConfirmation.preview.bundles !== 1 ? 's' : ''} destroyed</span>
                        )}
                        {deleteConfirmation.preview.destroyed_assets > 0 && (
                          <span className="text-red-600 dark:text-red-400">{deleteConfirmation.preview.destroyed_assets} asset{deleteConfirmation.preview.destroyed_assets !== 1 ? 's' : ''} permanently deleted</span>
                        )}
                        {deleteConfirmation.preview.unlinked > 0 && (
                          <span className="text-muted-foreground">{deleteConfirmation.preview.unlinked} asset{deleteConfirmation.preview.unlinked !== 1 ? 's' : ''} unlinked (survive elsewhere)</span>
                        )}
                      </div>
                      {(deleteConfirmation.preview.paused_sources ?? 0) > 0 && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 pt-1">
                          ⚠ {deleteConfirmation.preview.paused_sources} source{deleteConfirmation.preview.paused_sources !== 1 ? 's' : ''} output here — polling will be paused and flagged.
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground pt-1">This cannot be undone.</p>
                    </>
                  ) : deleteConfirmation.previewError ? (
                    <>
                      <p className="text-amber-600 dark:text-amber-400">Couldn't compute the deletion impact.</p>
                      <p className="text-xs text-muted-foreground pt-1">
                        You can still delete {deleteConfirmation.items.length} item{deleteConfirmation.items.length !== 1 ? 's' : ''}, but the exact number of affected assets is unknown. This cannot be undone.
                      </p>
                    </>
                  ) : (
                    <p>Are you sure you want to delete {deleteConfirmation.items.length} item{deleteConfirmation.items.length !== 1 ? 's' : ''}? This cannot be undone.</p>
                  )}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={executeDelete} className="bg-red-600 hover:bg-red-700" disabled={deleteConfirmation.previewLoading}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TextSpanHighlightProvider>
  );
}
