/**
 * Shared Result Components
 * 
 * Reusable UI primitives for tool result renderers.
 * Following the minimal chrome architecture.
 */

import React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Loader2, AlertCircle, CheckCircle, XCircle } from 'lucide-react';

/**
 * Inline header for result metadata
 * Use this instead of card headers
 */
export interface ResultHeaderProps {
  count?: number;
  label?: string;
  query?: string;
  badge?: string;
  status?: 'success' | 'error' | 'warning' | 'info';
  className?: string;
}

export function ResultHeader({ 
  count, 
  label, 
  query, 
  badge,
  status,
  className 
}: ResultHeaderProps) {
  return (
    <div className={cn("flex items-center gap-2 text-sm text-muted-foreground", className)}>
      {count !== undefined && label && (
        <span className="font-medium">{count} {label}</span>
      )}
      {query && (
        <Badge variant="secondary" className="text-xs">
          "{query}"
        </Badge>
      )}
      {badge && (
        <Badge variant="outline" className="text-xs">{badge}</Badge>
      )}
      {status && <StatusIndicator status={status} />}
    </div>
  );
}

/**
 * Status indicator (inline, no labels)
 */
export function StatusIndicator({ 
  status, 
  size = 'sm' 
}: { 
  status: 'success' | 'error' | 'warning' | 'info' | 'loading'; 
  size?: 'sm' | 'md';
}) {
  const iconSize = size === 'sm' ? 'h-3 w-3' : 'h-4 w-4';
  
  switch (status) {
    case 'success':
      return <CheckCircle className={cn(iconSize, "text-green-500")} />;
    case 'error':
      return <XCircle className={cn(iconSize, "text-red-500")} />;
    case 'warning':
      return <AlertCircle className={cn(iconSize, "text-yellow-500")} />;
    case 'loading':
      return <Loader2 className={cn(iconSize, "animate-spin text-blue-500")} />;
    case 'info':
    default:
      return <AlertCircle className={cn(iconSize, "text-blue-500")} />;
  }
}

/**
 * Empty state
 */
export interface EmptyResultProps {
  resource?: string;
  message?: string;
  className?: string;
}

export function EmptyResult({ 
  resource = 'items', 
  message,
  className 
}: EmptyResultProps) {
  return (
    <div className={cn(
      "flex items-center justify-center py-8 text-sm text-muted-foreground",
      className
    )}>
      {message || `No ${resource} found`}
    </div>
  );
}

/**
 * Compact result preview (for inline display)
 */
export interface CompactResultProps {
  items: Array<{ id: string | number; name: string }>;
  total: number;
  resource?: string;
  query?: string;
  maxPreview?: number;
}

export function CompactResult({ 
  items, 
  total, 
  resource = 'items',
  query,
  maxPreview = 3 
}: CompactResultProps) {
  const preview = items.slice(0, maxPreview);
  
  return (
    <div className="space-y-1 text-sm">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="font-medium">{total} {resource}</span>
        {query && (
          <Badge variant="secondary" className="text-xs">
            "{query}"
          </Badge>
        )}
      </div>
      <div className="pl-2 space-y-0.5">
        {preview.map(item => (
          <div key={item.id} className="text-xs text-muted-foreground truncate">
            • {item.name}
          </div>
        ))}
        {items.length > maxPreview && (
          <div className="text-xs text-muted-foreground">
            ... and {items.length - maxPreview} more
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Result container (optional, for content that needs a border/background)
 */
export interface ResultContainerProps {
  children: React.ReactNode;
  className?: string;
  maxHeight?: string;
}

export function ResultContainer({ 
  children, 
  className,
  maxHeight = 'max-h-96'
}: ResultContainerProps) {
  return (
    <div className={cn(
      "overflow-auto rounded-md border bg-card",
      maxHeight,
      className
    )}>
      {children}
    </div>
  );
}

/**
 * Metadata list (key-value pairs)
 */
export interface MetadataListProps {
  items: Array<{ label: string; value: string | React.ReactNode }>;
  className?: string;
}

export function MetadataList({ items, className }: MetadataListProps) {
  return (
    <dl className={cn("grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs", className)}>
      {items.map((item, idx) => (
        <React.Fragment key={idx}>
          <dt className="text-muted-foreground font-medium">{item.label}:</dt>
          <dd className="text-foreground">{item.value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/**
 * Result footer (optional metadata at bottom)
 */
export interface ResultFooterProps {
  message?: string;
  metadata?: Array<{ label: string; value: string }>;
  className?: string;
}

export function ResultFooter({ message, metadata, className }: ResultFooterProps) {
  if (!message && !metadata?.length) return null;
  
  return (
    <div className={cn("pt-2 border-t text-xs text-muted-foreground", className)}>
      {message && <p>{message}</p>}
      {metadata && metadata.length > 0 && (
        <div className="flex flex-wrap gap-3 mt-1">
          {metadata.map((item, idx) => (
            <span key={idx}>
              <span className="font-medium">{item.label}:</span> {item.value}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

