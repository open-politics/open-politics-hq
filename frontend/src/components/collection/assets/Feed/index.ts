/**
 * Asset Feed
 * ==========
 * 
 * Components for displaying assets in a feed/stream layout.
 * 
 * Main exports:
 * - AssetFeedView: Main feed component with cards grid
 * - useFeedAssets: Standalone hook for fetching feed data
 * 
 * Usage with auto-fetch:
 * ```tsx
 * import { AssetFeedView } from '@/components/collection/assets/Feed';
 * 
 * <AssetFeedView 
 *   infospaceId={123}
 *   filterKinds={['article', 'web']}
 *   onAssetClick={handleClick}
 * />
 * ```
 * 
 * Usage with pre-fetched data:
 * ```tsx
 * <AssetFeedView 
 *   items={myItems}
 *   onAssetClick={handleClick}
 * />
 * ```
 * 
 * Usage with hook directly:
 * ```tsx
 * import { useFeedAssets } from '@/components/collection/assets/Feed';
 * 
 * const { items, isLoading, loadMore } = useFeedAssets({
 *   infospaceId: 123,
 *   kinds: ['article', 'web'],
 * });
 * ```
 */

export { AssetFeedView } from './AssetFeedView';
export { useFeedAssets } from './useFeedAssets';
export { useAssetChildren, clearChildrenCache } from './useAssetChildren';

export type { 
  AssetFeedItem, 
  AssetFeedViewProps, 
  UseFeedAssetsOptions,
  UseFeedAssetsReturn,
} from './types';
