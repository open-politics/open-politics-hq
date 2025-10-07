import React from 'react';
import { AssetRead } from '@/client';
import { getFeaturedImage } from './utils';
import { cn } from '@/lib/utils';

interface ArticleFeaturedImageProps {
  asset: AssetRead;
  childAssets?: AssetRead[];
  className?: string;
}

export default function ArticleFeaturedImage({ asset, childAssets, className }: ArticleFeaturedImageProps): React.ReactElement | null {
  const imageUrl = getFeaturedImage(asset, childAssets);
  
  if (!imageUrl) return null;
  
  // Find the child asset for credit info
  const imageAsset = childAssets?.find(
    child => child.kind === 'image' && 
    (child.source_metadata?.is_hero_image || child.source_identifier === imageUrl)
  );
  
  const mediaCredit = imageAsset?.source_metadata?.media_credit as string | undefined;

  return (
    <div className={cn("w-full mb-8", className)}>
      <div className="relative w-full aspect-video rounded-lg overflow-hidden bg-muted">
        <img
          src={imageUrl}
          alt={asset.title || 'Featured image'}
          className="w-full h-full object-cover"
          loading="lazy"
        />
      </div>
      
      {mediaCredit && (
        <p className="text-xs text-muted-foreground mt-2 italic">
          {mediaCredit}
        </p>
      )}
    </div>
  );
}
