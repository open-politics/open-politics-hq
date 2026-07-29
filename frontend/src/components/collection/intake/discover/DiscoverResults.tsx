'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, ExternalLink, Eye, Download, Repeat } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SearchResultData } from '../shared/ResultViewer';

interface DiscoverResultsProps {
  results: SearchResultData[];
  selected: Set<number>;
  onToggle: (i: number) => void;
  onSelectAll: () => void;
  /** Open the bundle-aware ingestor modal for the current selection. */
  onIngest: () => void;
  /** Read a single result in the viewer. */
  onView?: (result: SearchResultData) => void;
  /** Promote the current query into a recurrent source. Hidden when unavailable. */
  onPromote?: () => void;
  /** Compact rows (popover/inline) hide the snippet. */
  dense?: boolean;
  className?: string;
}

function hostOf(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

/**
 * Pure presentational result list — shared by DiscoverPanel (toolbar) and, if
 * wanted, the chat's inline renderer. Ingestion + viewing are delegated to the
 * shared ResultIngestor / ResultViewer the parent mounts.
 */
export function DiscoverResults({
  results, selected, onToggle, onSelectAll, onIngest, onView, onPromote, dense, className,
}: DiscoverResultsProps) {
  if (results.length === 0) return null;

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="flex items-center justify-between gap-2 px-1 pb-2">
        <button onClick={onSelectAll} className="text-xs text-muted-foreground hover:text-foreground">
          {selected.size === results.length ? 'Deselect all' : 'Select all'} · {results.length}
        </button>
        <div className="flex items-center gap-1">
          {onPromote && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onPromote} title="Make recurrent source">
              <Repeat className="mr-1 size-3.5" /> Make Source
            </Button>
          )}
          <Button size="sm" className="h-7 px-2 text-xs" onClick={onIngest} disabled={selected.size === 0}>
            <Download className="mr-1 size-3.5" /> Ingest ({selected.size})
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-0.5">
        {results.map((r, i) => {
          const isSel = selected.has(i);
          const favicon = r.source_metadata?.favicon;
          return (
            <div
              key={i}
              className={cn(
                'flex items-start gap-2 rounded-md border p-2 transition-colors',
                isSel ? 'border-primary/50 bg-primary/5' : 'hover:bg-muted/50',
              )}
            >
              <button onClick={() => onToggle(i)} className="mt-0.5 shrink-0" aria-label="Select result">
                {isSel
                  ? <CheckCircle className="size-4 text-primary" />
                  : <span className="block size-4 rounded-full border-2 border-muted-foreground/30" />}
              </button>
              <button onClick={() => onToggle(i)} className="min-w-0 flex-1 text-left">
                <span className="flex items-center gap-1.5">
                  <span className="line-clamp-1 text-sm font-medium">{r.title || 'Untitled'}</span>
                  {typeof r.score === 'number' && (
                    <Badge variant="outline" className="shrink-0 text-[10px]">{Math.round(r.score * 100)}%</Badge>
                  )}
                </span>
                {!dense && r.content && <span className="line-clamp-2 text-xs text-muted-foreground">{r.content}</span>}
                <span className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                  {favicon && (
                    <img src={favicon} alt="" className="size-3" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  )}
                  {hostOf(r.url)}
                </span>
              </button>
              <div className="flex shrink-0 items-center gap-0.5">
                {onView && (
                  <Button variant="ghost" size="icon" className="size-6 text-muted-foreground" title="View" onClick={() => onView(r)}>
                    <Eye className="size-3.5" />
                  </Button>
                )}
                <Button variant="ghost" size="icon" className="size-6 text-muted-foreground" title="Open" onClick={() => window.open(r.url, '_blank')}>
                  <ExternalLink className="size-3.5" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
