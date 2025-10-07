import { AssetRead } from '@/client';

export type ArticleFormat = 'composed' | 'markdown' | 'html' | 'text';
export type ArticleSource = 'user' | 'rss_feed' | 'search_result' | 'web_scrape';

export interface ArticleMetadata {
  content_format?: ArticleFormat;
  content_source?: ArticleSource;
  author?: string;
  publication_date?: string;
  summary?: string;
  top_image?: string;
  composition_type?: string;
  embedded_assets?: any[];
  search_provider?: string;
  rss_feed_url?: string;
  rss_published_date?: string;
  rss_updated_date?: string;
  rss_author?: string;
  rss_summary?: string;
  rss_tags?: string[];
  rss_link?: string;
  media_credit?: string;
  is_hero_image?: boolean;
  image_role?: string;
  image_url?: string;
}

export interface ArticleViewProps {
  asset: AssetRead;
  childAssets?: AssetRead[];
  onEdit?: (asset: AssetRead) => void;
  onAssetClick?: (asset: AssetRead) => void;
  className?: string;
}

export interface ArticleRendererProps {
  asset: AssetRead;
  content: string;
  embeddedAssets?: any[];
  onAssetClick?: (asset: AssetRead) => void;
}
