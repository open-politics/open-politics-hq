import React, { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { getDisplayFragmentKey } from './utils';

interface FragmentInlineProps {
  fragmentKey: string;
  value: any;
  onDelete?: (key: string) => void;
  className?: string;
}

/**
 * Minimal inline fragment display
 * - Shows key + value (arrays as badges, others as text)
 * - Click to expand/collapse long values
 * - X button to delete
 */
export function FragmentInline({ 
  fragmentKey, 
  value, 
  onDelete,
  className 
}: FragmentInlineProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const displayKey = getDisplayFragmentKey(fragmentKey);
  const isArray = Array.isArray(value);
  const maxItems = 3;
  const maxTextLength = 40;

  // Render value content
  const renderValue = () => {
    if (isArray) {
      const items = value as any[];
      const visibleItems = isExpanded ? items : items.slice(0, maxItems);
      const hasMore = items.length > maxItems && !isExpanded;
      
      return (
        <div className="flex flex-wrap gap-1 items-center">
          {visibleItems.map((item, i) => (
            <Badge key={i} variant="secondary" className="text-xs px-1.5 py-0 h-5">
              {typeof item === 'object' ? JSON.stringify(item) : String(item)}
            </Badge>
          ))}
          {hasMore && (
            <span 
              className="text-muted-foreground cursor-pointer hover:text-primary"
              onClick={() => setIsExpanded(true)}
            >
              +{items.length - maxItems} more
            </span>
          )}
          {isExpanded && items.length > maxItems && (
            <span 
              className="text-muted-foreground cursor-pointer hover:text-primary"
              onClick={() => setIsExpanded(false)}
            >
              show less
            </span>
          )}
        </div>
      );
    }

    // Non-array value
    const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value || '');
    const isLong = stringValue.length > maxTextLength;
    const displayValue = isExpanded || !isLong 
      ? stringValue 
      : stringValue.substring(0, maxTextLength) + '...';

    return (
      <span 
        className={cn(
          "min-w-0",
          isLong && "cursor-pointer hover:text-primary",
          isExpanded ? "whitespace-normal break-words" : "truncate"
        )}
        onClick={() => isLong && setIsExpanded(!isExpanded)}
        title={isLong && !isExpanded ? stringValue : undefined}
      >
        {displayValue}
      </span>
    );
  };

  return (
    <div className={cn(
      "inline-flex items-center gap-1.5 text-xs  rounded px-2 py-1 max-w-full",
      className
    )}>
      <span className="font-medium text-muted-foreground shrink-0">
        {displayKey}:
      </span>
      {renderValue()}
      {onDelete && (
        <Button
          variant="ghost"
          size="sm"
          className="h-4 w-4 p-0 ml-1 shrink-0 text-muted-foreground hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(fragmentKey);
          }}
        >
          <X className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}

interface FragmentInlineListProps {
  fragments: Record<string, any>;
  onDelete?: (key: string) => void;
  className?: string;
  defaultExpanded?: boolean;
  peekCount?: number;
}

/**
 * Collapsible list of inline fragments
 * - Collapsed by default, showing peekCount fragments
 * - Click to expand/collapse
 */
export function FragmentInlineList({ 
  fragments, 
  onDelete,
  className,
  defaultExpanded = false,
  peekCount = 2
}: FragmentInlineListProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const entries = Object.entries(fragments);
  
  if (entries.length === 0) return null;

  const hasMore = entries.length > peekCount;
  const visibleEntries = isExpanded ? entries : entries.slice(0, peekCount);
  const hiddenCount = entries.length - peekCount;

  return (
    <div className={cn("flex flex-wrap gap-1.5 items-center", className)}>
      {visibleEntries.map(([key, fragmentData]) => {
        // Handle both simple values and fragment objects with .value property
        const value = fragmentData?.value !== undefined ? fragmentData.value : fragmentData;
        return (
          <FragmentInline
            key={key}
            fragmentKey={key}
            value={value}
            onDelete={onDelete}
          />
        );
      })}
      {hasMore && (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-xs text-muted-foreground hover:text-primary cursor-pointer px-1"
        >
          {isExpanded ? 'show less' : `+${hiddenCount} more`}
        </button>
      )}
    </div>
  );
}
