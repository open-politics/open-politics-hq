/**
 * Card Component Types
 * ====================
 * 
 * Type definitions for asset cards. These are kept separate from
 * implementation to allow easy importing without circular dependencies.
 */

import type { AssetRead, AssetKind } from '@/client';

/**
 * Size variants for cards
 */
export type CardSize = 'sm' | 'md' | 'lg';

/**
 * Card orientation - vertical (default) or horizontal (rectangular)
 */
export type CardOrientation = 'vertical' | 'horizontal';

/**
 * Base props shared by all card components
 */
export interface AssetCardBaseProps {
  /** The asset to display */
  asset: AssetRead;
  /** Child assets (e.g., images for articles) */
  childAssets?: AssetRead[];
  /** Relevance score from semantic search (0-100) */
  score?: number;
  /** Click handler */
  onClick?: (asset: AssetRead) => void;
  /** Card size variant */
  size?: CardSize;
  /** Card orientation: vertical (tall) or horizontal (wide) */
  orientation?: CardOrientation;
  /** Whether this card is featured (e.g., in bento layout) - shows more content */
  isFeatured?: boolean;
  /** Show metadata (date, author, fragments) */
  showMeta?: boolean;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Props for the main AssetCard dispatcher
 */
export interface AssetCardProps extends AssetCardBaseProps {
  /** Override the default card component for this asset kind */
  customRenderer?: React.ComponentType<AssetCardBaseProps>;
}

/**
 * Props for type-specific card components
 */
export interface TypeSpecificCardProps extends AssetCardBaseProps {}

/**
 * Configuration for card grid layout
 */
export interface CardGridProps {
  children: React.ReactNode;
  /** Number of columns (or 'auto' for responsive) */
  columns?: 1 | 2 | 3 | 4 | 'auto';
  /** Gap between cards */
  gap?: 'sm' | 'md' | 'lg';
  /** 
   * Layout mode:
   * - 'grid': Uniform grid, all cards same size (default)
   * - 'bento': Featured pattern - 1 large card + 2 small stacked, repeating
   * - 'list': Horizontal cards stacked vertically (like a feed)
   */
  layout?: 'grid' | 'bento' | 'list';
  /** Additional CSS classes */
  className?: string;
}

/**
 * Mapping of asset kinds to their display configuration
 */
export interface AssetKindConfig {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  badgeClass: string;
  iconClass: string;
}

/**
 * Helper to get featured image from asset or its children
 */
export interface FeaturedImageInfo {
  url: string;
  alt: string;
  credit?: string;
}
