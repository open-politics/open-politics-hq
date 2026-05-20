'use client';

/**
 * DockedChat — Facebook-style bottom-right chat tab.
 *
 * Collapses to a thin titled bar pinned to the bottom-right corner;
 * expands to a floating panel of fixed dimensions on click. Hosts the
 * existing ``IntelligenceChat`` component, parameterised by ``agent``
 * so the same surface backs both the DossierAgent (run-level) and the
 * FormulaAgent (workspace-level).
 *
 * Persistence: open/closed state survives reload via localStorage,
 * keyed by ``(agent, runId)``.
 *
 * Multiple instances can mount side-by-side; pass ``offset.right`` to
 * stagger them horizontally — e.g. the workspace can show both Dossier
 * and Formula tabs without them stacking on top of each other.
 */

import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, MessageSquare, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { IntelligenceChat } from './Chat';

export interface DockedChatProps {
  /** Agent persona — scopes prompt, tools, and history. Also determines the
   *  horizontal slot so two docked tabs never overlap (see AGENT_SLOT below). */
  agent: 'dossier' | 'formula';
  /** Annotation run id the agent operates on (required for both surfaces). */
  runId?: number;
  /** Title text in the tab bar. */
  title: string;
  /** Tailwind class for the title-bar icon tint. */
  accent?: string;
  /** Optional dismiss handler. When provided, an X appears and tearing it down
   *  removes the parent's mount entirely. */
  onDismiss?: () => void;
  /** Initial open state. Overridden by persisted localStorage value if present. */
  defaultOpen?: boolean;
  /** Pixel width when expanded. Default 440. */
  expandedWidth?: number;
  /** Pixel height when expanded. Default 600. */
  expandedHeight?: number;
  /** FormulaAgent context — the currently-edited formula. Surfaces in prompt. */
  formulaId?: string | null;
  /** Live-update hook — fires after the agent calls a mutation tool. The
   *  parent refetches the run so the editor / dashboard reflect agent changes
   *  without manual reload. */
  onAgentMutation?: () => void;
}

/** Per-agent horizontal slot. Deterministic so tabs never stack. ``formula``
 *  sits closest to the right edge; ``dossier`` is one collapsed-width to its
 *  left. If a third agent ever joins, give it slot 2. */
const AGENT_SLOT: Record<DockedChatProps['agent'], number> = {
  formula: 0,
  dossier: 1,
};

/** Geometry constants for the dock row.
 *  - ``BASE_RIGHT`` clears the ``AnnotationRunnerDock`` minimised button which
 *    sits at ``bottom-4 right-4 w-12 h-12`` (16 + 48 + 16 = 80 of right gutter).
 *  - ``BASE_BOTTOM`` lifts the dock above ``bottom-4`` runner controls so they
 *    don't sit underneath the chat tab. */
const BASE_RIGHT = 80;
const BASE_BOTTOM = 12;
const COLLAPSED_WIDTH = 300;
const SLOT_GAP = 8;
const COLLAPSED_HEIGHT = 32;

const storageKey = (agent: string, runId?: number) =>
  `hq:dockedChat:${agent}:${runId ?? 'global'}`;

export const DockedChat: React.FC<DockedChatProps> = ({
  agent,
  runId,
  title,
  accent = 'text-blue-600 dark:text-blue-400',
  onDismiss,
  defaultOpen = false,
  expandedWidth = 440,
  expandedHeight = 600,
  formulaId,
  onAgentMutation,
}) => {
  const [open, setOpen] = useState<boolean>(defaultOpen);

  // Restore persisted open/closed on mount per (agent, runId).
  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey(agent, runId));
      if (stored !== null) setOpen(stored === '1');
    } catch {
      // localStorage unavailable — keep defaultOpen.
    }
  }, [agent, runId]);

  const setOpenPersist = (v: boolean) => {
    setOpen(v);
    try {
      localStorage.setItem(storageKey(agent, runId), v ? '1' : '0');
    } catch {
      // ignore — UI works without persistence.
    }
  };

  // Deterministic horizontal slot — formula closest to right edge, dossier
  // one collapsed-width to its left. Each tab's right offset is computed
  // off the slot so they sit in a row regardless of mount order.
  const slot = AGENT_SLOT[agent];
  const right = BASE_RIGHT + slot * (COLLAPSED_WIDTH + SLOT_GAP);

  return (
    <div
      className={cn(
        'fixed z-50 flex flex-col border bg-background shadow-xl rounded-t-md overflow-hidden',
        'transition-[width,height] duration-150 ease-out',
      )}
      style={{
        bottom: BASE_BOTTOM,
        right,
        width: open ? expandedWidth : COLLAPSED_WIDTH,
        height: open ? expandedHeight : COLLAPSED_HEIGHT,
        maxWidth: '95vw',
        maxHeight: '90vh',
      }}
    >
      <button
        type="button"
        className="flex items-center gap-2 px-2.5 h-8 shrink-0 border-b bg-muted/50 hover:bg-muted text-xs font-medium cursor-pointer text-left"
        onClick={() => setOpenPersist(!open)}
        aria-expanded={open}
      >
        <MessageSquare className={cn('h-3.5 w-3.5', accent)} />
        <span className="flex-1 truncate">{title}</span>
        {runId !== undefined && (
          <span className="text-[10px] text-muted-foreground tabular-nums">
            · run {runId}
          </span>
        )}
        {open ? (
          <ChevronDown className="h-3 w-3 opacity-60" />
        ) : (
          <ChevronUp className="h-3 w-3 opacity-60" />
        )}
        {onDismiss && (
          <span
            role="button"
            tabIndex={0}
            className="ml-0.5 hover:text-destructive p-0.5 rounded"
            onClick={(e) => {
              e.stopPropagation();
              onDismiss();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation();
                onDismiss();
              }
            }}
            aria-label="Close"
          >
            <X className="h-3 w-3" />
          </span>
        )}
      </button>
      {open && (
        <div className="flex-1 min-h-0">
          <IntelligenceChat
            agent={agent}
            runId={runId}
            formulaId={formulaId}
            onAgentMutation={onAgentMutation}
            embedded
            className="h-full"
          />
        </div>
      )}
    </div>
  );
};
