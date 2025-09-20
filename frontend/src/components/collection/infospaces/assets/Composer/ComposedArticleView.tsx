'use client';

import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  FileText, 
  Edit2, 
  Calendar, 
  User, 
  Tag, 
  Layers,
  ExternalLink,
  Folder,
  Eye
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { AssetRead, BundleRead } from '@/client/models';
import { format, formatDistanceToNow } from 'date-fns';
import AssetEmbed from './AssetEmbed';
import { useBundleStore } from '@/zustand_stores/storeBundles';

interface ComposedArticleViewProps {
  asset: AssetRead;
  onEdit?: () => void;
  onAssetClick?: (asset: AssetRead) => void;
  className?: string;
}

export default function ComposedArticleView({ 
  asset, 
  onEdit, 
  onAssetClick,
  className 
}: ComposedArticleViewProps) {
  const { bundles } = useBundleStore();

  // Parse composition metadata
  const compositionMetadata = asset.source_metadata || {};
  const isComposedArticle = compositionMetadata.composition_type === 'free_form_article';
  const embeddedAssets = compositionMetadata.embedded_assets || [];
  const referencedBundles = compositionMetadata.referenced_bundles || [];
  const articleMetadata = compositionMetadata.metadata || {};
  const summary = compositionMetadata.summary;

  // Process content to render embedded assets
  const processedContent = useMemo(() => {
    if (!asset.text_content) return '';

    // Replace asset embed markers with actual components
    return asset.text_content.split(/(\{\{asset:\d+:\w+:\w+\}\})/g).map((part, index) => {
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
      
      // Regular text content
      return (
        <span key={`text-${index}`} className="whitespace-pre-wrap">
          {part}
        </span>
      );
    });
  }, [asset.text_content, embeddedAssets, onAssetClick]);

  return (
    <div className={cn("h-full flex flex-col", className)}>
      {/* Article Header */}
      <div className="flex-none p-6 border-b bg-muted/5">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
              <FileText className="h-4 w-4" />
              <span>{isComposedArticle ? 'Composed Article' : 'Article'}</span>
              {asset.event_timestamp && (
                <>
                  <span>•</span>
                  <Calendar className="h-3 w-3" />
                  <span>{format(new Date(asset.event_timestamp), "PPP")}</span>
                </>
              )}
            </div>
            
            <h1 className="text-2xl font-bold leading-tight mb-2">
              {asset.title}
            </h1>

            {summary && (
              <div className="bg-muted/30 p-3 rounded-lg border-l-4 border-primary mb-3">
                <p className="text-sm text-muted-foreground italic">
                  {summary}
                </p>
              </div>
            )}

            {/* Article Metadata */}
            <div className="flex flex-wrap items-center gap-3 text-sm">
              {articleMetadata.author && (
                <div className="flex items-center gap-1">
                  <User className="h-3 w-3" />
                  <span>{articleMetadata.author}</span>
                </div>
              )}
              {articleMetadata.category && (
                <Badge variant="outline" className="text-xs">
                  {articleMetadata.category}
                </Badge>
              )}
              {articleMetadata.tags && Array.isArray(articleMetadata.tags) && articleMetadata.tags.length > 0 && (
                <div className="flex items-center gap-1">
                  <Tag className="h-3 w-3" />
                  <div className="flex gap-1">
                    {articleMetadata.tags.slice(0, 3).map((tag: string, index: number) => (
                      <Badge key={index} variant="secondary" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                    {articleMetadata.tags.length > 3 && (
                      <Badge variant="secondary" className="text-xs">
                        +{articleMetadata.tags.length - 3}
                      </Badge>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {isComposedArticle && onEdit && (
              <Button variant="outline" size="sm" onClick={onEdit}>
                <Edit2 className="h-4 w-4 mr-2" />
                Edit Article
              </Button>
            )}
          </div>
        </div>

        {/* Composition Stats */}
        {isComposedArticle && (embeddedAssets.length > 0 || referencedBundles.length > 0) && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {embeddedAssets.length > 0 && (
              <div className="flex items-center gap-1">
                <Layers className="h-3 w-3" />
                <span>{embeddedAssets.length} embedded asset{embeddedAssets.length !== 1 ? 's' : ''}</span>
              </div>
            )}
            {referencedBundles.length > 0 && (
              <div className="flex items-center gap-1">
                <Folder className="h-3 w-3" />
                <span>{referencedBundles.length} referenced bundle{referencedBundles.length !== 1 ? 's' : ''}</span>
              </div>
            )}
            <span>•</span>
            <span>Updated {formatDistanceToNow(new Date(asset.updated_at), { addSuffix: true })}</span>
          </div>
        )}
      </div>

      {/* Article Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 py-6">
          <div className="prose prose-gray max-w-none">
            <div className="text-base leading-relaxed text-foreground">
              {processedContent}
            </div>
          </div>
        </div>
      </div>

      {/* Referenced Bundles Section */}
      {referencedBundles.length > 0 && (
        <div className="flex-none border-t bg-muted/5 p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Folder className="h-5 w-5 text-primary" />
            Referenced Bundles
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {referencedBundles.map((bundleId: number) => {
              const bundle = bundles.find(b => b.id === bundleId);
              return bundle ? (
                <Card 
                  key={bundleId} 
                  className="cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => {
                    // TODO: Navigate to bundle view or open bundle detail
                    console.log('Navigate to bundle:', bundle.id);
                  }}
                >
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Folder className="h-4 w-4 text-primary" />
                      <span className="truncate">{bundle.name}</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="space-y-2">
                      {bundle.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {bundle.description}
                        </p>
                      )}
                      <div className="flex items-center justify-between">
                        <Badge variant="outline" className="text-xs">
                          {bundle.asset_count} assets
                        </Badge>
                        <div className="flex gap-1">
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-6 text-xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              // TODO: Open bundle in new tab or detail view
                              console.log('View bundle details:', bundle.id);
                            }}
                          >
                            <Eye className="h-3 w-3 mr-1" />
                            View
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card key={bundleId} className="opacity-50">
                  <CardContent className="p-4 text-center">
                    <p className="text-sm text-muted-foreground">
                      Bundle {bundleId} not found
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
