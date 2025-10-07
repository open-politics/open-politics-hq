import { AssetRead } from '@/client';
import { ArticleFormat, ArticleSource, ArticleMetadata } from './types';

export function detectArticleFormat(asset: AssetRead): ArticleFormat {
  const metadata = asset.source_metadata as ArticleMetadata;
  
  // 1. Explicit format hint from backend
  if (metadata?.content_format) {
    return metadata.content_format;
  }
  
  // 2. Check for composed article markers
  if (metadata?.composition_type === 'free_form_article') {
    return 'composed';
  }
  
  // 3. Check for embed syntax in content
  if (asset.text_content?.includes('{{asset:')) {
    return 'composed';
  }
  
  // 4. Check for HTML content
  if (asset.text_content?.includes('<p>') || asset.text_content?.includes('<div>')) {
    return 'html';
  }
  
  // 5. Check for markdown patterns
  if (asset.text_content?.includes('##') || asset.text_content?.match(/\[.+\]\(.+\)/)) {
    return 'markdown';
  }
  
  return 'text';
}

export function getArticleSource(asset: AssetRead): ArticleSource | null {
  const metadata = asset.source_metadata as ArticleMetadata;
  return metadata?.content_source || null;
}

export function getSourceBadgeInfo(source: ArticleSource | null) {
  switch (source) {
    case 'rss_feed':
      return { icon: '📰', label: 'RSS Feed', color: 'bg-orange-100 text-orange-700' };
    case 'search_result':
      return { icon: '🔍', label: 'Search Result', color: 'bg-blue-100 text-blue-700' };
    case 'user':
      return { icon: '✍️', label: 'Composed', color: 'bg-purple-100 text-purple-700' };
    case 'web_scrape':
      return { icon: '🌐', label: 'Web Article', color: 'bg-green-100 text-green-700' };
    default:
      return { icon: '📄', label: 'Article', color: 'bg-gray-100 text-gray-700' };
  }
}

export function getFeaturedImage(asset: AssetRead, childAssets?: AssetRead[]): string | null {
  const metadata = asset.source_metadata as ArticleMetadata;
  
  // 1. Check for top_image in metadata
  if (metadata?.top_image) {
    return metadata.top_image;
  }
  
  // 2. Find first child with is_hero_image
  const heroImage = childAssets?.find(
    child => child.kind === 'image' && child.source_metadata?.is_hero_image
  );
  if (heroImage?.source_identifier) {
    return heroImage.source_identifier;
  }
  
  // 3. First image child
  const firstImage = childAssets?.find(child => child.kind === 'image');
  return firstImage?.source_identifier || null;
}
