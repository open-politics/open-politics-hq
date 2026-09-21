'use client';

import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getAssetKindConfig } from '../assetKindConfig';
import type { AssetRead } from '@/client';

/**
 * Pure-list row for the feed's "List" view — dense, file-manager rows (kind
 * icon + title + kind + time + favorite) matching the AssetSelector/BundleViewer
 * vocabulary, rather than the horizontal `AssetCard` (which keeps a thumbnail).
 */

function relTime(iso?: string | null): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return `${Math.floor(s / 604800)}w`;
}

export function AssetListRow({
  asset,
  isFavorited,
  onClick,
  onToggleFavorite,
}: {
  asset: AssetRead;
  isFavorited?: boolean;
  onClick?: (asset: AssetRead) => void;
  onToggleFavorite?: (asset: AssetRead) => void;
}) {
  const config = getAssetKindConfig(asset.kind);
  const Icon = config.icon;

  return (
    <div
      onClick={() => onClick?.(asset)}
      className="group flex w-full cursor-pointer items-center gap-2.5 overflow-hidden border-b border-border/50 px-2 py-1.5 transition-colors last:border-0 hover:bg-muted/50"
    >
      <Icon className={cn('h-4 w-4 shrink-0', config.iconColor)} />
      <span className="min-w-0 flex-1 truncate text-sm">{asset.title || `Asset ${asset.id}`}</span>
      <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{config.label}</span>
      <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{relTime(asset.created_at)}</span>
      {onToggleFavorite && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleFavorite(asset); }}
          aria-label={isFavorited ? 'Unfavorite' : 'Favorite'}
          className={cn(
            'shrink-0 rounded p-0.5 transition-opacity',
            isFavorited ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100',
          )}
        >
          <Star className={cn('h-3.5 w-3.5', isFavorited ? 'fill-amber-400 text-amber-500' : 'text-muted-foreground/60 hover:text-amber-500')} />
        </button>
      )}
    </div>
  );
}
