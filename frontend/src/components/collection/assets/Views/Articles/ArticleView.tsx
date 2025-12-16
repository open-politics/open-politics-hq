import React from 'react';
import { ArticleViewProps, ArticleMetadata } from './types';
import { detectArticleFormat } from './utils';
import ArticleFeaturedImage from './ArticleFeaturedImage';
import ComposedArticleRenderer from './ComposedArticleRenderer';
import TextContentRenderer from './TextContentRenderer';
import { cn } from '@/lib/utils';

/**
 * ArticleView - Content view for articles
 * 
 * Note: Metadata and fragments are displayed in the parent's AssetMetaHeader.
 * This component focuses on title + content only.
 */
export default function ArticleView({ 
  asset, 
  childAssets = [], 
  onEdit, 
  onAssetClick,
  className 
}: ArticleViewProps) {
  const format = detectArticleFormat(asset);
  const metadata = asset.source_metadata as ArticleMetadata;
  const content = asset.text_content || '';

  // Select appropriate renderer
  const renderContent = () => {
    // Only composed articles need special handling
    // Everything else (html, markdown, text) goes through TextContentRenderer
    if (format === 'composed') {
      return (
        <ComposedArticleRenderer
          asset={asset}
          content={content}
          embeddedAssets={metadata?.embedded_assets}
          onAssetClick={onAssetClick}
        />
      );
    }
    
    // TextContentRenderer auto-detects and handles HTML, Markdown, and plain text
    return <TextContentRenderer content={content} />;
  };

  return (
    <div className={cn("h-full w-full flex flex-col min-h-0 overflow-y-auto", className)}>
      {/* Content */}
      <div className="flex-1 w-full overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 py-6">
          {/* Prominent Title */}
          <h1 className="text-2xl font-bold leading-tight mb-4 text-foreground break-words">
            {asset.title || 'Untitled Article'}
          </h1>
          
          {/* Summary if available */}
          {metadata?.summary && (
            <div className="mb-4 px-3 pb-2 bg-muted/90 rounded-lg border-l-2 rounded-l-xs border-primary">
              <span className="text-sm font-semibold text-muted-foreground">Summary:</span>
            <p className="text-sm text-muted-foreground italic">
                {metadata.summary}
              </p>
            </div>
          )}

          {/* Featured Image */}
          <ArticleFeaturedImage 
            asset={asset} 
            childAssets={childAssets}
          />

          {/* Article Content */}
          {renderContent()}

          {/* Child Assets Gallery (images beyond featured) */}
          {childAssets.length > 1 && (
            <div className="mt-8 pt-6 border-t">
              <h3 className="text-lg font-semibold mb-4">Related Media</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {childAssets
                  .filter(child => 
                    child.kind === 'image' && 
                    !child.source_metadata?.is_hero_image
                  )
                  .map(child => (
                    <div 
                      key={child.id} 
                      className="relative aspect-video rounded overflow-hidden bg-muted cursor-pointer hover:opacity-80 transition-opacity"
                      onClick={() => onAssetClick?.(child)}
                    >
                      {child.source_identifier && (
                        <img
                          src={child.source_identifier}
                          alt={child.title || 'Image'}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      )}
                      {typeof child.source_metadata?.media_credit === "string" && (
                        <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs p-1">
                          {child.source_metadata.media_credit}
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
