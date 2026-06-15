import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { ArticleRendererProps } from './types';
import AssetEmbed from '../../Composer/AssetEmbed';
import BundleEmbed from '../../Composer/BundleEmbed';

export default function ComposedArticleRenderer({
  asset,
  content,
  embeddedAssets = [],
  onAssetClick,
  onBundleClick,
}: ArticleRendererProps) {
  // Process content to render embedded assets + bundles inline.
  const processedContent = useMemo(() => {
    if (!content) {
      return null;
    }

    // Split on both marker kinds: {{asset:ID:mode:size}} and {{bundle:ID}}.
    return content.split(/(\{\{asset:\d+:\w+:\w+\}\}|\{\{bundle:\d+\}\})/g).map((part, index) => {
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

      const bundleMatch = part.match(/\{\{bundle:(\d+)\}\}/);
      if (bundleMatch) {
        const bundleId = parseInt(bundleMatch[1]);
        return (
          <div key={`bundle-${index}`} className="my-2">
            <BundleEmbed bundleId={bundleId} onBundleClick={onBundleClick} interactive={!!onBundleClick} />
          </div>
        );
      }

      // Regular text content — render as markdown so headings/lists/links work.
      if (!part.trim()) return null;
      return <ReactMarkdown key={`text-${index}`}>{part}</ReactMarkdown>;
    });
  }, [content, embeddedAssets, onAssetClick, onBundleClick]);

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
