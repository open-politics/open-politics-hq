'use client';

import React, { useState, useCallback } from 'react';
import { FolderOpen, Folder, FileText, MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AssetKind, AssetNode } from '@/client';
import { getAssetIcon } from './assetKindConfig';
import { TreeRow } from './TreeRow';
import { Button } from '@/components/ui/button';

/* ─── Data types ─── */

export interface TreeViewItem {
  id: string;
  type: 'folder' | 'asset';
  name: string;
  /** Explicit icon — overrides the built-in folder/asset icon logic. `null` = no icon. */
  icon?: React.ReactNode | null;
  kind?: AssetKind;
  children?: TreeViewItem[];
  /** Can have lazily-loaded children (shows expand chevron even when children is empty) */
  isContainer?: boolean;
  updatedAt?: string;
  sealed?: boolean;
  /** Arbitrary data consumers can attach (provenance info, permissions, etc.) */
  meta?: Record<string, unknown>;
}

/** Return type for paginated child loading */
export interface TreeLoadResult {
  items: TreeViewItem[];
  hasMore: boolean;
}

/** Convert a backend AssetNode to a TreeViewItem */
export function treeNodeToViewItem(node: AssetNode): TreeViewItem {
  return {
    id: node.id,
    type: node.type === 'bundle' ? 'folder' : 'asset',
    name: node.name,
    kind: node.kind ?? undefined,
    isContainer: node.type === 'bundle' || !!node.has_children,
    updatedAt: node.updated_at,
    sealed: node.sealed ?? undefined,
  };
}

/* ─── Component props ─── */

export interface TreeViewProps {
  items: TreeViewItem[];

  /**
   * Lazy-load children for a node. Called on first expand and on "load more".
   * `offset` is 0 on first load, then the count of already-loaded children.
   */
  onLoadChildren?: (id: string, offset: number) => Promise<TreeLoadResult>;
  loadingIds?: Set<string>;

  /** Extra content after the icon (badges, labels) */
  renderBadge?: (item: TreeViewItem) => React.ReactNode;
  /** Right-side hover actions */
  renderActions?: (item: TreeViewItem) => React.ReactNode;

  onItemClick?: (item: TreeViewItem) => void;

  className?: string;
  /** IDs expanded on first render */
  defaultExpandedIds?: Set<string>;
}

/* ─── Component ─── */

export function TreeView({
  items,
  onLoadChildren,
  loadingIds: externalLoadingIds,
  renderBadge,
  renderActions,
  onItemClick,
  className,
  defaultExpandedIds,
}: TreeViewProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => defaultExpandedIds ?? new Set(),
  );
  const [childrenCache, setChildrenCache] = useState<Map<string, TreeViewItem[]>>(
    () => new Map(),
  );
  const [hasMoreMap, setHasMoreMap] = useState<Map<string, boolean>>(() => new Map());
  const [internalLoadingIds, setInternalLoadingIds] = useState<Set<string>>(new Set());

  const loadingIds = externalLoadingIds ?? internalLoadingIds;

  const loadChildren = useCallback(async (id: string, item: TreeViewItem, offset: number) => {
    if (!onLoadChildren || loadingIds.has(id)) return;

    setInternalLoadingIds(prev => { const next = new Set(prev); next.add(id); return next; });
    try {
      const result = await onLoadChildren(id, offset);
      setChildrenCache(prev => {
        const next = new Map(prev);
        if (offset === 0) {
          next.set(id, result.items);
        } else {
          next.set(id, [...(prev.get(id) ?? []), ...result.items]);
        }
        return next;
      });
      setHasMoreMap(prev => { const next = new Map(prev); next.set(id, result.hasMore); return next; });
    } finally {
      setInternalLoadingIds(prev => { const next = new Set(prev); next.delete(id); return next; });
    }
  }, [onLoadChildren, loadingIds]);

  const toggleExpanded = useCallback(async (id: string, item: TreeViewItem) => {
    const isCurrentlyExpanded = expandedIds.has(id);

    if (isCurrentlyExpanded) {
      setExpandedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
      return;
    }

    // Expanding — check if we need to lazy-load children
    const hasChildren = (item.children && item.children.length > 0) || childrenCache.has(id);
    if (!hasChildren && item.isContainer) {
      await loadChildren(id, item, 0);
    }

    setExpandedIds(prev => { const next = new Set(prev); next.add(id); return next; });
  }, [expandedIds, childrenCache, loadChildren]);

  const renderItem = useCallback((item: TreeViewItem, depth: number) => {
    const cachedChildren = childrenCache.get(item.id);
    const resolvedChildren = item.children ?? cachedChildren;
    const hasChildren = resolvedChildren && resolvedChildren.length > 0;
    const canExpand = hasChildren || !!item.isContainer;
    const isExpanded = expandedIds.has(item.id);
    const isLoading = loadingIds.has(item.id);
    const isFolder = item.type === 'folder';
    const hasMore = hasMoreMap.get(item.id) ?? false;

    // Icon: explicit icon wins (null = intentionally none), then folder/asset-kind fallbacks
    let icon: React.ReactNode;
    if (item.icon !== undefined) {
      icon = item.icon;
    } else if (isFolder) {
      icon = isExpanded
        ? <FolderOpen className="h-4 w-4 text-blue-400" />
        : <Folder className="h-4 w-4 text-blue-400" />;
    } else if (item.kind) {
      icon = getAssetIcon(item.kind, 'h-4 w-4');
    } else {
      icon = <FileText className="h-4 w-4 text-muted-foreground" />;
    }

    return (
      <TreeRow
        key={item.id}
        depth={depth}
        canExpand={canExpand}
        isExpanded={isExpanded}
        isLoading={isLoading}
        onToggle={() => toggleExpanded(item.id, item)}
        icon={icon}
        content={
          <div className="flex items-center gap-2 overflow-hidden">
            {renderBadge?.(item)}
            <span className={cn(
              'text-sm truncate',
              isFolder ? 'font-medium' : 'font-normal',
            )}>
              {item.name}
            </span>
          </div>
        }
        actions={renderActions?.(item)}
        className={cn(
          isFolder
            ? 'mb-0.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 py-1.5 px-3'
            : 'py-1 px-3',
        )}
        onClick={(e) => {
          e.stopPropagation();
          if (canExpand) {
            toggleExpanded(item.id, item);
          }
          onItemClick?.(item);
        }}
      >
        {isExpanded && resolvedChildren?.map(child => renderItem(child, depth + 1))}
        {isExpanded && hasMore && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs text-muted-foreground hover:text-foreground py-1 h-auto"
            style={{ paddingLeft: `${(depth + 1) * 1.5}rem` }}
            disabled={isLoading}
            onClick={(e) => {
              e.stopPropagation();
              loadChildren(item.id, item, resolvedChildren?.length ?? 0);
            }}
          >
            <MoreHorizontal className="h-3 w-3 mr-1" />
            Load more
          </Button>
        )}
      </TreeRow>
    );
  }, [expandedIds, loadingIds, childrenCache, hasMoreMap, toggleExpanded, loadChildren, renderBadge, renderActions, onItemClick]);

  return (
    <div className={cn('space-y-0.5', className)}>
      {items.map(item => renderItem(item, 0))}
    </div>
  );
}
