'use client';

/**
 * FormulaWorkspace — the run's intelligence-layer surface.
 *
 * One closed journey: live Formulas (the questions) above, frozen
 * Observations (the answers) below. Each is a composable inline-droppable
 * primitive (FormulaRow / ObservationCard) — wherever else in the app a
 * formula or observation needs to surface, drop the same component.
 *
 * Replaces the legacy three-column workspace (Configure | Observe |
 * Summarize, ~1200 lines of verb-section forms). The new shape is a
 * paper-style math-line list — see ``docs/intelligence/HOW_TO.md`` § Editor
 * and ``lib/annotations/formulaMath.ts`` for the rendering grammar.
 *
 * Mounted as a fixed overlay (z-50) and closed via the close button. The
 * caller (AnnotationRunner) decides when to open it.
 */

import React, { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Plus, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { DockedChat } from '@/components/collection/chat/DockedChat';
import { useAnnotationRunStore } from '@/zustand_stores/useAnnotationRunStore';
import { suggestPanelType } from '@/lib/annotations/panelEligibility';
import { FormulaRow } from './FormulaRow';
import { ObservationCard, type Observation } from './ObservationCard';
import type { AnnotationSchemaRead } from '@/client';
import type { Formula } from '@/client';

export interface FormulaWorkspaceProps {
  infospaceId: number;
  runId: number;
  schemas: AnnotationSchemaRead[];
  /** Optional — scrolls to this formula on open and focuses it. Null /
   *  undefined opens at the top with the "new formula" prompt focused. */
  formulaId?: string | null;
  onClose: () => void;
}

function newStubFormula(name: string): Omit<Formula, 'id'> {
  return {
    name,
    description: undefined,
    schema_id: null,
    explosion: null,
    filter: { logic: 'and', conditions: [] },
    merge_maps: [],
    group: [],
    weight: null,
    measures: [{ name: 'count', agg: 'count' }],
    derives: [],
    snippet: null,
    output_keys: [],
    order_by: null,
    version: 1,
  };
}

export const FormulaWorkspace: React.FC<FormulaWorkspaceProps> = ({
  infospaceId,
  runId,
  schemas,
  formulaId,
  onClose,
}) => {
  const addFormula = useAnnotationRunStore(s => s.addFormula);
  const updateFormula = useAnnotationRunStore(s => s.updateFormula);
  const removeFormula = useAnnotationRunStore(s => s.removeFormula);
  const addPanel = useAnnotationRunStore(s => s.addPanel);

  const formulas = useAnnotationRunStore(
    useShallow(s => (s.dashboardConfig?.formulas ?? []) as unknown as Formula[]),
  );
  const observations = useAnnotationRunStore(
    useShallow(s => (s.dashboardConfig?.observations ?? []) as unknown as Observation[]),
  );

  const [newPrompt, setNewPrompt] = useState('');
  const [chatMounted, setChatMounted] = useState(true);

  // Per-formula prompt history (in-memory only for v1; persisting prompts
  // alongside formulas is a follow-up).
  const [promptByFormula] = useState<Record<string, string>>({});

  const focusedRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (formulaId && focusedRef.current) {
      focusedRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [formulaId]);

  // ── Actions ─────────────────────────────────────────────────────────────

  function handleCreateBlank() {
    const name = `formula_${formulas.length + 1}`;
    addFormula(newStubFormula(name) as any);
    setNewPrompt('');
  }

  function handleCreateFromPrompt() {
    if (!newPrompt.trim()) {
      handleCreateBlank();
      return;
    }
    // Stub: the prompt → Formula LLM endpoint is owed. For now, create a
    // blank formula with the prompt stashed as the description so the
    // author can manually flesh it out and re-prompt later.
    const created = addFormula({
      ...newStubFormula(`formula_${formulas.length + 1}`),
      description: newPrompt.trim(),
    } as any);
    setNewPrompt('');
    if (!created) return;
    toast.info('Prompt-based generation not yet wired to the backend — stashed your prompt on the formula. Edit the math line directly for now.');
  }

  function handleFormulaUpdate(id: string, next: Formula) {
    // Preserve id; merge new fields onto the saved entry. The store stamps
    // updated_at; the backend ignores the timestamps.
    updateFormula(id, {
      name: next.name,
      description: next.description ?? undefined,
      schema_id: next.schema_id ?? null,
      explosion: next.explosion ?? null,
      filter: next.filter,
      merge_maps: next.merge_maps,
      group: next.group,
      weight: next.weight ?? null,
      measures: next.measures,
      derives: next.derives,
      snippet: next.snippet ?? null,
      output_keys: next.output_keys,
      order_by: next.order_by ?? null,
    } as any);
  }

  async function handleSnapshot(id: string) {
    const f = formulas.find(x => x.id === id);
    if (!f) return;
    try {
      const { RunsService } = await import('@/client');
      const obs = await RunsService.createObservationSnapshot({
        infospaceId,
        runId,
        requestBody: { formula_name: f.name },
      });
      toast.success(`Snapshot saved (${(obs as any)?.output_blob?.length ?? 0} rows).`);
      // Refetch the run so observations[] reflects the new entry. The
      // workspace re-renders on the next store tick.
      const fresh = await RunsService.getRun({ infospaceId, runId });
      const raw = (fresh as any)?.views_config?.[0];
      if (raw) useAnnotationRunStore.getState().setDashboardConfig(raw);
    } catch (e: any) {
      toast.error(`Snapshot failed: ${e?.body?.detail ?? e?.message ?? 'unknown'}`);
    }
  }

  function handlePushToPanel(id: string) {
    const f = formulas.find(x => x.id === id);
    if (!f) return;
    const panelType = suggestPanelType(f);
    addPanel({
      type: panelType,
      name: f.name,
      formula_id: f.id,
      settings: {},
    } as any);
    toast.success(`Created a ${panelType} panel bound to ${f.name}.`);
  }

  function handleDelete(id: string) {
    const f = formulas.find(x => x.id === id);
    if (!f) return;
    if (!confirm(`Delete formula "${f.name}"?`)) return;
    removeFormula(id);
  }

  async function handleObservationDelete(obsId: string) {
    if (!confirm('Delete this observation?')) return;
    try {
      const { RunsService } = await import('@/client');
      await RunsService.deleteObservationSnapshot({
        infospaceId, runId, obsId,
      });
      const fresh = await RunsService.getRun({ infospaceId, runId });
      const raw = (fresh as any)?.views_config?.[0];
      if (raw) useAnnotationRunStore.getState().setDashboardConfig(raw);
    } catch (e: any) {
      toast.error(`Delete failed: ${e?.body?.detail ?? e?.message ?? 'unknown'}`);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-3 py-2 border-b bg-muted/20">
        <span className="text-sm font-semibold">Formulas & Observations</span>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {formulas.length} live · {observations.length} frozen
        </span>
        <div className="flex-1" />
        <Button
          size="sm"
          variant={chatMounted ? 'default' : 'outline'}
          className="h-7 text-xs"
          onClick={() => setChatMounted(o => !o)}
          title={chatMounted ? 'Remove assistant tab' : 'Show assistant tab'}
        >
          Assistant
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onClose}>
          <X className="h-3 w-3 mr-1" /> Close
        </Button>
      </div>

      {/* Body */}
      <ScrollArea className="flex-1">
        <div className="max-w-4xl mx-auto px-6 py-4 space-y-6">

          {/* New formula prompt */}
          <section className="space-y-2">
            <h2 className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
              New formula
            </h2>
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-muted-foreground shrink-0" />
              <Input
                value={newPrompt}
                onChange={(e) => setNewPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleCreateFromPrompt();
                  }
                }}
                placeholder="Describe what to compute, or hit blank to start with an empty math line…"
                className="h-8 text-sm font-mono"
              />
              <Button
                size="sm"
                variant="default"
                className="h-8 text-xs"
                onClick={handleCreateFromPrompt}
                disabled={!newPrompt.trim() && false /* blank create also OK */}
              >
                {newPrompt.trim() ? 'Generate' : 'Blank'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={handleCreateBlank}
                title="Skip the prompt — create an empty formula"
              >
                <Plus className="h-3 w-3 mr-1" /> blank
              </Button>
            </div>
          </section>

          <Separator />

          {/* Formulas list */}
          <section className="space-y-2">
            <h2 className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
              Formulas <span className="text-foreground">({formulas.length})</span>
            </h2>
            {formulas.length === 0 ? (
              <div className="text-xs text-muted-foreground italic px-3 py-6 border border-dashed rounded">
                No formulas yet. Describe one above, or hit ‘blank’ to start
                with a math line you'll edit by hand.
              </div>
            ) : (
              <div className="space-y-2">
                {formulas.map(f => (
                  <div
                    key={f.id}
                    ref={formulaId === f.id ? focusedRef : undefined}
                  >
                    <FormulaRow
                      formula={f}
                      infospaceId={infospaceId}
                      runId={runId}
                      prompt={promptByFormula[f.id] ?? f.description ?? null}
                      onUpdate={(next) => handleFormulaUpdate(f.id, next)}
                      onSnapshot={() => handleSnapshot(f.id)}
                      onPushToPanel={() => handlePushToPanel(f.id)}
                      onDelete={() => handleDelete(f.id)}
                      onRegenerate={(_prompt) => {
                        toast.info('Prompt-based regeneration not yet wired — edit the math line directly for now.');
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Observations list — only show the section header when there
              are observations, so the workspace stays quiet pre-snapshot. */}
          {observations.length > 0 && (
            <>
              <Separator />
              <section className="space-y-2">
                <h2 className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                  Observations <span className="text-foreground">({observations.length})</span>
                </h2>
                <div className="space-y-2">
                  {observations.map(obs => (
                    <ObservationCard
                      key={obs.id}
                      observation={obs}
                      onDelete={() => handleObservationDelete(obs.id)}
                      // view rows / cite / push to panel — TODO follow-up
                    />
                  ))}
                </div>
              </section>
            </>
          )}

          <div className="h-32" /> {/* bottom breathing room above the docked chat */}
        </div>
      </ScrollArea>

      {/* FormulaAgent — bottom-right docked tab. Tear it down via the
          Assistant button in the top bar; collapse via the tab's own
          chevron. */}
      {chatMounted && (
        <DockedChat
          agent="formula"
          runId={runId}
          formulaId={formulaId ?? undefined}
          title="Formula assistant"
          accent="text-blue-600 dark:text-blue-400"
          defaultOpen
          onDismiss={() => setChatMounted(false)}
          onAgentMutation={async () => {
            try {
              const { RunsService } = await import('@/client');
              const fresh = await RunsService.getRun({ infospaceId, runId });
              const raw = (fresh as any)?.views_config?.[0];
              if (raw) useAnnotationRunStore.getState().setDashboardConfig(raw);
            } catch { /* silent */ }
          }}
        />
      )}
    </div>
  );
};
