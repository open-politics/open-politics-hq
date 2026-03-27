import React from 'react';
import { ArticleViewProps, ArticleMetadata } from './types';
import { getAssetMeta } from '@/lib/utils';
import { detectArticleFormat } from './utils';
import ArticleFeaturedImage from './ArticleFeaturedImage';
import ComposedArticleRenderer from './ComposedArticleRenderer';
import TextContentRenderer from './TextContentRenderer';
import { HighlightedText } from '@/components/ui/highlighted-text';
import { useTextSpanHighlightSafe } from '@/components/collection/contexts/TextSpanHighlightContext';
import { cn } from '@/lib/utils';

/**
 * ArticleView - Content view for articles
 *
 * Title and metadata are in the parent's AssetMetaHeader; this is body + media.
 */
export default function ArticleView({ 
  asset, 
  childAssets = [], 
  onAssetClick,
  className,
  enableHighlighting = false,
  hideMainBody = false,
}: ArticleViewProps) {
  const format = detectArticleFormat(asset);
  const metadata = getAssetMeta(asset) as ArticleMetadata;
  const content = asset.text_content || '';

  // Text span highlighting - safe hook returns null when no provider is available
  const highlightContext = useTextSpanHighlightSafe();
  const textSpans = (enableHighlighting && highlightContext && content) 
    ? highlightContext.getSpansForAsset(asset.id, asset.uuid) 
    : [];
  const shouldHighlight = textSpans.length > 0;

  // Select appropriate renderer
  const renderContent = () => {
    // If highlighting is active, use HighlightedText for text content
    if (shouldHighlight && content) {
      return (
        <div className="prose prose-sm md:prose-base dark:prose-invert max-w-none">
          <HighlightedText 
            text={content} 
            spans={textSpans}
            highlightClassName="bg-yellow-200 dark:bg-yellow-800/70 px-0.5 text-yellow-900 dark:text-yellow-100"
          />
        </div>
      );
    }

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
          {/* Summary if available - hide when duplicated at start of content */}
          {metadata?.summary && (() => {
            const sum = (metadata.summary || '').trim();
            const cont = content.trim();
            if (!sum || !cont || sum.length < 20) return true;
            const prefixLen = Math.min(50, sum.length);
            const sumPrefix = sum.slice(0, prefixLen).replace(/\s+/g, ' ').toLowerCase();
            const contPrefix = cont.slice(0, prefixLen + 10).replace(/\s+/g, ' ').toLowerCase();
            return !contPrefix.startsWith(sumPrefix);
          })() && (
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
          {!hideMainBody && renderContent()}

          {/* Child Assets Gallery (images beyond featured) */}
          {childAssets.length > 1 && (
            <div className="mt-8 pt-6 border-t">
              <h3 className="text-lg font-semibold mb-4">Related Media</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {childAssets
                  .filter(child => 
                    child.kind === 'image' && 
                    !child.file_info?.is_hero_image
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
                      {typeof child.file_info?.media_credit === "string" && (
                        <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs p-1">
                          {child.file_info.media_credit}
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
