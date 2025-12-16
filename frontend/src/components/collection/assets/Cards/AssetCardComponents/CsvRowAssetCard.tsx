'use client';

import React from 'react';
import { CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatDistanceToNowStrict } from 'date-fns';
import { AssetCardBase } from '../AssetCardBase';
import type { TypeSpecificCardProps, CardOrientation } from '../types';
import { 
  getAssetKindConfig, 
  getAssetBadgeClass, 
  formatAssetKind 
} from '../../assetKindConfig';
import { RelevanceBadge } from '../../RelevanceBadge';

/**
 * CsvRowAssetCard - Card for CSV row assets
 * 
 * Features:
 * - Title split by "|" displayed as fields
 * - Vertical: Fields stacked in rows in the hero area
 * - Horizontal: Fields displayed inline with pipe separators (like detail view)
 * - Fragment count badge
 */

interface CsvRowAssetCardProps extends TypeSpecificCardProps {
  /** Card orientation */
  orientation?: CardOrientation;
  /** Whether this card is featured */
  isFeatured?: boolean;
}

export function CsvRowAssetCard({
  asset,
  score,
  onClick,
  size = 'md',
  orientation = 'vertical',
  isFeatured = false,
  showMeta = true,
  className,
}: CsvRowAssetCardProps) {
  const fragmentCount = asset.fragments ? Object.keys(asset.fragments).length : 0;
  
  // Split the title by "|" to create fields
  const titleParts = (asset.title || '').split('|').map(part => part.trim()).filter(Boolean);
  
  // Determine how many fields to show based on size and orientation
  const getMaxFields = () => {
    if (orientation === 'horizontal') {
      // Horizontal shows fewer fields but inline
      return { sm: 3, md: 5, lg: 7 }[size];
    }
    return { sm: 4, md: 6, lg: 8 }[size];
  };
  
  const maxFields = getMaxFields();
  const displayFields = titleParts.slice(0, maxFields);
  const hasMore = titleParts.length > maxFields;
  
  const rowTextSizes = {
    sm: 'text-xs',
    md: 'text-xs',
    lg: 'text-sm',
  };

  // Horizontal layout - compact list-style card with pipe-separated fields
  if (orientation === 'horizontal') {
    const isCompact = size === 'sm';
    
    return (
      <AssetCardBase
        onClick={onClick ? () => onClick(asset) : undefined}
        size={size}
        orientation="horizontal"
        className={className}
      >
        {/* Left side - Field preview area */}
        <div className={cn(
          'relative shrink-0 overflow-hidden',
          'bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/50 dark:to-teal-950/50',
          size === 'sm' ? 'w-[100px]' : size === 'md' ? 'w-[160px]' : 'w-[200px]'
        )}>
          {/* Mini field preview */}
          <div className="absolute inset-0 p-2 flex flex-col justify-center gap-1">
            {displayFields.slice(0, 3).map((field, index) => (
              <div 
                key={index}
                className={cn(
                  "px-1.5 py-0.5 rounded truncate",
                  "bg-white/60 dark:bg-black/20",
                  "border border-emerald-200/50 dark:border-emerald-800/30",
                  "text-[9px] font-mono",
                  "text-emerald-900 dark:text-emerald-100"
                )}
              >
                {field}
              </div>
            ))}
            {displayFields.length > 3 && (
              <div className="text-[8px] text-emerald-600/60 dark:text-emerald-400/60 text-center">
                +{displayFields.length - 3}
              </div>
            )}
          </div>
          
          {/* Relevance score badge */}
          {score !== undefined && (
            <RelevanceBadge 
              score={score}
              className="absolute top-1 right-1 bg-background/90 px-1 py-0.5 rounded text-[10px]"
            />
          )}
        </div>
        
        {/* Content section - pipe-separated fields */}
        <div className={cn(
          'flex-1 flex flex-col min-w-0 overflow-hidden',
          isCompact ? 'p-2' : 'p-3'
        )}>
          {isCompact ? (
            /* Compact layout for bento stacks */
            <>
              {/* Inline pipe-separated fields */}
              <div className="font-mono text-xs text-emerald-800 dark:text-emerald-200 line-clamp-2 mb-1">
                {displayFields.join(' | ')}
                {hasMore && <span className="text-emerald-600/60"> +{titleParts.length - maxFields}</span>}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-auto">
                <span className="text-emerald-600/80 dark:text-emerald-400/80">
                  {titleParts.length} fields
                </span>
                <span className="ml-auto">
                  {formatDistanceToNowStrict(new Date(asset.created_at), { addSuffix: true })}
                </span>
              </div>
            </>
          ) : (
            /* Full layout for list view */
            <>
              {/* Header row */}
              <div className="flex items-center gap-2 mb-2">
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
                  {titleParts.length} fields
                </span>
                <span className="text-xs text-muted-foreground ml-auto">
                  {formatDistanceToNowStrict(new Date(asset.created_at), { addSuffix: true })}
                </span>
              </div>
              
              {/* Pipe-separated fields - main content */}
              <div className={cn(
                "font-mono leading-relaxed flex-1",
                rowTextSizes[size],
                "text-emerald-800 dark:text-emerald-200"
              )}>
                <span className="line-clamp-3">
                  {displayFields.join(' | ')}
                  {hasMore && (
                    <span className="text-emerald-600/60 dark:text-emerald-400/60">
                      {' '}| +{titleParts.length - maxFields} more
                    </span>
                  )}
                </span>
              </div>
              
              {/* Footer with fragment count */}
              {fragmentCount > 0 && (
                <div className="flex items-center gap-2 mt-auto pt-2 border-t border-border/50">
                  <Badge variant="secondary" className="text-xs h-5 px-2">
                    {fragmentCount} analysis
                  </Badge>
                </div>
              )}
            </>
          )}
        </div>
      </AssetCardBase>
    );
  }

  // Vertical layout (original stacked rows)
  return (
    <AssetCardBase
      onClick={onClick ? () => onClick(asset) : undefined}
      size={size}
      className={className}
    >
      <div className="flex flex-col h-full">
        {/* CSV Row Preview - takes most space */}
        <div className="flex-1 min-h-[150px] bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30 relative overflow-hidden">
          {/* Row display */}
          <div className="absolute inset-0 p-3 flex flex-col">
            <div className="flex-1 overflow-hidden space-y-1">
              {displayFields.map((field, index) => (
                <div 
                  key={index}
                  className={cn(
                    "px-2 py-1 rounded",
                    "bg-white/60 dark:bg-black/20",
                    "border border-emerald-200/50 dark:border-emerald-800/30",
                    "truncate",
                    rowTextSizes[size],
                    "text-emerald-900 dark:text-emerald-100",
                    "font-mono"
                  )}
                >
                  {field}
                </div>
              ))}
              {hasMore && (
                <div className={cn(
                  "text-emerald-600/60 dark:text-emerald-400/60 text-center",
                  rowTextSizes[size]
                )}>
                  +{titleParts.length - maxFields} more fields
                </div>
              )}
              {displayFields.length === 0 && (
                <div className="flex items-center justify-center h-full">
                  {React.createElement(getAssetKindConfig(asset.kind).icon, {
                    className: "h-12 w-12 text-emerald-600/40"
                  })}
                </div>
              )}
            </div>
          </div>
          
          {/* Relevance score badge */}
          {score !== undefined && (
            <RelevanceBadge 
              score={score}
              className="absolute top-2 right-2 bg-background/80 px-1.5 py-0.5 rounded"
            />
          )}
          
          {/* Fragment count badge */}
          {fragmentCount > 0 && (
            <Badge 
              variant="secondary"
              className="absolute bottom-2 right-2 bg-black/60 text-white border-0"
            >
              {fragmentCount} analysis
            </Badge>
          )}
        </div>
        
        {/* Content - compact footer */}
        <CardContent className="p-3 flex flex-col gap-1">
          {/* Meta row with inline badge */}
          {showMeta && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{titleParts.length} fields</span>
              <span>•</span>
              <span>
                {formatDistanceToNowStrict(new Date(asset.created_at), { addSuffix: true })}
              </span>
              {/* Kind badge inline */}
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
