'use client';

import React from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { CardSize, CardOrientation } from './types';

/**
 * AssetCardBase - Shared card shell for all asset cards
 * 
 * Provides consistent styling, hover states, and click handling.
 * Type-specific cards render their content inside this shell.
 * 
 * Supports two orientations:
 * - vertical (default): Tall cards with image on top, content below
 * - horizontal: Wide rectangular cards with image on left, content on right
 * 
 * Height behavior:
 * - When parent has explicit height (e.g., min-h-[X] [&>*]:h-full), card fills it
 * - Otherwise uses min-height based on size
 */
interface AssetCardBaseProps {
  children: React.ReactNode;
  onClick?: () => void;
  size?: CardSize;
  /** Card orientation - vertical (tall) or horizontal (wide) */
  orientation?: CardOrientation;
  className?: string;
  /** Whether the card is in a loading state */
  isLoading?: boolean;
}

export function AssetCardBase({
  children,
  onClick,
  size = 'md',
  orientation = 'vertical',
  className,
  isLoading = false,
}: AssetCardBaseProps) {
  // Min-height classes for vertical orientation (used as fallback)
  const verticalSizeClasses = {
    sm: 'min-h-[180px]',
    md: 'min-h-[240px]',
    lg: 'min-h-[320px]',
  };
  
  // Min-height classes for horizontal orientation
  // These are minimums - cards will grow to fill parent if parent has height set
  const horizontalSizeClasses = {
    sm: 'min-h-[80px]',   // Compact - for bento stacks
    md: 'min-h-[150px]',  // Standard list item
    lg: 'min-h-[160px]',  // Featured/prominent
  };

  return (
    <Card
      className={cn(
        'group overflow-hidden transition-all duration-200',
        'hover:shadow-lg hover:border-primary/20',
        onClick && 'cursor-pointer',
        // Base flex direction
        orientation === 'vertical' 
          ? 'flex flex-col' 
          : 'flex flex-row',
        // Min heights (card will grow if parent sets explicit height)
        orientation === 'vertical' 
          ? verticalSizeClasses[size]
          : horizontalSizeClasses[size],
        // Allow height to be controlled by parent
        'h-full',
        isLoading && 'animate-pulse',
        className
      )}
      onClick={onClick}
    >
      {children}
    </Card>
  );
}

/**
 * Loading skeleton for cards
 */
export function AssetCardSkeleton({ 
  size = 'md',
  orientation = 'vertical' 
}: { 
  size?: CardSize;
  orientation?: CardOrientation;
}) {
  if (orientation === 'horizontal') {
    return (
      <AssetCardBase size={size} orientation={orientation} isLoading>
        <div className="flex flex-row h-full w-full">
          {/* Image placeholder - left side */}
          <div className={cn(
            "bg-muted shrink-0",
            size === 'sm' ? 'w-[100px]' : size === 'md' ? 'w-[180px]' : 'w-[240px]'
          )} />
          {/* Content placeholder - right side */}
          <div className="flex-1 p-3 flex flex-col gap-2">
            <div className="h-4 bg-muted rounded w-3/4" />
            <div className="h-3 bg-muted rounded w-full" />
            <div className="h-3 bg-muted rounded w-5/6" />
            <div className="flex gap-2 mt-auto">
              <div className="h-3 bg-muted rounded w-16" />
              <div className="h-3 bg-muted rounded w-20" />
            </div>
          </div>
        </div>
      </AssetCardBase>
    );
  }
  
  return (
    <AssetCardBase size={size} orientation={orientation} isLoading>
      <div className="flex flex-col h-full">
        {/* Image placeholder */}
        <div className="aspect-video bg-muted" />
        {/* Content placeholder */}
        <div className="p-4 flex-1 space-y-3">
          <div className="h-4 bg-muted rounded w-3/4" />
          <div className="h-4 bg-muted rounded w-1/2" />
          <div className="h-3 bg-muted rounded w-1/3 mt-auto" />
        </div>
      </div>
    </AssetCardBase>
  );
}
