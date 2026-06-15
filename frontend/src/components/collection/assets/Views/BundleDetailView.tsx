'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { DockBack, DockClose } from '@/components/collection/intake/DockNav';
import {
  Layers,
  Download,
  Share2,
  PlayCircle,
  MoreHorizontal,
  Upload,
  File,
  Folder,
  FolderOutput,
  Loader2,
  Pencil,
  Check,
  X,
} from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { useBundleStore } from '@/zustand_stores/storeBundles';
import { useDock } from '@/zustand_stores/storeDock';
import { DetailBreadcrumb, useBundlePath } from './DetailBreadcrumb';
import { formatDistanceToNowStrict } from 'date-fns';
import { toast } from 'sonner';
import {
  AssetRead,
  AssetKind,
  BundleRead,
} from '@/client';
import type { AssetNode } from '@/client';
import { useTreeStore } from '@/zustand_stores/storeTree';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import AssetDetailView from './AssetDetailView';
import { getAssetIcon } from '@/components/collection/assets/AssetSelector';
import { AssetFeedView } from '@/components/collection/assets/Feed';
import { isDisplayableKind } from '@/components/collection/assets/assetKindConfig';
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

// Asset composition stats helper. Counts top-level children per kind; the
// legacy per-kind "+N sub-items" aggregation (CSV rows, PDF pages) relied on
// file_info which no longer rides on AssetNode, so it's dropped here.
const getCompositionStats = (children: AssetNode[]) => {
  const stats = new Map<AssetKind, { count: number }>();

  children.forEach(node => {
    if (node.type === 'asset' && node.kind) {
      const current = stats.get(node.kind) || { count: 0 };
      current.count += 1;
      stats.set(node.kind, current);
    }
  });

  return { stats };
};

// Note: AssetFeedView now loads bundle children directly via AssetSelector
// when filterByBundleId is provided, so we don't need conversion functions

interface BundleDetailViewProps {
  selectedBundleId: number | null;
  onLoadIntoRunner?: (runId: number, runName: string) => void;
  selectedAssetId: number | null;
  onAssetSelect: (id: number | null) => void;
  onAssetDragStart?: (asset: AssetRead, event: React.DragEvent) => void;
  onAssetDragEnd?: () => void;
  highlightAssetId: number | null;
  layout?: 'grid' | 'bento' | 'list';
  /** Dock navigation, rendered in the bundle header (omitted in annotation overlays). */
  onBack?: () => void;
  onClose?: () => void;
}

export default function BundleDetailView({
  selectedBundleId,
  onLoadIntoRunner,
  selectedAssetId,
  onAssetSelect,
  onAssetDragStart,
  onAssetDragEnd,
  highlightAssetId,
  layout = 'list',
  onBack,
  onClose,
}: BundleDetailViewProps) {
  const { activeInfospace } = useInfospaceStore();
  const {
    childrenCache,
    fetchChildren,
    getFullBundle,
  } = useTreeStore();

  const [selectedBundle, setSelectedBundle] = useState<BundleRead | null>(null);
  const displayName = selectedBundle?.name;

  // Breadcrumb: this bundle's ancestor chain (from the bundle store), clickable
  // to navigate up. Always derivable from parent_bundle_id — no context needed.
  const openBundle = useDock((s) => s.openBundle);
  const bundlePath = useBundlePath(selectedBundleId);
  const breadcrumbSegments = bundlePath.filter((c) => c.id !== selectedBundleId);

  // Inline editing of the bundle's name + description (direct in the header,
  // not an overlay). updateBundle (store) toasts on its own.
  const { updateBundle } = useBundleStore();
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const startEdit = useCallback(() => {
    if (!selectedBundle) return;
    setDraftName(selectedBundle.name ?? '');
    setDraftDescription(selectedBundle.description ?? '');
    setEditing(true);
  }, [selectedBundle]);

  const cancelEdit = useCallback(() => setEditing(false), []);

  const saveEdit = useCallback(async () => {
    if (!selectedBundle) return;
    const name = draftName.trim();
    if (!name) { toast.error('Bundle name is required.'); return; }
    setIsSaving(true);
    const updated = await updateBundle(selectedBundle.id, {
      name,
      description: draftDescription.trim() || null,
    });
    setIsSaving(false);
    if (updated) {
      setSelectedBundle(updated);
      setEditing(false);
    }
  }, [selectedBundle, draftName, draftDescription, updateBundle]);

  // Load bundle details. Changing/leaving the bundle also drops out of edit mode.
  useEffect(() => {
    setEditing(false);
    if (selectedBundleId) {
      getFullBundle(selectedBundleId).then(bundle => setSelectedBundle(bundle || null));
      const bundleNodeId = `bundle-${selectedBundleId}`;
      if (!childrenCache.has(bundleNodeId)) {
        fetchChildren(bundleNodeId);
      }
    } else {
      setSelectedBundle(null);
    }
  }, [selectedBundleId, getFullBundle, fetchChildren, childrenCache]);

  // Get children from cache for metadata display
  const bundleChildren = useMemo(() => {
    if (selectedBundleId) {
      return childrenCache.get(`bundle-${selectedBundleId}`) || [];
    }
    return [];
  }, [selectedBundleId, childrenCache]);

  // Get available kinds for filter badges (still used by AssetFeedView)
  const availableKinds = useMemo(() => {
    const kinds = new Set<AssetKind>();
    bundleChildren.forEach(node => {
      if (node.type === 'asset' && node.kind && isDisplayableKind(node.kind)) {
        kinds.add(node.kind);
      }
    });
    return Array.from(kinds);
  }, [bundleChildren]);

  // Compute composition stats
  const { stats: compositionStats } = useMemo(() =>
    getCompositionStats(bundleChildren), [bundleChildren]
  );

  // Handle asset click from feed
  const handleAssetClick = useCallback((asset: AssetRead) => {
    onAssetSelect(asset.id);
  }, [onAssetSelect]);

  // If viewing a specific asset, show asset detail view
  if (selectedAssetId) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <div className="flex-none border-b p-2 sm:p-3">
          <div className="flex items-center gap-2 min-w-0">
            <Button 
              variant="ghost" 
              size="sm"
              onClick={() => onAssetSelect(null)}
              className="h-7 sm:h-7 px-2 shrink-0"
            >
              <FolderOutput className="h-3 w-3 sm:h-4 sm:w-4 text-blue-400 mr-1" />
              <span className="text-xs sm:text-sm">Back to Bundle</span>
            </Button>
            <Separator orientation="vertical" className="h-4" />
            <span className="text-xs sm:text-sm text-muted-foreground truncate flex-1 min-w-0">
              {displayName}
            </span>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
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
  if (!selectedBundleId) {
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
  // When viewing a Bundle, wait for it to load
  if (selectedBundleId && !selectedBundle) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <div className="text-center">
          <Loader2 className="h-12 w-12 mx-auto text-muted-foreground mb-4 animate-spin" />
          <p className="text-sm text-muted-foreground">Loading bundle...</p>
        </div>
      </div>
    );
  }

  // Main bundle view with tree
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* Bundle Header — 3 rows: breadcrumb path · info+actions · description */}
      <div className="flex-none border-b px-3 py-1.5">
        {/* Row 1 — breadcrumb path + close */}
        <div className="flex w-full min-w-0 items-center gap-2">
          {onBack && <DockBack onClick={onBack} className="-ml-1" />}
          <DetailBreadcrumb
            className="min-w-0 flex-1"
            segments={breadcrumbSegments}
            onSegmentClick={openBundle}
            leafIcon={<Folder className="size-4 shrink-0 text-blue-400" />}
            leafLabel={displayName || (selectedBundle ? `Bundle ${selectedBundle.id}` : '')}
            leafInput={editing ? (
              <input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                autoFocus
                aria-label="Bundle name"
                className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm font-semibold text-foreground shadow-none outline-none ring-0 focus:outline-none focus-visible:outline-none"
              />
            ) : undefined}
          />
          {onClose && <DockClose onClick={onClose} />}
        </div>

        {/* Row 2 — condensed info | actions */}
        <div className="mt-1.5 flex w-full min-w-0 items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-xs text-muted-foreground">
            <span className="flex shrink-0 items-center gap-1"><File className="h-3 w-3" />{bundleChildren.length} items</span>
            <span className="text-muted-foreground/40">·</span>
            <span className="shrink-0">Updated {formatDistanceToNowStrict(new Date(selectedBundle?.updated_at || 0), { addSuffix: true })}</span>
            {Array.from(compositionStats.entries()).length > 0 && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span className="hidden shrink-0 items-center gap-2 sm:flex">
                  {Array.from(compositionStats.entries()).map(([kind, data]) => (
                    <TooltipProvider key={kind} delayDuration={100}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="flex items-center gap-1">{getAssetIcon(kind, "h-3 w-3")}<span className="font-medium">{data.count}</span></span>
                        </TooltipTrigger>
                        <TooltipContent><p>{data.count} {kind.replace('_', ' ')} file{data.count > 1 ? 's' : ''}</p></TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ))}
                </span>
              </>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            {editing ? (
              <>
                <Button size="sm" onClick={saveEdit} disabled={isSaving} className="h-7 px-2">
                  {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin sm:mr-1" /> : <Check className="h-3.5 w-3.5 sm:mr-1" />}
                  <span className="hidden sm:inline">Save</span>
                </Button>
                <Button variant="ghost" size="sm" onClick={cancelEdit} disabled={isSaving} className="h-7 px-2">
                  <X className="h-3.5 w-3.5 sm:mr-1" />
                  <span className="hidden sm:inline">Cancel</span>
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" size="icon" className="size-7 text-muted-foreground" title="Edit bundle" onClick={startEdit}>
                  <Pencil className="size-3.5" />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-7"><MoreHorizontal className="h-4 w-4" /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Bundle Actions</DropdownMenuLabel>
                    <DropdownMenuItem onClick={startEdit}><Pencil className="mr-2 h-4 w-4" />Edit Details</DropdownMenuItem>
                    <DropdownMenuItem><Share2 className="mr-2 h-4 w-4" />Share Bundle</DropdownMenuItem>
                    <DropdownMenuItem><Download className="mr-2 h-4 w-4" />Export Bundle</DropdownMenuItem>
                    {onLoadIntoRunner && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => onLoadIntoRunner(1, 'Default Runner')}><PlayCircle className="mr-2 h-4 w-4" />Load into Runner</DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button variant="default" size="sm" onClick={() => { toast.info("Upload to bundle functionality coming soon"); }} className="h-7 bg-primary px-2 hover:bg-primary/90">
                  <Upload className="h-3.5 w-3.5 sm:mr-1" />
                  <span className="hidden sm:inline">Add Files</span>
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Row 3 — description (editable) */}
        {editing ? (
          <Textarea
            value={draftDescription}
            onChange={(e) => setDraftDescription(e.target.value)}
            placeholder="Add a description…"
            rows={2}
            className="mt-2 text-sm"
          />
        ) : selectedBundle?.description ? (
          <p className="mt-1.5 text-sm text-muted-foreground">{selectedBundle.description}</p>
        ) : null}
      </div>

      {/* Bundle Contents - Feed View */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <AssetFeedView
          infospaceId={activeInfospace?.id}
          filterByBundleId={selectedBundleId ?? undefined}
          availableKinds={availableKinds}
          onAssetClick={handleAssetClick}
          onBundleClick={openBundle}
          title={``}
          cardSize="sm"
          columns={2}
          showControls={true}
          emptyMessage="No items in this view yet."
          layout={layout}
        />
      </div>
    </div>
  );
}
