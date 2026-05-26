'use client';

/**
 * FormulaRow — a single live Formula on the workspace list.
 *
 * Composition of:
 *   - PromptHistory (collapsed by default; expands to show the LLM prompt
 *     that generated the formula, with a regenerate field).
 *   - FormulaMathLine (the renderer; click-token popovers; toggle to
 *     text-edit mode).
 *   - PreviewSlot (collapsible — renders an inline FormulaPreview when open).
 *   - Row actions (preview toggle, snapshot, push to panel, delete).
 *
 * Each piece is small enough to compose elsewhere (the math line itself
 * is droppable in ObservationCards, chat messages, panel headers). Use
 * this component when you want the full live-row affordances together.
 */

import React, { useState } from 'react';
import {
  Camera,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Sparkles,
  Trash2,
  Send,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { FormulaMathLine } from './FormulaMathLine';
import { FormulaPreview } from './FormulaPreview';
import type { AnnotationSchemaRead, Formula } from '@/client';

export interface FormulaRowProps {
  formula: Formula;
  infospaceId: number;
  runId: number;
  /** Schemas on this run — threaded into FormulaMathLine for the field /
   *  dimension popovers. */
  schemas?: AnnotationSchemaRead[];
  /** Called when the formula's body changes (math-line edit or popover). */
  onUpdate: (formula: Formula) => void;
  /** Called when the user clicks the snapshot button. */
  onSnapshot?: () => void;
  /** Called when the user pushes the formula to a new panel. */
  onPushToPanel?: () => void;
  /** Called when the user deletes the formula. */
  onDelete: () => void;
  /** Stored LLM prompt that generated this formula, if any. */
  prompt?: string | null;
  /** Called when the user clicks regenerate with a new (or edited) prompt. */
  onRegenerate?: (prompt: string) => void;
  /** Disable the regenerate button while a call is in flight. */
  regenerating?: boolean;
  className?: string;
}

export function FormulaRow({
  formula,
  infospaceId,
  runId,
  schemas,
  onUpdate,
  onSnapshot,
  onPushToPanel,
  onDelete,
  prompt,
  onRegenerate,
  regenerating,
  className,
}: FormulaRowProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  // Auto-expand the prompt row when a regeneration is in flight so users
  // see what's happening; otherwise stays collapsed by default.
  const [promptOpen, setPromptOpen] = useState(false);
  React.useEffect(() => {
    if (regenerating) setPromptOpen(true);
  }, [regenerating]);
  const [promptDraft, setPromptDraft] = useState(prompt ?? '');

  return (
    <div
      className={cn(
        'group rounded border border-border bg-card',
        'px-3 py-2 space-y-1.5',
        'hover:border-foreground/30 transition-colors',
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <FormulaMathLine
            formula={formula}
            editable
            schemas={schemas}
            onUpdate={onUpdate}
          />
        </div>

        {/* Row actions — only show on hover to keep the list visually quiet. */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="ghost" size="sm"
            className="h-6 w-6 p-0"
            onClick={() => setPreviewOpen(o => !o)}
            title={previewOpen ? 'Hide preview' : 'Show preview'}
          >
            {previewOpen ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </Button>
          {onSnapshot && (
            <Button
              variant="ghost" size="sm"
              className="h-6 w-6 p-0"
              onClick={onSnapshot}
              title="Snapshot — freeze as an Observation"
            >
              <Camera className="h-3.5 w-3.5" />
            </Button>
          )}
          {onPushToPanel && (
            <Button
              variant="ghost" size="sm"
              className="h-6 w-6 p-0"
              onClick={onPushToPanel}
              title="Push to panel"
            >
              <Send className="h-3.5 w-3.5" />
            </Button>
          )}
          {onRegenerate && (
            <Button
              variant="ghost" size="sm"
              className="h-6 w-6 p-0"
              onClick={() => setPromptOpen(o => !o)}
              title="Prompt history"
            >
              {promptOpen
                ? <ChevronDown className="h-3.5 w-3.5" />
                : <ChevronRight className="h-3.5 w-3.5" />
              }
            </Button>
          )}
          <Button
            variant="ghost" size="sm"
            className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
            onClick={onDelete}
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Prompt history (collapsed by default). Shows the original prompt;
          edit + regenerate replaces the formula body via onRegenerate. */}
      {promptOpen && onRegenerate && (
        <div className="flex items-center gap-2 pt-1 border-t border-border/50">
          <Sparkles className="h-3 w-3 text-muted-foreground shrink-0" />
          <Input
            value={promptDraft}
            onChange={(e) => setPromptDraft(e.target.value)}
            placeholder="Describe what to compute…"
            className="h-7 text-xs font-mono"
          />
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={!promptDraft.trim() || !!regenerating}
            onClick={() => onRegenerate(promptDraft.trim())}
          >
            {regenerating ? '…' : 'regenerate'}
          </Button>
        </div>
      )}

      {/* Inline preview — opens below the math line, never replaces it. */}
      {previewOpen && (
        <div className="pt-1 border-t border-border/50">
          <FormulaPreview
            formula={formula}
            infospaceId={infospaceId}
            runId={runId}
          />
        </div>
      )}
    </div>
  );
}
