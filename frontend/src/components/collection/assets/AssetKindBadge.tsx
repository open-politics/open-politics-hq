'use client';

/**
 * AssetKindBadge - Pre-styled badge for asset kinds
 * 
 * A convenience component that renders a badge with the correct icon,
 * label, and styling for any asset kind.
 * 
 * Usage:
 * ```tsx
 * import { AssetKindBadge } from '@/components/collection/assets/AssetKindBadge';
 * 
 * // Default colorful style
 * <AssetKindBadge kind="article" />
 * 
 * // Neutral style for cards/feeds
 * <AssetKindBadge kind="article" context="card" />
 * 
 * // Colorful for selector
 * <AssetKindBadge kind="article" context="selector" />
 * 
 * // With custom positioning
 * <AssetKindBadge kind="article" className="absolute bottom-2 left-2" />
 * 
 * // Icon only
 * <AssetKindBadge kind="article" showLabel={false} />
 * ```
 */

import React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { AssetKind } from '@/client';
import {
  getAssetKindConfig,
  getAssetBadgeClass,
  getAssetIconClass,
  formatAssetKind,
  type StyleContext,
} from './assetKindConfig';

export interface AssetKindBadgeProps {
  /** The asset kind to display */
  kind: AssetKind;
  /** Styling context: 'selector' (colorful), 'card' (neutral), 'default' */
  context?: StyleContext;
  /** Whether to show the label text (default: true) */
  showLabel?: boolean;
  /** Whether to show the icon (default: true) */
  showIcon?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Badge size: affects icon and text size */
  size?: 'sm' | 'md' | 'lg';
}

const iconSizes = {
  sm: 'h-3 w-3',
  md: 'h-3.5 w-3.5',
  lg: 'h-4 w-4',
};

const textSizes = {
  sm: 'text-[10px]',
  md: 'text-xs',
  lg: 'text-sm',
};

export function AssetKindBadge({
  kind,
  context = 'default',
  showLabel = true,
  showIcon = true,
  className,
  size = 'md',
}: AssetKindBadgeProps) {
  const config = getAssetKindConfig(kind);
  const badgeClass = getAssetBadgeClass(kind, context);
  const iconClass = getAssetIconClass(kind, context);
  const IconComponent = config.icon;

  return (
    <Badge 
      variant="outline"
      className={cn(
        badgeClass,
        textSizes[size],
        'font-medium',
        className
      )}
    >
      {showIcon && (
        <IconComponent 
          className={cn(
            iconSizes[size], 
            iconClass,
            showLabel && 'mr-1'
          )} 
        />
      )}
      {showLabel && formatAssetKind(kind)}
    </Badge>
  );
}

/**
 * Inline icon for asset kinds (no badge wrapper)
 */
export function AssetKindIcon({
  kind,
  context = 'selector',
  className,
}: {
  kind: AssetKind;
  context?: StyleContext;
  className?: string;
}) {
  const config = getAssetKindConfig(kind);
  const iconClass = getAssetIconClass(kind, context);
  const IconComponent = config.icon;

  return (
    <IconComponent 
      className={cn('h-4 w-4', iconClass, className)} 
    />
  );
}

