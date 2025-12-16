/**
 * Asset Cards
 * ===========
 * 
 * Card components for displaying assets in a visual, scannable format.
 * 
 * Main exports:
 * - AssetCard: Main dispatcher component (handles all asset types)
 * - CardGrid: Responsive grid layout
 * - AssetCardSkeleton: Loading placeholder
 * 
 * Type-specific cards (for direct use if needed):
 * - ArticleAssetCard
 * - WebAssetCard
 * - DefaultAssetCard
 * 
 * Usage:
 * ```tsx
 * import { AssetCard, CardGrid } from '@/components/collection/assets/Cards';
 * 
 * <CardGrid columns="auto">
 *   {assets.map(a => (
 *     <AssetCard 
 *       key={a.id} 
 *       asset={a} 
 *       childAssets={childrenMap.get(a.id)}
 *       onClick={handleClick}
 *     />
 *   ))}
 * </CardGrid>
 * ```
 */

// Main components
export { AssetCard, AssetCardBase, AssetCardSkeleton } from './AssetCard';
export { CardGrid, CardGridSkeleton } from './CardGrid';

// Type-specific cards (for direct import if customization needed)
export { 
  DefaultAssetCard, 
  ArticleAssetCard, 
  WebAssetCard 
} from './AssetCardComponents';

// Types
export type { 
  AssetCardProps, 
  AssetCardBaseProps, 
  TypeSpecificCardProps,
  CardGridProps,
  CardSize,
  CardOrientation,
  FeaturedImageInfo,
} from './types';

// Utilities
export { cleanTextForPreview, stripHtml, stripMarkdown } from './utils';
