'use client';

import React, { useState, useEffect } from 'react';
import { CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNowStrict, format } from 'date-fns';
import { AssetCardBase } from '../AssetCardBase';
import { useAssetChildren } from '../../Feed/useAssetChildren';
import { CardHeroFallback } from './CardHeroFallback';
import type { TypeSpecificCardProps, FeaturedImageInfo, CardOrientation } from '../types';
import type { AssetRead } from '@/client';
import { 
  getAssetKindConfig, 
  getAssetBadgeClass, 
  formatAssetKind 
} from '../../assetKindConfig';
import { RelevanceBadge } from '../../RelevanceBadge';
import { cleanTextForPreview } from '../utils';

/**
 * ArticleAssetCard - Rich card for article assets
 * 
 * Features:
 * - Featured image (from source_metadata first, then lazy-loads children if needed)
 * - Title (2-line clamp)
 * - Publication date + author
 * - Text content preview
 * - Fragment count badge (optional)
 * - Vertical and horizontal orientation support
 * 
 * Image loading strategy:
 * 1. Check source_metadata for og_image/featured_image_url (no API call)
 * 2. If no metadata image, show text fallback immediately
 * 3. Optionally lazy-load children to find images (background)
 */

// Helper to check if an image URL is a .gif
function isGifImage(url: string): boolean {
  return url.toLowerCase().includes('.gif');
}

// Get image from source_metadata (synchronous, no API call)
function getMetadataImage(asset: AssetRead): FeaturedImageInfo | null {
  const metadata = asset.source_metadata as Record<string, any> | null;
  if (!metadata) return null;
  
  if (metadata.featured_image_url && !isGifImage(metadata.featured_image_url)) {
    return {
      url: metadata.featured_image_url,
      alt: asset.title || 'Article image',
      credit: metadata.media_credit as string | undefined,
    };
  }
  
  if (metadata.og_image && !isGifImage(metadata.og_image)) {
    return {
      url: metadata.og_image,
      alt: asset.title || 'Article image',
    };
  }
  
  return null;
}

// Get image from child assets
function getChildImage(childAssets: AssetRead[]): FeaturedImageInfo | null {
  if (!childAssets || childAssets.length === 0) return null;
  
  // First try to find explicitly marked featured/hero image
  const featuredChild = childAssets.find(child => 
    child.kind === 'image' && 
    (child.source_metadata?.is_hero_image || 
     child.source_metadata?.image_role === 'featured' ||
     child.part_index === 0)
  );
  
  if (featuredChild) {
    const imgUrl = featuredChild.source_identifier || featuredChild.blob_path;
    if (imgUrl && !isGifImage(imgUrl)) {
      return {
        url: imgUrl,
        alt: featuredChild.title || 'Article image',
        credit: featuredChild.source_metadata?.media_credit as string | undefined,
      };
    }
  }
  
  // Fall back to first non-gif image
  const firstImage = childAssets.find(child => {
    if (child.kind !== 'image') return false;
    const url = child.source_identifier || child.blob_path;
    return url && !isGifImage(url);
  });
  
  if (firstImage) {
    const imgUrl = firstImage.source_identifier || firstImage.blob_path;
    if (imgUrl) {
      return {
        url: imgUrl,
        alt: firstImage.title || 'Article image',
        credit: firstImage.source_metadata?.media_credit as string | undefined,
      };
    }
  }
  
  return null;
}

interface ArticleAssetCardProps extends TypeSpecificCardProps {
  /** Custom fetch function for blob images (for authenticated access) */
  fetchBlobUrl?: (blobPath: string) => Promise<string | null>;
  /** Card orientation */
  orientation?: CardOrientation;
  /** Whether this card is featured (e.g., in bento layout) - shows more content */
  isFeatured?: boolean;
}

export function ArticleAssetCard({
  asset,
  childAssets: passedChildren,
  score,
  onClick,
  size = 'md',
  orientation = 'vertical',
  isFeatured = false,
  showMeta = true,
  className,
  fetchBlobUrl,
}: ArticleAssetCardProps) {
  // Check metadata image synchronously (no loading state needed)
  const metadataImage = getMetadataImage(asset);
  const hasMetadataImage = !!metadataImage;
  
  // Image state - only used when we have a metadata image
  const [imageSrc, setImageSrc] = useState<string | null>(metadataImage?.url || null);
  const [imageError, setImageError] = useState(false);
  
  // Only fetch children if we don't have a metadata image and asset is a container
  const shouldFetchChildren = !hasMetadataImage && !passedChildren && asset.is_container;
  const { children: fetchedChildren } = useAssetChildren(asset.id, shouldFetchChildren);
  
  // Check for child images (only if we fetched them)
  const childImage = fetchedChildren ? getChildImage(fetchedChildren) : null;
  
  // Update image source if we found a child image
  useEffect(() => {
    if (childImage && !imageSrc) {
      const loadChildImage = async () => {
        const { url } = childImage;
        if (url && !url.startsWith('http') && fetchBlobUrl) {
          try {
            const blobUrl = await fetchBlobUrl(url);
            if (blobUrl) setImageSrc(blobUrl);
          } catch {
            // Ignore errors, we'll show fallback
          }
        } else {
          setImageSrc(url);
        }
      };
      loadChildImage();
    }
  }, [childImage, imageSrc, fetchBlobUrl]);
  
  const metadata = asset.source_metadata as Record<string, any> | null;
  const author = metadata?.author;
  const publishedDate = metadata?.publication_date || metadata?.published_date;
  const fragmentCount = asset.fragments ? Object.keys(asset.fragments).length : 0;
  
  const titleSizes = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-lg',
  };
  
  // Determine display mode
  const hasImage = imageSrc && !imageError;
  const showTextFallback = !hasImage;
  
  // Text content limits
  const textContentLimit = isFeatured
    ? 500
    : hasImage 
      ? 150 
      : orientation === 'horizontal' 
        ? 400 
        : 300;

  // Horizontal layout
  if (orientation === 'horizontal') {
    const horizontalTextLimit = size === 'sm' ? 150 : isFeatured ? 600 : 350;
    const isCompact = size === 'sm';
    
    return (
      <AssetCardBase
        onClick={onClick ? () => onClick(asset) : undefined}
        size={size}
        orientation="horizontal"
        className={className}
      >
        {/* Image/Fallback section - left side */}
        <div className={cn(
          'relative shrink-0 overflow-hidden',
          size === 'sm' ? 'w-[100px]' : size === 'md' ? 'w-[180px]' : 'w-[240px]'
        )}>
          {hasImage ? (
            <img
              src={imageSrc}
              alt={asset.title || 'Article'}
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
              onError={() => setImageError(true)}
              loading="lazy"
            />
          ) : (
            <CardHeroFallback
              title={asset.title || 'Untitled Article'}
              kind={asset.kind}
              size={size}
              orientation="horizontal"
            />
          )}
          
          {score !== undefined && (
            <RelevanceBadge 
              score={score}
              className="absolute top-1 right-1 bg-background/90 px-1 py-0.5 rounded text-[10px]"
            />
          )}
        </div>
        
        {/* Content section */}
        <div className={cn(
          'flex-1 flex flex-col min-w-0 overflow-hidden',
          isCompact ? 'p-2' : 'p-3'
        )}>
          {isCompact ? (
            <>
              <h3 className="font-semibold text-sm leading-tight line-clamp-2 mb-1">
                {asset.title || 'Untitled Article'}
              </h3>
              {asset.text_content && (
                <p className="text-xs text-muted-foreground line-clamp-1 flex-1">
                  {cleanTextForPreview(asset.text_content, horizontalTextLimit)}
                </p>
              )}
              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-auto">
                <Badge 
                  variant="outline"
                  className={cn("text-xs h-4 px-1", getAssetBadgeClass(asset.kind, 'card'))}
                >
                  {formatAssetKind(asset.kind)}
                </Badge>
                <span className="ml-auto">
                  {publishedDate 
                    ? format(new Date(publishedDate), 'MMM d')
                    : formatDistanceToNowStrict(new Date(asset.created_at), { addSuffix: true })}
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-1.5">
                <Badge 
                  variant="outline"
                  className={cn("text-xs h-5 shrink-0", getAssetBadgeClass(asset.kind, 'card'))}
                >
                  {React.createElement(getAssetKindConfig(asset.kind).icon, {
                    className: "h-3 w-3 mr-1"
                  })}
                  {formatAssetKind(asset.kind)}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {publishedDate 
                    ? format(new Date(publishedDate), 'MMM d, yyyy')
                    : formatDistanceToNowStrict(new Date(asset.created_at), { addSuffix: true })}
                </span>
              </div>
              
              <h3 className={cn("font-semibold leading-tight line-clamp-2 mb-1.5", titleSizes[size])}>
                {asset.title || 'Untitled Article'}
              </h3>
              
              {asset.text_content && (
                <p className="text-sm text-muted-foreground line-clamp-2 flex-1">
                  {cleanTextForPreview(asset.text_content, horizontalTextLimit)}
                </p>
              )}
              
              {showMeta && author && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-auto pt-1.5 border-t border-border/50">
                  <span className="truncate max-w-[150px]">By {author}</span>
                  {fragmentCount > 0 && (
                    <Badge variant="secondary" className="ml-auto text-xs h-5 px-2">
                      {fragmentCount} analysis
                    </Badge>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </AssetCardBase>
    );
  }

  // Vertical layout
  return (
    <AssetCardBase
      onClick={onClick ? () => onClick(asset) : undefined}
      size={size}
      orientation="vertical"
      className={className}
    >
      <div className="flex flex-col h-full">
        {/* Featured Image or Text Hero Fallback */}
        <div className={cn(
          'relative overflow-hidden',
          hasImage ? 'aspect-video bg-muted' : 'flex-1 min-h-[150px]'
        )}>
          {hasImage ? (
            <img
              src={imageSrc}
              alt={asset.title || 'Article'}
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
              onError={() => setImageError(true)}
              loading="lazy"
            />
          ) : (
            <CardHeroFallback
              title={asset.title || 'Untitled Article'}
              subtitle={author || undefined}
              textContent={cleanTextForPreview(asset.text_content || '', textContentLimit)}
              kind={asset.kind}
              size={size}
            />
          )}
          
          {score !== undefined && (
            <RelevanceBadge 
              score={score}
              className="absolute top-2 right-2 bg-background/80 px-1.5 py-0.5 rounded"
            />
          )}
          
          {fragmentCount > 0 && (
            <Badge 
              variant="secondary"
              className="absolute bottom-2 right-2 bg-black/60 text-white border-0"
            >
              {fragmentCount} analysis
            </Badge>
          )}
        </div>
        
        {/* Content footer */}
        <CardContent className={cn(
          'flex flex-col',
          showTextFallback ? 'p-3 gap-1' : 'p-3 flex-1 gap-1.5'
        )}>
          {/* Title - only when we have an image (fallback shows title in hero) */}
          {hasImage && (
            <h3 className={cn('font-semibold line-clamp-2', titleSizes[size])}>
              {asset.title || 'Untitled Article'}
            </h3>
          )}
          
          {/* Text preview - only when we have an image */}
          {hasImage && asset.text_content && (
            <p className="text-xs text-muted-foreground line-clamp-2">
              {cleanTextForPreview(asset.text_content, textContentLimit)}
            </p>
          )}

          {/* Meta row */}
          {showMeta && (
            <div className={cn(
              'flex items-center gap-2 text-xs text-muted-foreground',
              hasImage && 'mt-auto pt-1.5'
            )}>
              {publishedDate && (
                <span>{format(new Date(publishedDate), 'MMM d, yyyy')}</span>
              )}
              {author && hasImage && (
                <>
                  {publishedDate && <span>•</span>}
                  <span className="truncate max-w-[100px]">{author}</span>
                </>
              )}
              {!publishedDate && (
                <span>
                  {formatDistanceToNowStrict(new Date(asset.created_at), { addSuffix: true })}
                </span>
              )}
              
              <Badge 
                variant="outline"
                className={cn(
                  "ml-auto text-xs h-5",
                  getAssetBadgeClass(asset.kind, 'card')
                )}
              >
                {React.createElement(getAssetKindConfig(asset.kind).icon, {
                  className: "h-3 w-3 mr-1"
                })}
                {formatAssetKind(asset.kind)}
              </Badge>
            </div>
          )}
        </CardContent>
      </div>
    </AssetCardBase>
  );
}
