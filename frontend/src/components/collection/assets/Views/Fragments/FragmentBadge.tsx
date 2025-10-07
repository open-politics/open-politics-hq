import React from 'react';
import { Badge } from '@/components/ui/badge';
import { SingleFragmentProps } from './types';
import { getDisplayFragmentKey } from './utils';
import { cn } from '@/lib/utils';

/**
 * Minimal badge view of a fragment - just shows count or key
 */
export function FragmentBadge({ 
  fragmentKey, 
  fragment,
  onFragmentClick,
  className 
}: SingleFragmentProps) {
  const displayKey = getDisplayFragmentKey(fragmentKey);
  
  return (
    <Badge
      variant="outline"
      className={cn(
        "h-4 px-1 text-xs bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900 dark:text-blue-300 cursor-pointer hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors",
        className
      )}
      onClick={(e) => {
        e.stopPropagation();
        onFragmentClick?.();
      }}
      title={`Fragment: ${displayKey}`}
    >
      {displayKey}
    </Badge>
  );
}

/**
 * Simple count badge - shows number of fragments
 */
export function FragmentCountBadge({ 
  count,
  onClick,
  className 
}: { 
  count: number;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "h-4 px-1 text-xs bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900 dark:text-blue-300",
        onClick && "cursor-pointer hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors",
        className
      )}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      title={`${count} fragment${count !== 1 ? 's' : ''}`}
    >
      F{count}
    </Badge>
  );
}
