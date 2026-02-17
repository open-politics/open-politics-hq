import React from 'react';
import { Badge } from '@/components/ui/badge';
import { SingleFragmentProps } from './types';
import { getDisplayFragmentKey } from './utils';
import { cn } from '@/lib/utils';

/**
 * Get type information for a value
 */
export function getValueType(value: any): { type: string; label: string; count?: number } {
  if (value === null || value === undefined) {
    return { type: 'empty', label: 'Empty' };
  }
  
  if (Array.isArray(value)) {
    return { type: 'array', label: 'Array', count: value.length };
  }
  
  if (typeof value === 'object') {
    const keyCount = Object.keys(value).length;
    return { type: 'object', label: 'Object', count: keyCount };
  }
  
  // Check for date strings
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return { type: 'date', label: 'Date' };
  }
  
  return { type: typeof value, label: typeof value === 'string' ? 'String' : typeof value === 'number' ? 'Number' : typeof value === 'boolean' ? 'Boolean' : 'Unknown' };
}

/**
 * Type badge component - shows data type with optional count
 * Simplified styling - no colors, just text
 */
export function FragmentTypeBadge({ 
  value,
  className 
}: { 
  value: any;
  className?: string;
}) {
  const typeInfo = getValueType(value);
  
  const label = typeInfo.count !== undefined 
    ? `${typeInfo.label}(${typeInfo.count})`
    : typeInfo.label;
  
  return (
    <span
      className={cn(
        "text-[10px] text-muted-foreground font-mono shrink-0 align-baseline",
        className
      )}
    >
      {label}
    </span>
  );
}

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
