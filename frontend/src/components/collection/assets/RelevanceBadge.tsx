'use client';

/**
 * RelevanceBadge - Plaintext percentage badge for semantic search scores
 * 
 * Simple, unobtrusive display of relevance scores (0-100%).
 * No background color - just muted text.
 * 
 * Usage:
 * ```tsx
 * <RelevanceBadge score={87} />
 * ```
 */

import React from 'react';
import { cn } from '@/lib/utils';

export interface RelevanceBadgeProps {
  /** Relevance score (0-100) */
  score: number;
  /** Additional CSS classes */
  className?: string;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
}

const sizeClasses = {
  sm: 'text-[10px]',
  md: 'text-xs',
  lg: 'text-sm',
};

export function RelevanceBadge({ score, className, size = 'md' }: RelevanceBadgeProps) {
  // Clamp score to 0-100
  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  
  return (
    <span
      className={cn(
        'text-muted-foreground font-medium',
        sizeClasses[size],
        className
      )}
    >
      {clampedScore}%
    </span>
  );
}
