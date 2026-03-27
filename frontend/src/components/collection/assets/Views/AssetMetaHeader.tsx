'use client';

import React, { useState, useMemo } from 'react';
import { AssetRead } from '@/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { 
  ExternalLink, 
  MoreHorizontal, 
  Download, 
  Share2, 
  Trash2, 
  Copy, 
  Edit2,
  Save,
  X,
  Loader2,
  ArrowDownAZ,
  Clock,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNowStrict, format } from 'date-fns';
import { toast } from 'sonner';
import { FragmentAccordion } from './Fragments';
import { FragmentData } from './Fragments/types';
import { 
  getAssetIcon, 
  getAssetBadgeClass, 
  getAssetKindConfig,
  formatAssetKind 
} from '@/components/collection/assets/assetKindConfig';

// ============================================================================
// Types
// ============================================================================

export type FragmentSortMode = 'alphabetical' | 'time';

/** Format ISO event time for datetime-local input (local, YYYY-MM-DDTHH:mm) */
export function formatEventTimestampForInput(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const y = date.getFullYear();
    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const d = date.getDate().toString().padStart(2, '0');
    const h = date.getHours().toString().padStart(2, '0');
    const min = date.getMinutes().toString().padStart(2, '0');
    return `${y}-${m}-${d}T${h}:${min}`;
  } catch {
    return '';
  }
}

export interface AssetMetaHeaderProps {
  asset: AssetRead;
  className?: string;
  
  /** Inline edit: pencil / save in header; title + event time edited here; body text in parent */
  inlineEdit?: {
    active: boolean;
    draftTitle: string;
    draftEventTimestamp: string;
    onDraftTitleChange: (value: string) => void;
    onDraftEventTimestampChange: (value: string) => void;
    onStart: () => void;
    onSave: () => void;
    onCancel: () => void;
    isSaving: boolean;
  };

  // Actions
  onDelete?: () => void;
  onDownload?: () => void;
  onShare?: () => void;
  onFragmentDelete?: (key: string) => void;
  
  // Configuration
  showActions?: boolean;
  showFragments?: boolean;
  compactMode?: boolean;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get kind-specific metadata fields
 */
function getKindSpecificMeta(asset: AssetRead): { label: string; value: string }[] {
  const meta: { label: string; value: string }[] = [];
  const fi = asset.file_info as Record<string, unknown> | null;
  const facets = asset.facets as Record<string, unknown> | null;
  const sm = { ...(fi ?? {}), ...(facets ?? {}) };
  
  if (Object.keys(sm).length === 0) return meta;
  
  switch (asset.kind) {
    case 'pdf':
      if (sm.page_count) meta.push({ label: 'Pages', value: String(sm.page_count) });
      if (sm.processed_page_count) meta.push({ label: 'Processed', value: String(sm.processed_page_count) });
      break;
    case 'csv':
      if (sm.row_count) meta.push({ label: 'Rows', value: String(sm.row_count) });
      if (sm.column_count != null || (Array.isArray(sm.columns) && sm.columns.length > 0)) meta.push({ label: 'Columns', value: String(sm.column_count ?? (Array.isArray(sm.columns) ? sm.columns.length : 0)) });
      break;
    case 'image':
      if (sm.width && sm.height) meta.push({ label: 'Size', value: `${sm.width}×${sm.height}` });
      if (sm.file_size) meta.push({ label: 'File', value: formatFileSize(sm.file_size as number) });
      break;
    case 'text':
    case 'text_chunk':
      if (sm.character_count) meta.push({ label: 'Characters', value: String(sm.character_count) });
      break;
    case 'article':
    case 'web':
      if (sm.author) meta.push({ label: 'Author', value: String(sm.author) });
      if (sm.publication_date) {
        try {
          meta.push({ label: 'Published', value: format(new Date(sm.publication_date as string), 'PP') });
        } catch {}
      }
      break;
    case 'mbox':
      if (sm.message_count) meta.push({ label: 'Messages', value: String(sm.message_count) });
      break;
  }
  
  return meta;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Sort fragments by mode
 */
function sortFragments(
  fragments: Record<string, any>,
  mode: FragmentSortMode
): [string, any][] {
  const entries = Object.entries(fragments);
  
  if (mode === 'alphabetical') {
    return entries.sort((a, b) => a[0].localeCompare(b[0]));
  }
  
  // Sort by timestamp (newest first)
  return entries.sort((a, b) => {
    const timeA = (a[1] as FragmentData)?.timestamp;
    const timeB = (b[1] as FragmentData)?.timestamp;
    if (!timeA && !timeB) return 0;
    if (!timeA) return 1;
    if (!timeB) return -1;
    return new Date(timeB).getTime() - new Date(timeA).getTime();
  });
}

// ============================================================================
// Component
// ============================================================================

export default function AssetMetaHeader({
  asset,
  className,
  inlineEdit,
  onDelete,
  onDownload,
  onShare,
  onFragmentDelete,
  showActions = true,
  showFragments = true,
  compactMode = false,
}: AssetMetaHeaderProps) {
  const [fragmentSort, setFragmentSort] = useState<FragmentSortMode>('alphabetical');
  const [fragmentsExpanded, setFragmentsExpanded] = useState(true);
  
  // Get fragments and sort them
  const fragments = asset.fragments as Record<string, any> | null;
  const hasFragments = fragments && Object.keys(fragments).length > 0;
  const fragmentCount = hasFragments ? Object.keys(fragments).length : 0;
  
  const sortedFragments = useMemo(() => {
    if (!fragments) return {};
    const sorted = sortFragments(fragments, fragmentSort);
    return Object.fromEntries(sorted);
  }, [fragments, fragmentSort]);
  
  // Get kind-specific metadata
  const kindMeta = useMemo(() => getKindSpecificMeta(asset), [asset]);
  
  // External link
  const externalUrl = asset.source_identifier;
  const hasExternalLink = externalUrl && (externalUrl.startsWith('http://') || externalUrl.startsWith('https://'));
  
  // Copy ID to clipboard
  const handleCopyId = () => {
    navigator.clipboard.writeText(asset.uuid);
    toast.success('Asset UUID copied to clipboard');
  };
  
  return (
    <div className={cn("border-b ", className)}>
      {/* Main Meta: toolbar row; title edit is full-width below so it does not shrink in flex */}
      <div
        className={cn(
          compactMode ? "px-3 py-2" : "px-4 py-3",
          inlineEdit?.active && "flex flex-col gap-2"
        )}
      >
        <div className="flex w-full min-w-0 items-center gap-2 flex-wrap">
        {/* Kind Badge - uses 'selector' context for colorful styling */}
        <Badge 
          variant="outline" 
          className={cn(
            "flex items-center h-6 gap-1.5 shrink-0",
            getAssetBadgeClass(asset.kind, 'selector')
          )}
        >
          {getAssetIcon(asset.kind, "h-3.5 w-3.5", 'selector')}
          {formatAssetKind(asset.kind)}
        </Badge>
        {!inlineEdit?.active && (
          <h1 className="min-w-0 max-w-xl flex-1 basis-0 text-md font-semibold truncate">
            {asset.title || 'Untitled'}
          </h1>
        )}
        {/* Core Metadata */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
          {inlineEdit?.active ? (
            <div className="flex items-center gap-1.5 shrink-0">
              <Clock className="h-3.5 w-3.5 opacity-70" />
              <span className="whitespace-nowrap">Event</span>
              <input
                type="datetime-local"
                value={inlineEdit.draftEventTimestamp}
                onChange={(e) => inlineEdit.onDraftEventTimestampChange(e.target.value)}
                aria-label="Event time"
                className={cn(
                  'h-7 w-auto min-w-0 bg-transparent text-xs text-foreground',
                  'm-0 border-0 p-0 shadow-none outline-none ring-0',
                  'focus:border-0 focus:outline-none focus:ring-0 focus:ring-offset-0',
                  'focus-visible:border-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
                )}
              />
            </div>
          ) : asset.event_timestamp ? (
            <>
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="cursor-default flex items-center gap-1 shrink-0">
                      <Clock className="h-3.5 w-3.5 opacity-70" />
                      Event: {format(new Date(asset.event_timestamp), 'PPp')}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{asset.event_timestamp}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <span className="text-muted-foreground/50">•</span>
            </>
          ) : null}
          {/* ID */}
          <TooltipProvider delayDuration={1500}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button 
                  onClick={handleCopyId}
                  className="flex items-center gap-1 hover:text-foreground transition-colors"
                >
                  <span className="font-mono">ID: {asset.id}</span>
                  <Copy className="h-3 w-3 opacity-50" />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="font-mono text-xs">{asset.uuid}</p>
                <p className="text-xs text-muted-foreground">Click to copy</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          
          <span className="text-muted-foreground/50">•</span>
          
          {/* Created Date */}
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-default">
                  Created: {formatDistanceToNowStrict(new Date(asset.created_at), { addSuffix: true })}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>{format(new Date(asset.created_at), 'PPpp')}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          
          
          {/* Kind-specific metadata */}
          {kindMeta.map((meta, idx) => (
            <React.Fragment key={meta.label}>
              <span className="text-muted-foreground/50">•</span>
              <span>{meta.label}: {meta.value}</span>
            </React.Fragment>
          ))}
        </div>

        {/* Event Timestamp */}
        { asset.event_timestamp && asset.event_timestamp !== '' && (
          <>  
          <span className="text-muted-foreground/50">•</span>
          <span>Event: {format(new Date(asset.event_timestamp), 'PPp')}</span>
          </>
        )}
        { asset.event_timestamp && asset.event_timestamp === '' && (
          <>
          <span className="text-muted-foreground/50">•</span>
          <span>Event: N/A</span>
          </>
        )}
        
        {/* Spacer */}
        <div className="flex-1" />
        
        {/* Actions */}
        {showActions && (
          <div className="flex items-center gap-1">
            {/* External Link */}
            {hasExternalLink && (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => window.open(externalUrl, '_blank')}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Open source</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            
            {/* Inline edit: pencil → save */}
            {inlineEdit && (
              <>
                {inlineEdit.active ? (
                  <>
                    <TooltipProvider delayDuration={200}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={inlineEdit.onSave}
                            disabled={inlineEdit.isSaving}
                            aria-label="Save changes"
                          >
                            {inlineEdit.isSaving ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Save className="h-4 w-4" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Save</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <TooltipProvider delayDuration={200}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={inlineEdit.onCancel}
                            disabled={inlineEdit.isSaving}
                            aria-label="Cancel editing"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Cancel</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </>
                ) : (
                  <TooltipProvider delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={inlineEdit.onStart}
                          aria-label="Edit asset"
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Edit title, event time, and text</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </>
            )}
            
            {/* More Actions Menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {onDownload && (
                  <DropdownMenuItem onClick={onDownload}>
                    <Download className="mr-2 h-4 w-4" />
                    Download
                  </DropdownMenuItem>
                )}
                {onShare && (
                  <DropdownMenuItem onClick={onShare}>
                    <Share2 className="mr-2 h-4 w-4" />
                    Share
                  </DropdownMenuItem>
                )}
                {onDelete && (
                  <>
                    <Separator className="my-1" />
                    <DropdownMenuItem onClick={onDelete} className="text-destructive">
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
        </div>

        {inlineEdit?.active && (
          <input
            type="text"
            value={inlineEdit.draftTitle}
            onChange={(e) => inlineEdit.onDraftTitleChange(e.target.value)}
            aria-label="Title"
            autoFocus
            className={cn(
              'box-border block w-full min-w-0 bg-transparent',
              'text-md font-semibold text-foreground',
              'm-0 border-0 p-0 shadow-none outline-none ring-0',
              'focus:border-0 focus:outline-none focus:ring-0 focus:ring-offset-0',
              'focus-visible:border-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
            )}
          />
        )}
      </div>

      {/* Source Row (if source identifier is a path/url) */}
      {asset.source_identifier && (
        <div className={cn(
          "border-t text-xs text-muted-foreground truncate",
          compactMode ? "px-3 py-1" : "px-4 py-1.5"
        )}>
          <span className="font-medium">Source:</span>{' '}
          {hasExternalLink ? (
            <a 
              href={externalUrl} 
              target="_blank" 
              rel="noopener noreferrer"
              className="hover:text-primary hover:underline"
            >
              {asset.source_identifier}
            </a>
          ) : (
            <span>{asset.source_identifier}</span>
          )}
        </div>
      )}
      
      {/* Fragments Section */}
      {showFragments && hasFragments && (
        <div className={cn(
          "border-t",
          compactMode ? "px-3 py-2" : "px-4 py-2"
        )}>
          {/* Fragment Header with Toggle & Sort */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFragmentsExpanded(!fragmentsExpanded)}
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              {fragmentsExpanded ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
              Analysis Results
              <Badge variant="secondary" className="ml-1 h-4 px-1 text-xs">
                {fragmentCount}
              </Badge>
            </button>
            
            {fragmentsExpanded && (
              <>
                <div className="flex-1" />
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={fragmentSort === 'alphabetical' ? 'secondary' : 'ghost'}
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={() => setFragmentSort('alphabetical')}
                      >
                        <ArrowDownAZ className="h-3 w-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Sort A-Z</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={fragmentSort === 'time' ? 'secondary' : 'ghost'}
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={() => setFragmentSort('time')}
                      >
                        <Clock className="h-3 w-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Sort by time</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </>
            )}
          </div>
          
          {/* Fragment List */}
          {fragmentsExpanded && (
            <div className="mt-2">
              <FragmentAccordion
                fragments={sortedFragments}
                onDelete={onFragmentDelete}
                defaultExpanded={false}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Export helper for use elsewhere
// Re-export from central config for backwards compatibility
export { 
  getAssetBadgeClass, 
  getAssetIcon, 
  getAssetKindConfig, 
  formatAssetKind 
} from '@/components/collection/assets/assetKindConfig';
export { getKindSpecificMeta };

