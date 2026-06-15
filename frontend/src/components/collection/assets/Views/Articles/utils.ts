import { AssetRead } from '@/client';
import { ArticleFormat, ArticleSource, ArticleMetadata } from './types';
import { getAssetMeta } from '@/lib/utils';

export function detectArticleFormat(asset: AssetRead): ArticleFormat {
  const metadata = getAssetMeta(asset) as ArticleMetadata;

  // 1. Composed articles take precedence over the format hint. The backend tags
  // them content_format:'markdown' AND composition_type:'free_form_article' — but
  // they carry {{asset:…}}/{{bundle:…}} embeds that must render via the composed
  // renderer (which itself markdown-renders the text parts), never as raw text.
  if (metadata?.composition_type === 'free_form_article') {
    return 'composed';
  }
  if (asset.text_content?.includes('{{asset:') || asset.text_content?.includes('{{bundle:')) {
    return 'composed';
  }

  // 2. Explicit format hint from backend (html / markdown / text for non-composed)
  if (metadata?.content_format) {
    return metadata.content_format;
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
  const metadata = getAssetMeta(asset) as ArticleMetadata;
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
  const metadata = getAssetMeta(asset) as ArticleMetadata;
  
  // 1. Check for top_image in file_info
  if (metadata?.top_image) {
    return metadata.top_image;
  }
  
  // 2. Find first child with is_hero_image
  const heroImage = childAssets?.find(
    child => child.kind === 'image' && child.file_info?.is_hero_image
  );
  if (heroImage?.source_identifier) {
    return heroImage.source_identifier;
  }
  
  // 3. First image child
  const firstImage = childAssets?.find(child => child.kind === 'image');
  return firstImage?.source_identifier || null;
}
