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
  Edit2,
  Save,
  X,
  Loader2,
  ArrowDownAZ,
  Clock,
  ChevronDown,
  ChevronUp,
  ScanEye,
  Star,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNowStrict, format } from 'date-fns';
import { toast } from 'sonner';
import { DockBack, DockClose } from '@/components/collection/intake/DockNav';
import { FragmentAccordion } from './Fragments';
import { FragmentData } from './Fragments/types';
import {
  getAssetIcon,
  getAssetBadgeClass,
  getAssetKindConfig,
  formatAssetKind
} from '@/components/collection/assets/assetKindConfig';
import { DetailBreadcrumb, type BundleCrumb } from './DetailBreadcrumb';

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
  /** Breadcrumb path (ancestor bundles, root→parent) + segment click handler. */
  breadcrumbSegments?: BundleCrumb[];
  onBreadcrumbClick?: (bundleId: number) => void;

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
  onRequestEnrichment?: (enricherName: string) => void;
  onFragmentDelete?: (key: string) => void;
  
  // Favorite
  isFavorited?: boolean;
  onToggleFavorite?: () => void;

  // Configuration
  showActions?: boolean;
  showFragments?: boolean;
  compactMode?: boolean;

  /** Dock navigation — rendered inline in this header (back ← left, close × right). */
  onBack?: () => void;
  onClose?: () => void;
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
  breadcrumbSegments,
  onBreadcrumbClick,
  inlineEdit,
  onDelete,
  onDownload,
  onShare,
  onRequestEnrichment,
  onFragmentDelete,
  isFavorited,
  onToggleFavorite,
  showActions = true,
  showFragments = true,
  compactMode = false,
  onBack,
  onClose,
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
  
  return (
    <div className={cn("border-b ", className)}>
      {/* Main Meta: toolbar row; title edit is full-width below so it does not shrink in flex */}
      <div className={cn(compactMode ? "px-3 py-1.5" : "px-3 py-1.5", "flex flex-col gap-1")}>
        {/* Row 1 — breadcrumb path + close */}
        <div className="flex w-full min-w-0 items-center gap-2">
          {onBack && <DockBack onClick={onBack} />}
          <DetailBreadcrumb
            className="min-w-0 flex-1"
            segments={breadcrumbSegments ?? []}
            onSegmentClick={onBreadcrumbClick}
            leafIcon={getAssetIcon(asset.kind, "size-4 shrink-0", 'selector')}
            leafLabel={asset.title || 'Untitled'}
            leafInput={inlineEdit?.active ? (
              <input
                type="text"
                value={inlineEdit.draftTitle}
                onChange={(e) => inlineEdit.onDraftTitleChange(e.target.value)}
                aria-label="Title"
                autoFocus
                className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm font-semibold text-foreground shadow-none outline-none ring-0 focus:outline-none focus-visible:outline-none"
              />
            ) : undefined}
          />
          {onClose && <DockClose onClick={onClose} />}
        </div>

        {/* Row 2 — condensed info | actions */}
        <div className="flex w-full min-w-0 items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-xs text-muted-foreground">
            {inlineEdit?.active ? (
              <span className="flex shrink-0 items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 opacity-70" />
                <span>Event</span>
                <input
                  type="datetime-local"
                  value={inlineEdit.draftEventTimestamp}
                  onChange={(e) => inlineEdit.onDraftEventTimestampChange(e.target.value)}
                  aria-label="Event time"
                  className="h-6 w-auto min-w-0 border-0 bg-transparent p-0 text-xs text-foreground shadow-none outline-none ring-0 focus:outline-none focus-visible:outline-none"
                />
              </span>
            ) : asset.event_timestamp ? (
              <>
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="flex shrink-0 cursor-default items-center gap-1">
                        <Clock className="h-3 w-3 opacity-60" />
                        {format(new Date(asset.event_timestamp), 'PP')}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent><p>Event: {format(new Date(asset.event_timestamp), 'PPp')}</p></TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <span className="text-muted-foreground/40">·</span>
              </>
            ) : null}
            <span className="shrink-0">Created {formatDistanceToNowStrict(new Date(asset.created_at), { addSuffix: true })}</span>
            {kindMeta.map((meta) => (
              <React.Fragment key={meta.label}>
                <span className="text-muted-foreground/40">·</span>
                <span className="shrink-0">{meta.label}: {meta.value}</span>
              </React.Fragment>
            ))}
          </div>

          {showActions && (
            <div className="flex shrink-0 items-center gap-0.5">
            {/* Favorite toggle */}
            {onToggleFavorite !== undefined && (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={onToggleFavorite}
                    >
                      <Star className={cn(
                        "h-4 w-4",
                        isFavorited
                          ? "fill-yellow-400 text-yellow-500"
                          : "text-muted-foreground hover:text-yellow-500"
                      )} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{isFavorited ? 'Remove from favorites' : 'Add to favorites'}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
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
                {onRequestEnrichment && (
                  <DropdownMenuItem onClick={() => onRequestEnrichment('ocr')}>
                    <ScanEye className="mr-2 h-4 w-4" />
                    {asset.enrichment_resolved?.includes('ocr') ? 'Re-run OCR' : 'Run OCR'}
                  </DropdownMenuItem>
                )}
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

