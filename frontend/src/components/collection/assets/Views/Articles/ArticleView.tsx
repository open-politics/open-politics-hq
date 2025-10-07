import React from 'react';
import { ArticleViewProps, ArticleMetadata } from './types';
import { detectArticleFormat } from './utils';
import ArticleHeader from './ArticleHeader';
import ArticleFeaturedImage from './ArticleFeaturedImage';
import HtmlArticleRenderer from './HtmlArticleRenderer';
import MarkdownArticleRenderer from './MarkdownArticleRenderer';
import ComposedArticleRenderer from './ComposedArticleRenderer';
import { cn } from '@/lib/utils';
import { FragmentDisplay, FragmentSectionHeader } from '../Fragments';

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
    switch (format) {
      case 'composed':
        return (
          <ComposedArticleRenderer
            asset={asset}
            content={content}
            embeddedAssets={metadata?.embedded_assets}
            onAssetClick={onAssetClick}
          />
        );
      
      case 'html':
        return (
          <HtmlArticleRenderer
            asset={asset}
            content={content}
          />
        );
      
      case 'markdown':
        return (
          <MarkdownArticleRenderer
            asset={asset}
            content={content}
          />
        );
      
      case 'text':
      default:
        return (
          <div className="whitespace-pre-wrap text-sm">
            {content}
          </div>
        );
    }
  };

  return (
    <div className={cn("h-full w-full flex flex-col min-h-0 overflow-y-auto", className)}>
      {/* Header */}
      <ArticleHeader 
        asset={asset} 
        onEdit={onEdit ? () => onEdit(asset) : undefined}
      />

      {/* Content */}
      <div className="flex-1 w-full overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 py-6 pt-0">
          {/* Featured Image */}
          <ArticleFeaturedImage 
            asset={asset} 
            childAssets={childAssets}
          />

          {/* Article Content */}
          {renderContent()}

          {/* Fragment Display */}
          {asset.fragments && Object.keys(asset.fragments).length > 0 && (
            <div className="mt-8 pt-6 border-t">
              <FragmentSectionHeader count={Object.keys(asset.fragments).length} />
              <FragmentDisplay 
                fragments={asset.fragments as Record<string, any>}
                viewMode="card"
              />
            </div>
          )}

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
