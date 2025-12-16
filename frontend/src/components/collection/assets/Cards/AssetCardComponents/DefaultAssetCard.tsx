'use client';

import React from 'react';
import { CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatDistanceToNowStrict } from 'date-fns';
import { AssetCardBase } from '../AssetCardBase';
import { CardHeroFallback } from './CardHeroFallback';
import type { TypeSpecificCardProps, CardOrientation } from '../types';
import { 
  getAssetKindConfig, 
  getAssetBadgeClass, 
  formatAssetKind 
} from '../../assetKindConfig';
import { RelevanceBadge } from '../../RelevanceBadge';
import { cleanTextForPreview } from '../utils';

/**
 * DefaultAssetCard - Fallback card for asset types without specific renderers
 * 
 * Shows:
 * - Text hero with title prominently displayed
 * - Kind badge
 * - Created/updated time
 * - Text content preview (if available)
 */

interface DefaultAssetCardProps extends TypeSpecificCardProps {
  /** Card orientation */
  orientation?: CardOrientation;
  /** Whether this card is featured */
  isFeatured?: boolean;
}

export function DefaultAssetCard({
  asset,
  score,
  onClick,
  size = 'md',
  orientation = 'vertical',
  isFeatured = false,
  showMeta = true,
  className,
}: DefaultAssetCardProps) {
  const badgeClass = getAssetBadgeClass(asset.kind, 'card');
  
  const titleSizes = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-lg',
  };
  
  // Text content limits
  const textContentLimit = isFeatured 
    ? 500 
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
        {/* Hero section - left side */}
        <div className={cn(
          'relative shrink-0 overflow-hidden',
          size === 'sm' ? 'w-[100px]' : size === 'md' ? 'w-[180px]' : 'w-[240px]'
        )}>
          <CardHeroFallback
            title={asset.title || 'Untitled'}
            kind={asset.kind}
            size={size}
            orientation="horizontal"
          />
          
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
                {asset.title || 'Untitled'}
              </h3>
              {asset.text_content && (
                <p className="text-xs text-muted-foreground line-clamp-1 flex-1">
                  {cleanTextForPreview(asset.text_content, horizontalTextLimit)}
                </p>
              )}
              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-auto">
                <Badge 
                  variant="outline"
                  className={cn("text-xs h-4 px-1", badgeClass)}
                >
                  {formatAssetKind(asset.kind)}
                </Badge>
                <span className="ml-auto">
                  {formatDistanceToNowStrict(new Date(asset.created_at), { addSuffix: true })}
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-1.5">
                <Badge 
                  variant="outline" 
                  className={cn('text-xs h-5 shrink-0', badgeClass)}
                >
                  {React.createElement(getAssetKindConfig(asset.kind).icon, {
                    className: "h-3 w-3 mr-1"
                  })}
                  {formatAssetKind(asset.kind)}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {formatDistanceToNowStrict(new Date(asset.created_at), { addSuffix: true })}
                </span>
              </div>
              
              <h3 className={cn("font-semibold leading-tight line-clamp-2 mb-1.5", titleSizes[size])}>
                {asset.title || 'Untitled'}
              </h3>
              
              {asset.text_content && (
                <p className="text-sm text-muted-foreground line-clamp-2 flex-1">
                  {cleanTextForPreview(asset.text_content, horizontalTextLimit)}
                </p>
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
        {/* Text Hero area */}
        <div className="flex-1 min-h-[150px] relative overflow-hidden">
          <CardHeroFallback
            title={asset.title || 'Untitled'}
            textContent={cleanTextForPreview(asset.text_content || '', textContentLimit)}
            kind={asset.kind}
            size={size}
          />
          
          {score !== undefined && (
            <RelevanceBadge 
              score={score}
              className="absolute top-2 right-2 bg-background/80 px-1.5 py-0.5 rounded"
            />
          )}
        </div>
        
        {/* Content footer */}
        <CardContent className="p-3 flex flex-col gap-1">
          {showMeta && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge 
                variant="outline" 
                className={cn('text-xs h-5', badgeClass)}
              >
                {React.createElement(getAssetKindConfig(asset.kind).icon, {
                  className: "h-3 w-3 mr-1"
                })}
                {formatAssetKind(asset.kind)}
              </Badge>
              <span className="ml-auto">
                {formatDistanceToNowStrict(new Date(asset.created_at), { addSuffix: true })}
              </span>
            </div>
          )}
        </CardContent>
      </div>
    </AssetCardBase>
  );
}
