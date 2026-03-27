'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { motion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Loader2,
  RefreshCw,
  Star,
  Plus,
  Settings2,
  Pencil,
  X,
  FolderOpen,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAssetQuery, type QueryResult } from '@/hooks/useAssetQuery';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { useUserPreferencesStore, type Channel } from '@/zustand_stores/storeUserPreferences';
import { useTreeStore } from '@/zustand_stores/storeTree';
import { AssetCard, CardGrid } from '../Cards';
import {
  DISPLAYABLE_ASSET_KINDS,
  getAssetKindConfig,
} from '../assetKindConfig';
import type { AssetRead, AssetKind, TreeNode } from '@/client';
import { useDebounce } from '@/hooks/useDebounce';
import { IconRenderer } from '@/components/collection/utilities/icons/icon-picker';

// ─── Channel tab bar ───

interface ChannelTabsProps {
  channels: Channel[];
  activeChannelId: string | null;
  onSelect: (id: string | null) => void;
  onAddChannel: () => void;
  onEditChannel: (channel: Channel) => void;
  favoritesView: string;
  onCycleFavoritesView: () => void;
}

export function ChannelTabs({ channels, activeChannelId, onSelect, onAddChannel, onEditChannel, favoritesView, onCycleFavoritesView }: ChannelTabsProps) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide px-1">
      {/* "All" tab — always present */}
      <button
        onClick={() => onSelect(null)}
        className={cn(
          'shrink-0 rounded-md px-3 py-1 text-xs font-medium transition-colors',
          activeChannelId === null
            ? 'border-b-2 border-primary rounded-b-none'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        )}
      >
        All
      </button>
      {/* "Favorites" tab — same chrome as channel tabs (border-b spans label + pencil) */}
      <div className="shrink-0 group/tab relative flex items-center">
        <button
          onClick={() => onSelect('__favorites__')}
          className={cn(
            'flex items-center gap-1 rounded-md px-3 py-1 pr-6 text-xs font-medium transition-colors',
            activeChannelId === '__favorites__'
              ? 'border-b-2 border-primary rounded-b-none'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          )}
        >
          <Star className="h-3 w-3" />
          Favorites
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCycleFavoritesView();
          }}
          className="absolute right-1 opacity-0 group-hover/tab:opacity-100 transition-opacity p-0.5 rounded text-muted-foreground hover:bg-muted-foreground/20 hover:text-foreground"
          title={`View: ${favoritesView}`}
        >
          <Pencil className="h-2.5 w-2.5" />
        </button>
      </div>
      {/* User channels */}
      {channels.map((ch) => (
        <div key={ch.id} className="shrink-0 group/tab relative flex items-center">
          <button
            onClick={() => onSelect(ch.id)}
            className={cn(
              'flex items-center gap-1 rounded-md px-3 py-1 text-xs font-medium transition-colors pr-6',
              activeChannelId === ch.id
                ? 'border-b-2 border-primary rounded-b-none'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            {ch.icon && <IconRenderer icon={ch.icon} className="h-3 w-3" />}
            {ch.name}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onEditChannel(ch); }}
            className="absolute right-1 opacity-0 group-hover/tab:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted-foreground/20"
            title="Edit channel"
          >
            <Pencil className="h-2.5 w-2.5 hover:invert" />
          </button>
        </div>
      ))}
      {/* Add channel */}
      <button
        onClick={onAddChannel}
        className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        title="Add channel"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ─── Favorites bar ───

interface FavoritesBarProps {
  items: QueryResult[];
  isLoading: boolean;
  onItemClick: (asset: AssetRead) => void;
}

export function FavoritesBar({ items, isLoading, onItemClick }: FavoritesBarProps) {
  if (isLoading || items.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide py-1 px-1">
      <Star className="h-3 w-3 shrink-0 text-yellow-500 fill-yellow-400" />
      {items.map((result) => (
        <button
          key={result.asset.id}
          onClick={() => onItemClick(result.asset)}
          className="shrink-0 flex items-center gap-1 rounded-full bg-muted/60 px-2.5 py-0.5 text-xs hover:bg-muted transition-colors max-w-[160px]"
          title={result.asset.title || ''}
        >
          <span className="truncate">{result.asset.title || `Asset ${result.asset.id}`}</span>
        </button>
      ))}
    </div>
  );
}

// ─── Channel feed content ───

interface ChannelFeedContentProps {
  channelId: string | null;
  channels: Channel[];
  onAssetClick: (asset: AssetRead) => void;
  onBundleClick?: (bundleId: number) => void;
}

export function ChannelFeedContent({ channelId, channels, onAssetClick, onBundleClick }: ChannelFeedContentProps) {
  const { activeInfospace } = useInfospaceStore();
  const infospaceId = activeInfospace?.id;
  const { preferences } = useUserPreferencesStore();
  const { rootNodes } = useTreeStore();

  // Resolve the active channel config
  const channel = useMemo(() => {
    if (!channelId || channelId === '__favorites__') return null;
    return channels.find((c) => c.id === channelId) ?? null;
  }, [channelId, channels]);

  // Build the AQL query string from channel config
  const query = useMemo(() => {
    if (channelId === '__favorites__') return 'tag:favorite';
    if (!channel) return ''; // "All" channel — empty query = recent
    const parts: string[] = [];
    if (channel.bundleIds.length > 0) {
      parts.push(`bundle:${channel.bundleIds.join(',')}`);
    }
    if (channel.query) {
      parts.push(channel.query);
    }
    return parts.join(' ');
  }, [channelId, channel]);

  const sort = channel?.sort ?? 'created_at_desc';
  const view = channelId === '__favorites__'
    ? (preferences.favorites_view ?? 'list')
    : (channel?.view ?? 'bento');

  // Bundles to show in the feed — filtered by channel context
  const feedBundles = useMemo(() => {
    const bundles = rootNodes.filter((n) => n.type === 'bundle');
    if (channelId === '__favorites__') {
      return bundles.filter((b) => b.tags?.includes('favorite'));
    }
    if (channel?.bundleIds?.length) {
      const ids = new Set(channel.bundleIds.map((id) => `bundle-${id}`));
      return bundles.filter((b) => ids.has(b.id));
    }
    // "All" channel — no bundle row, assets only
    return [];
  }, [rootNodes, channelId, channel]);

  // For "All" with empty query, we pass empty string — the hook and backend
  // now allow empty queries in browse mode (non-relevance sort)
  const {
    results,
    isLoading,
    hasMore,
    loadMore,
    search,
  } = useAssetQuery({
    infospaceId: infospaceId ?? 0,
    query,
    sort,
    limit: 50,
    enabled: !!infospaceId,
  });

  if (!infospaceId) return null;

  const hasBundles = feedBundles.length > 0 && onBundleClick;
  const hasResults = results.length > 0;
  const isEmpty = !hasBundles && !hasResults && !isLoading;

  return (
    <ScrollArea className="h-full">
      <div className="p-3">
        {/* Bundle row */}
        {hasBundles && (
          <div className="mb-4">
            <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Bundles</p>
            <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
              {feedBundles.map((bundle) => (
                <button
                  key={bundle.id}
                  onClick={() => onBundleClick(parseInt(bundle.id.replace('bundle-', '')))}
                  className="shrink-0 flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm hover:bg-muted transition-colors max-w-[200px]"
                >
                  <FolderOpen className="h-4 w-4 text-blue-400 shrink-0" />
                  <span className="truncate">{bundle.name}</span>
                  {(bundle.asset_count ?? 0) > 0 && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                      {bundle.asset_count}
                    </Badge>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {isLoading && results.length === 0 && !hasBundles ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Loading...
          </div>
        ) : isEmpty ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <p className="text-sm">
              {channelId === '__favorites__'
                ? 'No favorites yet. Star items to see them here.'
                : 'No items found.'}
            </p>
          </div>
        ) : hasResults ? (
          <>
            <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Assets</p>
            <CardGrid layout={view === 'card' ? 'grid' : view === 'list' ? 'list' : 'bento'} columns="auto">
              {results.map((result, i) => (
                <motion.div
                  key={result.asset.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.15, delay: Math.min(i * 0.02, 0.3) }}
                >
                  <AssetCard
                    asset={result.asset}
                    score={result.score ?? undefined}
                    onClick={onAssetClick}
                    size="md"
                    isFeatured={view === 'bento' && i % 3 === 0}
                    orientation={view === 'list' ? 'horizontal' : 'vertical'}
                  />
                </motion.div>
              ))}
            </CardGrid>

            {hasMore && (
              <div className="flex justify-center py-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={loadMore}
                  disabled={isLoading}
                  className="text-xs"
                >
                  {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                  Load more
                </Button>
              </div>
            )}
          </>
        ) : null}
      </div>
    </ScrollArea>
  );
}
