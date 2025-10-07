import React, { useMemo } from 'react';
import { ArticleRendererProps } from './types';
import AssetEmbed from '../../Composer/AssetEmbed';

export default function ComposedArticleRenderer({ 
  asset, 
  content, 
  embeddedAssets = [], 
  onAssetClick 
}: ArticleRendererProps) {
  // Process content to render embedded assets
  const processedContent = useMemo(() => {
    if (!content) {
      return null;
    }
    
    // Split content by embed markers {{asset:ID:mode:size}}
    return content.split(/(\{\{asset:\d+:\w+:\w+\}\})/g).map((part, index) => {
      const embedMatch = part.match(/\{\{asset:(\d+):(\w+):(\w+)\}\}/);
      
      if (embedMatch) {
        const [, assetIdStr, mode, size] = embedMatch;
        const assetId = parseInt(assetIdStr);
        const embedConfig = embeddedAssets.find((e: any) => e.asset_id === assetId);
        
        return (
          <div key={`embed-${index}`} className="my-4">
            <AssetEmbed
              assetId={assetId}
              mode={mode as any}
              size={size as any}
              caption={embedConfig?.caption}
              onAssetClick={onAssetClick}
              interactive={!!onAssetClick}
            />
          </div>
        );
      }
      
      // Regular text content - preserve whitespace
      return (
        <span key={`text-${index}`} className="whitespace-pre-wrap">
          {part}
        </span>
      );
    });
  }, [content, embeddedAssets, onAssetClick]);

  if (!processedContent) {
    return (
      <div className="text-muted-foreground italic">
        No content available
      </div>
    );
  }

  return (
    <div className="prose prose-sm md:prose-base dark:prose-invert max-w-none">
      {processedContent}
    </div>
  );
}
