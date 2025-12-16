'use client';

import React from 'react';
import type { AssetCardProps, CardOrientation } from './types';
import type { AssetKind } from '@/client';
import { 
  DefaultAssetCard, 
  ArticleAssetCard, 
  WebAssetCard,
  CsvAssetCard,
  CsvRowAssetCard 
} from './AssetCardComponents';

/**
 * AssetCard - Main entry point for rendering asset cards
 * 
 * This component dispatches to type-specific card renderers based on asset.kind.
 * It provides a unified API while allowing each asset type to have its own
 * optimized visual representation.
 * 
 * Supports two orientations:
 * - 'vertical' (default): Traditional tall card with image on top
 * - 'horizontal': Wide rectangular card with image on left
 * 
 * Usage:
 * ```tsx
 * // Vertical (default)
 * <AssetCard asset={asset} onClick={handleClick} />
 * 
 * // Horizontal for list layouts
 * <AssetCard asset={asset} orientation="horizontal" onClick={handleClick} />
 * ```
 * 
 * To add support for a new asset type:
 * 1. Create a component in AssetCardComponents/
 * 2. Add the kind to the cardComponentMap below
 */

// Map of asset kinds to their specific card components
const cardComponentMap: Partial<Record<AssetKind, React.ComponentType<any>>> = {
  article: ArticleAssetCard,
  web: WebAssetCard,
  csv: CsvAssetCard,
  csv_row: CsvRowAssetCard,
  // Add more mappings as needed:
  // pdf: PdfAssetCard,
  // image: ImageAssetCard,
};

interface ExtendedAssetCardProps extends AssetCardProps {
  /** Card orientation: vertical (tall) or horizontal (wide) */
  orientation?: CardOrientation;
  /** Whether this card is featured (e.g., in bento layout) - shows more content */
  isFeatured?: boolean;
}

export function AssetCard({
  asset,
  childAssets,
  score,
  onClick,
  size = 'md',
  orientation = 'vertical',
  isFeatured = false,
  showMeta = true,
  className,
  customRenderer: CustomRenderer,
}: ExtendedAssetCardProps) {
  // Featured cards get larger size for more text content
  const effectiveSize = isFeatured ? 'lg' : size;
  
  // Allow custom override
  if (CustomRenderer) {
    return (
      <CustomRenderer
        asset={asset}
        childAssets={childAssets}
        score={score}
        onClick={onClick}
        size={effectiveSize}
        orientation={orientation}
        isFeatured={isFeatured}
        showMeta={showMeta}
        className={className}
      />
    );
  }
  
  // Get type-specific component or fall back to default
  const CardComponent = cardComponentMap[asset.kind] || DefaultAssetCard;
  
  return (
    <CardComponent
      asset={asset}
      childAssets={childAssets}
      score={score}
      onClick={onClick}
      size={effectiveSize}
      orientation={orientation}
      isFeatured={isFeatured}
      showMeta={showMeta}
      className={className}
    />
  );
}

// Re-export for convenience
export { AssetCardBase, AssetCardSkeleton } from './AssetCardBase';
