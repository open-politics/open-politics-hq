/**
 * Feed Component Types
 * ====================
 * 
 * Type definitions for the asset feed. Kept separate to allow
 * easy importing without circular dependencies.
 */

import type { AssetRead, AssetKind } from '@/client';

/**
 * A feed item bundles an asset with its pre-fetched children
 */
export interface AssetFeedItem {
  asset: AssetRead;
  childAssets?: AssetRead[];
  /** Relevance score from semantic search (0-100) */
  score?: number;
}

/**
 * Options for the useFeedAssets hook
 * 
 * Note: This hook now uses tree store data instead of making separate API calls.
 * Images are extracted from source_metadata (og_image, featured_image_url).
 */
export interface UseFeedAssetsOptions {
  /** Infospace ID (used to ensure tree is loaded) */
  infospaceId: number;
  /** Items per page for client-side pagination */
  limit?: number;
  /** Filter to specific asset kinds */
  kinds?: AssetKind[];
  /** Sort field - supports compound sorts like 'kind-updated_at' for type then date */
  sortBy?: 'name' | 'created_at' | 'updated_at' | 'kind-updated_at' | 'kind-created_at';
  /** Sort direction */
  sortOrder?: 'asc' | 'desc';
}

/**
 * Return type for useFeedAssets hook
 */
export interface UseFeedAssetsReturn {
  /** Feed items with pre-fetched children */
  items: AssetFeedItem[];
  /** Loading state */
  isLoading: boolean;
  /** Error message if any */
  error: string | null;
  /** Whether there are more items to load */
  hasMore: boolean;
  /** Total count of assets (if known) */
  totalCount: number | null;
  /** Load more items (for pagination/infinite scroll) */
  loadMore: () => void;
  /** Refresh the feed */
  refresh: () => void;
}

/**
 * Props for the AssetFeedView component
 */
export interface AssetFeedViewProps {
  // === Data Source Options (pick one) ===
  
  /** Pre-fetched data - bypasses internal fetching */
  items?: AssetFeedItem[];
  
  /** Custom fetch function - allows any data source */
  fetchFn?: () => Promise<AssetFeedItem[]>;
  
  /** Infospace ID - uses default fetching via useFeedAssets */
  infospaceId?: number;
  
  // === Behavior ===
  
  /** Called when an asset is clicked */
  onAssetClick?: (asset: AssetRead) => void;
  
  /** Initial number of items to show */
  initialLimit?: number;
  
  /** Enable infinite scroll (vs pagination) */
  enableInfiniteScroll?: boolean;
  
  // === Filtering ===
  
  /** Filter to specific asset kinds (server-side) */
  filterKinds?: AssetKind[];
  
  /** 
   * Filter to show only children of a specific bundle
   * When provided with infospaceId, AssetSelector will only show bundle contents
   */
  filterByBundleId?: number | null;
  
  /** 
   * Pre-known available kinds (e.g., from tree data)
   * When provided, shows these type badges upfront instead of waiting for items to load.
   * This allows parent components with tree data to inform the feed what types exist.
   */
  availableKinds?: AssetKind[];
  
  // === Display ===
  
  /** Title shown above the feed */
  title?: string;
  
  /** Show filter/sort controls */
  showControls?: boolean;
  
  /** Card size */
  cardSize?: 'sm' | 'md' | 'lg';
  
  /** Grid columns */
  columns?: 1 | 2 | 3 | 4 | 'auto';
  
  /** 
   * Grid layout mode:
   * - 'grid': Uniform vertical cards (default)
   * - 'bento': Featured pattern with 1 large + 2 small cards, maintains score order
   * - 'list': Horizontal cards stacked vertically (feed style)
   */
  layout?: 'grid' | 'bento' | 'list';
  
  /** Additional CSS classes */
  className?: string;
  
  /** Empty state message */
  emptyMessage?: string;
}
