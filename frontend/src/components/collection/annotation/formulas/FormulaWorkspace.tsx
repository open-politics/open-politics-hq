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
  // Merge maps are no longer carried on Formula (run/panel/scope merge
  // maps tunnel through FormulaQuery at execution time). The stub is a
  // pure data spec.
  return {
    name,
    description: undefined,
    schema_id: null,
    explosion: null,
    filter: { logic: 'and', conditions: [] },
    group: [],
    weight: null,
    measures: [{ name: 'count', agg: 'count' }],
    derives: [],
    snippet: null,
    output_keys: [],
    order_by: null,
    version: 1,
  } as Omit<Formula, 'id'>;
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
  const [generating, setGenerating] = useState(false);
  const [chatMounted, setChatMounted] = useState(true);
  // Per-formula regeneration state — disables the row's regenerate button
  // while the LLM call is in flight.
  const [regenerating, setRegenerating] = useState<Record<string, boolean>>({});

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

  async function handleCreateFromPrompt() {
    if (!newPrompt.trim()) {
      handleCreateBlank();
      return;
    }
    setGenerating(true);
    try {
      const { RunsService } = await import('@/client');
      const generated = await RunsService.generateFormulaFromPrompt({
        infospaceId,
        runId,
        requestBody: { prompt: newPrompt.trim() },
      });
      addFormula({
        ...generated,
        description: generated.description ?? newPrompt.trim(),
      } as any);
      setNewPrompt('');
      toast.success(`Generated formula ${generated.name ?? ''}`);
    } catch (e: any) {
      const detail = e?.body?.detail ?? e?.message ?? 'unknown';
      toast.error(`Generation failed: ${detail}`);
    } finally {
      setGenerating(false);
    }
  }

  function handleFormulaUpdate(id: string, next: Formula) {
    // Preserve id; merge new fields onto the saved entry. Merge maps
    // are not on Formula any more — they belong to Run/Panel/Scope and
    // are folded by FormulaQuery at execution time.
    updateFormula(id, {
      name: next.name,
      description: next.description ?? undefined,
      schema_id: next.schema_id ?? null,
      explosion: next.explosion ?? null,
      filter: next.filter,
      group: next.group,
      weight: next.weight ?? null,
      measures: next.measures,
      derives: next.derives,
      snippet: next.snippet ?? null,
      output_keys: next.output_keys,
      order_by: next.order_by ?? null,
    } as any);
  }

  async function handleSnapshot(_id: string) {
    // Observation snapshots are deferred to v1.5 — the primitive exists
    // on the backend but the citation/dossier UX isn't built. Calling
    // the route would create a snapshot that can't be displayed, cited,
    // or rendered. Surface a clear message instead of silently failing.
    toast.info('Snapshots return in v1.5 — pair with citation/dossier work.');
  }

  function handlePushToPanel(id: string) {
    const f = formulas.find(x => x.id === id);
    if (!f) return;
    const panelType = suggestPanelType(f);
    // ``formula_ref`` binds the new panel to this saved formula. Future
    // edits in the Workspace propagate to every panel binding it.
    addPanel({
      type: panelType,
      name: f.name,
      formula_ref: f.id,
      settings: {},
    });
    toast.success(`Created a ${panelType} panel bound to ${f.name}.`);
  }

  // Pull-from-panel: copy a panel's compiled Formula into the Workspace as
  // a new draft. One-way (no live link). The draft is then editable as any
  // other saved formula. Picker UI surfaced in the right column.
  const panels = useAnnotationRunStore(
    useShallow(s => (s.dashboardConfig?.panels ?? []) as any[]),
  );

  function handlePullFromPanel(panelId: string) {
    const panel = panels.find(p => p.id === panelId);
    if (!panel?.formula) return;
    // Clone the panel's Formula, give it a fresh name. Strip the id so the
    // store stamps a new one.
    const { id: _drop, ...body } = panel.formula as Formula;
    addFormula({
      ...body,
      name: `from_${panel.name}`,
      description: `Pulled from panel "${panel.name}"`,
    } as any);
    toast.success(`Pulled "${panel.name}"'s formula into the workspace.`);
  }

  function handleDelete(id: string) {
    const f = formulas.find(x => x.id === id);
    if (!f) return;
    if (!confirm(`Delete formula "${f.name}"?`)) return;
    removeFormula(id);
  }

  async function handleRegenerate(id: string, prompt: string) {
    if (!prompt.trim()) {
      toast.error('Type a prompt before regenerating.');
      return;
    }
    setRegenerating(s => ({ ...s, [id]: true }));
    try {
      const { RunsService } = await import('@/client');
      const generated = await RunsService.generateFormulaFromPrompt({
        infospaceId,
        runId,
        requestBody: { prompt: prompt.trim() },
      });
      // Keep the original id (and the user's name unless the LLM proposed a
      // new one) — this is an in-place replacement, not a new formula.
      updateFormula(id, {
        name: generated.name,
        description: generated.description ?? prompt.trim(),
        schema_id: generated.schema_id ?? null,
        explosion: generated.explosion ?? null,
        filter: generated.filter,
        group: generated.group,
        weight: generated.weight ?? null,
        measures: generated.measures,
        derives: generated.derives,
        snippet: generated.snippet ?? null,
        output_keys: generated.output_keys,
        order_by: generated.order_by ?? null,
      } as any);
      toast.success(`Regenerated ${generated.name}.`);
    } catch (e: any) {
      const detail = e?.body?.detail ?? e?.message ?? 'unknown';
      toast.error(`Regeneration failed: ${detail}`);
    } finally {
      setRegenerating(s => {
        const next = { ...s };
        delete next[id];
        return next;
      });
    }
  }

  // Observation cite / push-to-panel / delete handlers all deferred to
  // v1.5 alongside the snapshot/dossier primitive. The ObservationCard
  // import + observations selector remain so the build doesn't churn
  // when the feature returns.

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
                disabled={generating}
              >
                {generating ? '…' : newPrompt.trim() ? 'Generate' : 'Blank'}
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

          {/* Pull from panel — copy a panel's compiled Formula in as a
              draft. One-way; the new formula is editable as any other. */}
          {panels.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                Pull from panel
              </h2>
              <div className="flex flex-wrap gap-1.5">
                {panels.map((p: any) => {
                  const hasFormula =
                    !!p.formula && (
                      (p.formula.group?.length ?? 0) > 0 ||
                      (p.formula.measures?.length ?? 0) > 0 ||
                      (p.formula.filter?.conditions?.length ?? 0) > 0
                    );
                  if (!hasFormula) return null;
                  return (
                    <Button
                      key={p.id}
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-[11px] font-mono"
                      onClick={() => handlePullFromPanel(p.id)}
                      title={`Pull ${p.name}'s formula into the workspace`}
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      {p.name}
                      <span className="ml-1 text-muted-foreground">[{p.type}]</span>
                    </Button>
                  );
                })}
              </div>
              {panels.every((p: any) => {
                const f = p.formula;
                return !f || (!f.group?.length && !f.measures?.length && !f.filter?.conditions?.length);
              }) && (
                <div className="text-[11px] text-muted-foreground italic">
                  No panels with configured formulas yet — pull is available
                  once a panel has roles or filters set.
                </div>
              )}
            </section>
          )}

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
                      schemas={schemas}
                      prompt={promptByFormula[f.id] ?? f.description ?? null}
                      onUpdate={(next) => handleFormulaUpdate(f.id, next)}
                      onSnapshot={() => handleSnapshot(f.id)}
                      onPushToPanel={() => handlePushToPanel(f.id)}
                      onDelete={() => handleDelete(f.id)}
                      onRegenerate={(prompt) => handleRegenerate(f.id, prompt)}
                      regenerating={!!regenerating[f.id]}
                    />
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Observation snapshot UI deferred to v1.5. The snapshot
              primitive (frozen Formula output, cite-stable) returns when
              citation/dossier work is funded. For now, the Workspace
              authors live SavedFormulas; panels bind via formula_ref;
              edits propagate. See docs/INTELLIGENCE.md § roadmap. */}

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
