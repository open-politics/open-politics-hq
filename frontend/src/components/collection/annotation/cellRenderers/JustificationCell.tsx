'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { HelpCircle } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

/* Per-row justification on `array<object>` items lands as a typed object
 * `{reasoning, text_spans: [...]}` (canonical shape per §4.9 of
 * graph_canon_relationships). The ObjectCell fallback rendered it as `{2}`
 * which carried no signal. This cell renders a small inspectable `?` button
 * that previews the reasoning + first text snippet on hover, and surfaces the
 * full justification side-panel on click via the row's onSelect handler. */

export interface JustificationValue {
  reasoning?: string | null;
  text_spans?: Array<{ text_snippet?: string; text?: string } | string> | null;
}

/** Structural detection — any object with both `reasoning` and `text_spans`
 *  keys is a justification block, regardless of where it lives. */
export const isJustificationShape = (value: unknown): value is JustificationValue => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return ('reasoning' in v) && ('text_spans' in v);
};

const firstSnippet = (spans: JustificationValue['text_spans']): string | null => {
  if (!Array.isArray(spans) || spans.length === 0) return null;
  const first = spans[0];
  if (typeof first === 'string') return first;
  if (first && typeof first === 'object') {
    return (first as any).text_snippet ?? (first as any).text ?? null;
  }
  return null;
};

interface JustificationCellProps {
  value: JustificationValue;
  /** Click → expand to full justification (typically opens the row detail
   *  overlay where AnnotationResultDisplay renders the justification panel). */
  onSelect?: () => void;
}

export const JustificationCell: React.FC<JustificationCellProps> = ({ value, onSelect }) => {
  const reasoning = typeof value?.reasoning === 'string' ? value.reasoning : '';
  const snippet = firstSnippet(value?.text_spans);
  const spanCount = Array.isArray(value?.text_spans) ? value.text_spans.length : 0;

  if (!reasoning && !snippet) {
    return <span className="text-muted-foreground/50 text-xs" title="No justification">×</span>;
  }

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              'inline-flex items-center justify-center rounded-full',
              'h-5 w-5 text-muted-foreground hover:text-foreground hover:bg-muted/60',
              'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
            onClick={(e) => {
              e.stopPropagation();
              onSelect?.();
            }}
            aria-label="Open justification"
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          align="start"
          className="max-w-sm space-y-2 px-3 py-2 text-xs"
        >
          {reasoning && (
            <p className="text-foreground leading-snug">{reasoning}</p>
          )}
          {snippet && (
            <blockquote className="border-l-2 pl-2 italic text-muted-foreground">
              "{snippet.length > 200 ? snippet.slice(0, 200) + '…' : snippet}"
              {spanCount > 1 && (
                <span className="ml-1 not-italic text-muted-foreground/70">
                  +{spanCount - 1}
                </span>
              )}
            </blockquote>
          )}
          {onSelect && (
            <p className="text-muted-foreground/70 text-[10px]">Click for full evidence</p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default JustificationCell;
