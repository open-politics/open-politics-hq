'use client';

import React, { useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  HudButton,
  HudOption,
  HudOverline,
  HudReadout,
  HUD_INPUT,
  HUD_LABEL,
  HUD_NUM,
  HUD_PROSE,
} from '@/components/ui/chrome';
import {
  Save,
  Settings2,
  Plus,
  Download,
  Upload,
  Share2,
  Grid3X3,
  Layers,
  Shuffle,
  Microscope,
  RefreshCw,
  Trash2,
  Maximize2,
  Radio,
  ChevronDown,
  ChevronLeft,
  Library,
  Loader2,
  Pin,
  PinOff,
  ArrowRightToLine,
  MoreHorizontal,
  Cpu,
  Split,
  LayoutPanelLeft,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { AnnotationRunRead, AnnotationSchemaRead, type RunLedgerSummary } from '@/client';
import { useRunResults } from '@/lib/annotations/ledger';
import { since } from '@/lib/since';
import { DashboardConfig, PanelViewConfig, useAnnotationRunStore } from '@/zustand_stores/useAnnotationRunStore';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { FormattedAnnotation } from '@/lib/annotations/types';
import { stripOrder } from '@/lib/annotations/strip';
import ShareAnnotationRunDialog from './ShareAnnotationRunDialog';
import { VariableSplittingControls } from './VariableSplittingControls';
import { useCanons } from '@/hooks/useCanons';
import { useScrollEdges } from '@/hooks/useScrollEdges';
import { PANEL_TYPES } from './panels/PanelTypePicker';

const panelTypes = PANEL_TYPES;

const panelIcon = (type: string): LucideIcon =>
  panelTypes.find((p) => p.type === type)?.icon ?? LayoutPanelLeft;

// ─── Time ────────────────────────────────────────────────────────────────────

/** The current time, re-read every `ms` while `active`. Only the readouts
 *  that show a running clock ask for it, so nothing else re-renders. */
function useNow(ms: number, active = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms, active]);
  return now;
}

/** A span of time as an instrument reads it: `42s`, `4m 12s`, `1h 03m`. */
function formatSpan(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** A model as people name it: the file, not the path, and no extension. */
const modelName = (m: string) => m.split('/').pop()!.replace(/\.(gguf|bin|safetensors)$/i, '');

const fmt = (n: number) => n.toLocaleString();

// ─── State ───────────────────────────────────────────────────────────────────

/**
 * What a run is doing, as one of a few phases — the column is arranged around
 * this, so it is derived once. A *live* run that has caught up is not "done":
 * it is watching its scope, and reads differently from a finished one-off.
 */
type Phase = 'queued' | 'running' | 'waiting' | 'watching' | 'done' | 'partial' | 'failed';

function phaseOf(run: AnnotationRunRead): Phase {
  switch (run.status) {
    case 'pending': return 'queued';
    case 'running': return 'running';
    case 'waiting': return 'waiting';
    case 'failed': return 'failed';
    case 'completed_with_errors': return 'partial';
    default: return run.live ? 'watching' : 'done';
  }
}

/** Per phase: what it is called, its dot, and the line that says what it
 *  means for the person looking at it. Colour only where it carries meaning. */
const PHASE: Record<Phase, { label: string; dot: string; note?: string }> = {
  queued:   { label: 'Queued',    dot: 'bg-hud-dim animate-pulse', note: 'Waiting for a worker to pick it up.' },
  running:  { label: 'Annotating', dot: 'bg-sky-500 animate-pulse' },
  waiting:  { label: 'Waiting',   dot: 'bg-hud-dim', note: 'Paused until its inputs are ready.' },
  watching: { label: 'Watching',  dot: 'bg-emerald-500 animate-pulse', note: 'Caught up. New material in scope is annotated as it lands.' },
  done:     { label: 'Complete',  dot: 'bg-emerald-500' },
  partial:  { label: 'Complete with gaps', dot: 'bg-amber-500' },
  failed:   { label: 'Failed',    dot: 'bg-rose-500' },
};

/**
 * The meter, full width. Discrete cells like `HudMeter`, because a measured
 * readout should look measured — but enough of them to span the column, and
 * in up to three parts: done, failed, still to do. One glance answers both
 * "how far" and "how well".
 */
const CELLS = 40;
function RunMeter({ done, failed, className }: { done: number; failed: number; className?: string }) {
  const f = Math.round(Math.min(1, failed) * CELLS);
  const d = Math.min(CELLS - f, Math.round(Math.min(1, done) * CELLS));
  return (
    <div className={cn('grid gap-px', className)} style={{ gridTemplateColumns: `repeat(${CELLS}, 1fr)` }} aria-hidden>
      {Array.from({ length: CELLS }, (_, i) => (
        <span
          key={i}
          className={cn(
            'h-2 rounded-[1px] transition-colors duration-500',
            i < d ? 'bg-hud-fg/75' : i < d + f ? 'bg-rose-500/80' : 'bg-hud-line-strong/60',
          )}
        />
      ))}
    </div>
  );
}

/**
 * The run's progress, as numbers that move: the phase and how long it has
 * been in it, how far through its scope, how fast, and when it will be done.
 * One place computes them; the pipeline's last stage and its failure strip
 * show them.
 */
function useProgress(run: AnnotationRunRead, coverage: Coverage) {
  const phase = phaseOf(run);
  const running = phase === 'running';
  const now = useNow(running ? 1000 : 30_000);
  const { done, of } = coverage;

  // A live run keeps its first `started_at` through every cycle, so the time
  // since then says nothing about this one: the clock is for one-off runs.
  const started = !run.live && run.started_at ? new Date(run.started_at).getTime() : null;
  const finished = run.completed_at ? new Date(run.completed_at).getTime() : null;
  const elapsed = started ? ((running ? now : finished ?? now) - started) / 1000 : null;

  // The rate is the figure on screen, observed moving — so it is this
  // cycle's, whatever kind of run it is. Until it has moved, a one-off falls
  // back to its average so far. An estimate, never a promise: hence the ≈.
  const [sample, setSample] = useState<{ t: number; n: number } | null>(null);
  useEffect(() => {
    if (!running) {
      setSample(null);
      return;
    }
    setSample((s) => (s && done >= s.n ? s : { t: Date.now(), n: done }));
  }, [running, done]);
  const watched = sample ? (now - sample.t) / 1000 : 0;
  const rate = !running ? null
    : sample && done > sample.n && watched > 5 ? (done - sample.n) / watched
    : elapsed && elapsed > 5 && done > 0 ? done / elapsed
    : null;
  const eta = rate && of ? Math.max(0, of - done) / rate : null;

  // How long it has been in this state, as briefly as a clock would say it.
  const age =
    running ? (elapsed != null ? formatSpan(elapsed) : null)
    : phase === 'queued' || phase === 'waiting' ? `for ${since(run.updated_at)}`
    : phase === 'watching' ? `checked ${since(run.updated_at)} ago`
    : `${since(run.completed_at ?? run.updated_at)} ago`;

  // The line under the meter: what is most useful to know next.
  const next =
    running && of ? (eta != null ? `≈ ${formatSpan(eta)} left` : 'Estimating…')
    : phase === 'done' && elapsed != null ? `Took ${formatSpan(elapsed)}.`
    : PHASE[phase].note;

  return {
    phase,
    running,
    age,
    next,
    rate: rate == null ? null : rate >= 1 ? `${rate.toFixed(1)}/s` : `${(rate * 60).toFixed(1)}/min`,
    pct: of ? Math.floor((Math.min(done, of) / of) * 100) : null,
  };
}

/** A figure that eases to its new value rather than jumping — the count
 *  of a working run reads as moving, not as flickering. */
function useEased(value: number, ms = 450) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    if (a === value) return;
    let frame = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      const eased = 1 - Math.pow(1 - k, 3);
      const v = Math.round(a + (value - a) * eased);
      from.current = v;
      setShown(v);
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, ms]);
  return shown;
}

// ─── The run, as a line ──────────────────────────────────────────────────────

/**
 * One step of the run, on a single line: a glyph on the spine, a plain name,
 * the value, and — where the step can be extended — its action at the end.
 * Steps share one grid, so names and values align down the column; a detail
 * sits under its value. The spine joins each glyph to the next, so the steps
 * read as one thing the material passes through.
 */
const STEP_GRID = 'grid grid-cols-[1rem_3.25rem_minmax(0,1fr)_auto] gap-x-2';

function Step({
  icon: Icon,
  label,
  children,
  detail,
  onOpen,
  action,
  live,
}: {
  icon: LucideIcon;
  label: string;
  children: React.ReactNode;
  detail?: React.ReactNode;
  onOpen?: () => void;
  action?: React.ReactNode;
  /** Material is passing through this step right now. */
  live?: boolean;
}) {
  return (
    <li className={cn(STEP_GRID, 'relative items-baseline pb-2.5')}>
      <span aria-hidden className="absolute bottom-0 left-[7.5px] top-[1.125rem] w-px bg-hud-line" />
      <span className="relative flex h-4 w-4 items-center justify-center self-center bg-background">
        <Icon className={cn('h-3.5 w-3.5 stroke-[1.5] transition-colors duration-500', live ? 'text-sky-500' : 'text-hud-dim')} />
      </span>
      <span className="text-xs text-hud-dimmer">{label}</span>
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 truncate text-left text-[13px] text-hud-fg underline-offset-2 transition-colors hover:underline hover:decoration-hud-line-strong"
        >
          {children}
        </button>
      ) : (
        <span className="min-w-0 truncate text-[13px] text-hud-fg">{children}</span>
      )}
      <span className="self-center justify-self-end">{action}</span>
      {detail && <span className="col-span-2 col-start-3 mt-0.5 min-w-0 text-xs text-hud-dimmer">{detail}</span>}
    </li>
  );
}

/**
 * Where the line ends: what the steps have made. Its glyph is the phase dot,
 * its name the phase, and on the same row the one switch that decides
 * whether the run ever ends — live, it keeps watching its scope. Below, the
 * count (which opens the assets it counts), the meter, and what is next.
 */
function OutcomeStep({
  coverage,
  progress,
  live,
  onLive,
  onBrowse,
}: {
  coverage: Coverage;
  progress: ReturnType<typeof useProgress>;
  live: boolean;
  onLive: (live: boolean) => void;
  onBrowse?: () => void;
}) {
  const p = PHASE[progress.phase];
  const { of, unit } = coverage;
  const done = useEased(coverage.done);
  const figure = (
    <>
      <span className="text-[22px] font-medium leading-none tracking-tight tabular-nums text-hud-fg">{fmt(done)}</span>
      <span className="text-xs tabular-nums text-hud-dim">{of != null ? `/ ${fmt(of)} ${unit}` : unit}</span>
      {progress.pct != null && <span className="ml-auto text-xs tabular-nums text-hud-dim">{progress.pct}%</span>}
    </>
  );
  return (
    <li className={cn(STEP_GRID, 'items-center')}>
      <span className="flex h-4 w-4 items-center justify-center">
        <span className={cn('h-2 w-2 rounded-full transition-colors duration-500', p.dot)} />
      </span>
      <span className="col-span-2 flex min-w-0 items-baseline gap-1.5 text-xs">
        <span className="font-medium text-hud-fg">{p.label}</span>
        {progress.age && <span className="truncate text-hud-dimmer">{progress.age}</span>}
      </span>
      <button
        type="button"
        onClick={() => onLive(!live)}
        aria-pressed={live}
        title={live ? 'Live — keeps annotating new material as it lands. Click to run once.' : 'Runs once over its scope. Click to keep it live.'}
        className={cn(
          'flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] transition-colors',
          live ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'text-hud-dimmer hover:text-hud-fg',
        )}
      >
        <Radio className="h-3 w-3 stroke-[1.5]" />
        Live
      </button>

      <div className="col-span-3 col-start-2 mt-2 space-y-1.5">
        {onBrowse ? (
          <button
            type="button"
            onClick={onBrowse}
            title="Show the run's assets"
            className="-mx-1 flex w-[calc(100%+0.5rem)] items-baseline gap-1.5 rounded px-1 text-left outline-none transition-colors hover:bg-hud-sunken focus-visible:bg-hud-sunken"
          >
            {figure}
          </button>
        ) : (
          <div className="flex items-baseline gap-1.5">{figure}</div>
        )}
        <RunMeter done={coverage.okRatio} failed={coverage.failedRatio} />
        <p className="flex justify-between gap-3 text-xs text-hud-dim">
          <span>{progress.next}</span>
          {progress.rate && <span className="shrink-0 tabular-nums">{progress.rate}</span>}
        </p>
      </div>
    </li>
  );
}

/**
 * What went wrong, said once, with the remedy at the end of the same line —
 * aligned with the outcome above it. Unfolds when there is something to say.
 */
function Failures({
  run,
  failed,
  show,
  onRetry,
  retryDisabled,
  isRetrying,
}: {
  run: AnnotationRunRead;
  failed: number;
  show: boolean;
  onRetry: () => void;
  retryDisabled: boolean;
  isRetrying: boolean;
}) {
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="overflow-hidden"
        >
          <div className="ml-6 mt-3 space-y-1 border-t border-hud-line pt-2.5">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-rose-600 dark:text-rose-400">
                {failed > 0 ? `${fmt(failed)} ${failed === 1 ? 'asset' : 'assets'} failed` : 'The run failed'}
              </span>
              {failed > 0 && (
                <button
                  type="button"
                  onClick={onRetry}
                  disabled={retryDisabled}
                  className="ml-auto flex items-center gap-1 text-hud-dim transition-colors hover:text-hud-fg disabled:opacity-40"
                >
                  <RefreshCw className={cn('h-3 w-3 stroke-[1.5]', isRetrying && 'animate-spin')} />
                  Retry
                </button>
              )}
            </div>
            {run.error_message && (
              <p className="line-clamp-3 text-xs leading-relaxed text-hud-dimmer break-words" title={run.error_message.slice(0, 2000)}>
                {run.error_message.slice(0, 500)}
              </p>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * How far the run has got through its scope, in one unit — assets, counted at
 * the root — so every figure in the column is the same kind of thing and they
 * agree. All of it from the ledger: the whole is the scope when the run has
 * one, the current pass when it is part-way through one without, and
 * otherwise simply what has been done.
 */
interface Coverage {
  done: number;
  failed: number;
  of: number | null;
  unit: string;
  okRatio: number;
  failedRatio: number;
}

function coverageOf(run: AnnotationRunRead, summary: RunLedgerSummary | null): Coverage {
  const annotated = summary?.annotated ?? 0;
  const failed = summary?.failed ?? 0;
  const done = annotated + failed;
  const phase = phaseOf(run);
  const unfinished = phase === 'running' || phase === 'queued' || phase === 'waiting';

  // No scope of its own, part-way through a pass: the pass is the only whole
  // there is, so the figure is the pass's own.
  if (summary?.in_scope == null && unfinished && (run.progress_total ?? 0) > 0) {
    const of = run.progress_total!;
    const passDone = Math.min(run.progress_current ?? 0, of);
    const failShare = done ? failed / done : 0;
    return {
      done: passDone, of, failed, unit: 'this pass',
      okRatio: (passDone / of) * (1 - failShare),
      failedRatio: (passDone / of) * failShare,
    };
  }

  const of = summary?.in_scope != null ? Math.max(summary.in_scope, done) : null;
  const whole = of || done || 1;
  return { done, of, failed, unit: 'assets', okRatio: annotated / whole, failedRatio: failed / whole };
}

// ─── Dashboard index ─────────────────────────────────────────────────────────

/**
 * The panels in strip order, with the ones on screen marked. The strip runs
 * off to the right, so past three panels you lose track of what is out there;
 * this is the strip's table of contents and its minimap at once. A panel is
 * "on screen" when it crosses the middle of the viewport, so a wide table half
 * off the edge still counts and a sliver at the edge does not.
 */
type IndexedPanel = {
  id: string;
  name: string;
  type: string;
  height?: number | null;
  grid_position: { x: number; y: number; w: number; h: number };
};

function PanelIndex({ panels }: { panels: IndexedPanel[] }) {
  const ordered = stripOrder(panels);
  const [inView, setInView] = useState<Set<string>>(new Set());
  // Columns re-mount when panels move, so observe again on any change to the
  // arrangement, not just to the set of panels.
  const signature = ordered.map((p) => `${p.id}:${p.grid_position.w}:${p.height ?? 1}`).join('|');

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) =>
        setInView((prev) => {
          const next = new Set(prev);
          for (const e of entries) {
            const id = (e.target as HTMLElement).dataset.panelId;
            if (!id) continue;
            if (e.isIntersecting) next.add(id);
            else next.delete(id);
          }
          return next;
        }),
      { rootMargin: '0px -20% 0px -20%' },
    );
    const frame = requestAnimationFrame(() => {
      document.querySelectorAll<HTMLElement>('[data-panel-strip] [data-panel-id]').forEach((el) => io.observe(el));
    });
    return () => {
      cancelAnimationFrame(frame);
      io.disconnect();
    };
  }, [signature]);

  const go = (id: string) =>
    document
      .querySelector(`[data-panel-strip] [data-panel-id="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });

  if (ordered.length === 0) {
    return (
      <p className={cn(HUD_PROSE, 'rounded-lg border border-dashed border-hud-line px-3 py-2.5 text-hud-dimmer')}>
        No panels yet. Add one, or ask the chat to lay out a view.
      </p>
    );
  }

  return (
    <nav aria-label="Panels" className="-mx-1.5">
      {ordered.map((panel, i) => {
        const Icon = panelIcon(panel.type);
        return (
          <HudOption
            key={panel.id}
            active={inView.has(panel.id)}
            onClick={() => go(panel.id)}
            label={
              <span className="flex items-center gap-2">
                <Icon className="h-3 w-3 shrink-0 stroke-[1.5] text-hud-dimmer" />
                <span className="truncate">{panel.name}</span>
              </span>
            }
            trailing={<HudReadout>{String(i + 1).padStart(2, '0')}</HudReadout>}
          />
        );
      })}
    </nav>
  );
}

// ─── The column ──────────────────────────────────────────────────────────────

interface AnnotationRunnerHeaderProps {
  activeRun: AnnotationRunRead;
  /** Scroll the dashboard strip to its last column. */
  onJumpToEnd: () => void;
  dashboardConfig: DashboardConfig | null;
  isDashboardDirty: boolean;
  runSchemes: AnnotationSchemaRead[];
  /** Where the run's scope stands (`lib/annotations/ledger`). */
  summary: RunLedgerSummary | null;
  isProcessing: boolean;
  isRetryingJob: boolean;

  onUpdateRun: (field: 'name' | 'description' | 'live', value: string | boolean) => void;
  onRetryJobFailures: (runId: number) => void;
  onSaveDashboard: () => Promise<void>;
  onUpdateDashboardConfig: (updates: Partial<DashboardConfig>) => void;
  onAddPanel: (panel: Omit<PanelViewConfig, 'id' | 'gridPos' | 'filters'>) => void;
  onCompactLayout: () => void;
  /** Re-shuffle panels into a randomized curated layout. */
  onRandomizeLayout: () => void;
  onDeleteRun: () => void;
  onClearRun: () => void;
  onOpenSchemasDialog: () => void;
  /** Bring the assets column into view. */
  onShowAssets: () => void;
  // Extension flow — null means extension is gated off (continuous run, flow
  // step, etc.). When set, the Schemas stage carries a `+` (assets are added
  // where they are listed, in the assets column).
  onExtendSchemas?: () => void;
  canExtend?: boolean;

  allSchemas: AnnotationSchemaRead[];
}

export default function AnnotationRunnerHeader({
  activeRun,
  onJumpToEnd,
  dashboardConfig,
  isDashboardDirty,
  runSchemes,
  summary,
  isProcessing,
  isRetryingJob,
  onUpdateRun,
  onRetryJobFailures,
  onSaveDashboard,
  onUpdateDashboardConfig,
  onAddPanel,
  onCompactLayout,
  onRandomizeLayout,
  onDeleteRun,
  onClearRun,
  onOpenSchemasDialog,
  onShowAssets,
  onExtendSchemas,
  canExtend,
  allSchemas,
}: AnnotationRunnerHeaderProps) {
  // Narrow layout only: whether the folded run is open. Wide, it always is.
  const [isOpen, setIsOpen] = useState(false);
  // Name and description are edited where they are read, one at a time.
  const [editing, setEditing] = useState<'name' | 'description' | null>(null);
  const [editingName, setEditingName] = useState(activeRun.name ?? '');
  const [editingDescription, setEditingDescription] = useState(activeRun.description ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
  const [isSettingsDialogOpen, setIsSettingsDialogOpen] = useState(false);
  // The splitting controls read values, so the run's annotations are fetched
  // for them — while the dialog is open, and only then.
  const splitResults = useRunResults(activeRun.id, activeRun.infospace_id, isSettingsDialogOpen);
  const [settingsName, setSettingsName] = useState('');
  const [settingsDescription, setSettingsDescription] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useScrollEdges<HTMLDivElement>();
  // Escape reverts and unmounts the field, and unmounting a focused field can
  // blur it. This keeps that blur from committing the text Escape threw away.
  const discardRef = useRef(false);

  // Field by field: the splitting getter reads `dashboardConfig`, which
  // arrives as a prop, so nothing here needs the whole store.
  const getGlobalVariableSplitting = useAnnotationRunStore((s) => s.getGlobalVariableSplitting);
  const setGlobalVariableSplitting = useAnnotationRunStore((s) => s.setGlobalVariableSplitting);
  const toggleFocusMode = useAnnotationRunStore((s) => s.toggleFocusMode);
  const focusMode = useAnnotationRunStore((s) => s.focusMode);
  const exportAnnotationRun = useAnnotationRunStore(s => s.exportAnnotationRun);
  const isPinned = useAnnotationRunStore(s => s.runColumnPinned);
  const togglePinned = useAnnotationRunStore(s => s.toggleRunColumnPinned);
  const importAnnotationRun = useAnnotationRunStore(s => s.importAnnotationRun);
  const { activeInfospace } = useInfospaceStore();

  const handleExportRun = async () => {
    if (!activeInfospace?.id || !activeRun?.id) return;
    setIsExporting(true);
    try {
      await exportAnnotationRun(activeInfospace.id, activeRun.id);
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportRun = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset immediately so re-picking the same file still fires onChange.
    e.target.value = '';
    if (!file || !activeInfospace?.id) return;
    setIsImporting(true);
    try {
      await importAnnotationRun(activeInfospace.id, file);
    } finally {
      setIsImporting(false);
    }
  };

  // Canon frame the run resolves into.
  const { canons } = useCanons();
  const canonIds = activeRun.canon_ids ?? [];
  const canonNames = canonIds
    .map((id) => canons.find((c) => c.id === id)?.name ?? `Canon ${id}`)
    .join(', ');

  const phase = phaseOf(activeRun);
  const isLive = !!activeRun.live;
  const coverage = coverageOf(activeRun, summary);
  const progress = useProgress(activeRun, coverage);
  const perSchema = summary?.per_schema ?? {};
  const annotationCount = summary?.annotations ?? 0;
  const config = (activeRun.configuration ?? {}) as Record<string, any>;
  const model = config.model ?? config.ai_model ?? config.model_name ?? null;
  const modelFlags = [
    config.justifications_enabled && 'justified',
    config.include_thoughts && 'thinking',
    (config.include_images || config.process_pdfs_as_images) && 'vision',
  ].filter(Boolean) as string[];
  const split = getGlobalVariableSplitting();
  const splitField = split?.enabled ? split.fieldKey : null;

  // Sync editing fields when activeRun changes
  useEffect(() => {
    setEditingName(activeRun.name ?? '');
    setEditingDescription(activeRun.description ?? '');
  }, [activeRun.id, activeRun.name, activeRun.description]);

  // --- Handlers ---

  const saveName = () => {
    const trimmed = editingName.trim();
    if (trimmed && trimmed !== activeRun.name) {
      onUpdateRun('name', trimmed);
    } else {
      setEditingName(activeRun.name ?? '');
    }
  };

  const saveDescription = () => {
    const trimmed = editingDescription.trim();
    if (trimmed !== (activeRun.description ?? '')) {
      onUpdateRun('description', trimmed);
    }
  };

  const startEdit = (field: 'name' | 'description') => {
    discardRef.current = false;
    setEditing(field);
  };

  const commitEdit = () => {
    if (discardRef.current) return;
    if (editing === 'name') saveName();
    if (editing === 'description') saveDescription();
    setEditing(null);
  };

  const discardEdit = () => {
    discardRef.current = true;
    setEditingName(activeRun.name ?? '');
    setEditingDescription(activeRun.description ?? '');
    setEditing(null);
  };

  // Enter commits a name; a description is prose, so it takes ⌘/Ctrl+Enter
  // and leaves Enter for line breaks. Both commit through blur, so clicking
  // away and pressing the key are the same act.
  const handleNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); discardEdit(); }
  };

  const handleDescriptionKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.currentTarget.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); discardEdit(); }
  };

  const handleSaveDashboard = async () => {
    if (!dashboardConfig) return;
    setIsSaving(true);
    try {
      await onSaveDashboard();
      toast.success('Dashboard saved');
    } catch {
      toast.error('Failed to save dashboard');
    }
    setIsSaving(false);
  };

  const handleAddPanel = (panelType: string) => {
    const config = panelTypes.find(p => p.type === panelType);
    if (!config) return;
    onAddPanel({ type: panelType as any, name: config.name, description: config.description });
    toast.success(`${config.name} panel added`);
    // A new panel lands at the end of the strip; go and show it. Deferred so
    // the jump measures the strip with the new column in it.
    setTimeout(onJumpToEnd, 0);
  };

  const handleOpenSettings = () => {
    if (!dashboardConfig) return;
    setSettingsName(dashboardConfig.name || '');
    setSettingsDescription(dashboardConfig.description || '');
    setIsSettingsDialogOpen(true);
  };

  const handleSaveSettings = () => {
    if (!dashboardConfig) return;
    onUpdateDashboardConfig({
      name: settingsName.trim() || 'Untitled Dashboard',
      description: settingsDescription.trim() || undefined,
    });
    setIsSettingsDialogOpen(false);
    toast.success('Dashboard settings updated');
  };

  // Folded, the same figure the state block leads with.
  const foldedReadout = coverage.of != null ? `${fmt(coverage.done)} / ${fmt(coverage.of)}` : null;
  const panels = dashboardConfig?.panels ?? [];

  // An extend control on a stage — quiet until wanted, so the spine reads
  // as a diagram first and a set of controls second.
  const extend = (label: string, onClick?: () => void) =>
    canExtend && onClick ? (
      <HudButton size="sm" icon={Plus} onClick={onClick} title={label} aria-label={label} className="border-transparent" />
    ) : null;

  // The run's own column — the desk the dashboard is worked from. It reads
  // top to bottom the way the material moves through the strip left to
  // right: which run this is; how it reads what arrives from the assets to
  // its left (the pipeline); what it has made of it so far (progress); and
  // what is laid out from that, in the panels to its right (dashboard). The
  // run-wide verbs sit in a footer that never scrolls away.
  //
  // Its top is set like the other columns' — an eyebrow, then a title — so
  // the strip reads level across. Every section is set the same way too: a
  // caps heading on a hairline, with its one control or readout on the right.
  //
  // Dressed in the instrument chrome (`ui/chrome`): hairlines and caps
  // labels, no shadows, fill only where something is chosen. It is part of
  // the same instrument as the panels it drives.
  //
  // The first column of the strip when the page has room for columns, folded
  // into one line above the panels when it does not. Asked of the page
  // surface, not the window, because a dock split narrows the page on a wide
  // screen just as a phone does.
  return (
    <>
      <aside
        aria-label="Run"
        data-run-column="run"
        className={cn(
          'flex shrink-0 flex-col border-b border-hud-line',
          // Wide, the first column of the strip and its first snap point.
          '@3xl/page:w-72 @3xl/page:snap-start @3xl/page:border-b-0 @3xl/page:border-r',
          // Pinned, it holds its place at the left edge and the panels pass
          // underneath it — opaque, so they read as going under, not through.
          isPinned && '@3xl/page:sticky @3xl/page:left-0 @3xl/page:z-20 @3xl/page:bg-background',
          focusMode && 'hidden',
        )}
      >
        {/* Folded: back, the run's name and pulse, and the way in. */}
        <div className="flex items-center gap-1 px-2 py-1.5 @3xl/page:hidden">
          <HudButton size="sm" icon={ChevronLeft} title="All runs" aria-label="All runs" onClick={onClearRun} className="border-transparent" />
          <button
            type="button"
            onClick={() => setIsOpen((v) => !v)}
            aria-expanded={isOpen}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-hud-sunken [@media(pointer:coarse)]:py-2"
          >
            <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', PHASE[phase].dot)} />
            <span className="min-w-0 truncate text-[13px] font-semibold text-hud-fg">{activeRun.name}</span>
            {foldedReadout && <HudReadout>{foldedReadout}</HudReadout>}
            <ChevronDown className={cn('ml-auto h-3.5 w-3.5 shrink-0 text-hud-dim transition-transform', isOpen && 'rotate-180')} />
          </button>
        </div>

        <div
          className={cn(
            'min-h-0 flex-1 flex-col border-t border-hud-line max-h-[70dvh]',
            isOpen ? 'flex' : 'hidden',
            '@3xl/page:flex @3xl/page:max-h-none @3xl/page:border-t-0',
          )}
        >
          <div ref={bodyRef} className="scroll-edges min-h-0 flex-1 space-y-6 overflow-y-auto px-4 pb-6 pt-4">
            {/* ── Title block ──────────────────────────────────────────── */}
            {/* Read as text, edited in place. The hover ground is the only
                hint that it is editable — enough for someone looking for it,
                invisible to someone who is not. */}
            <section className="space-y-1">
              {/* The eyebrow line: only the pin, at its end — but kept, so the
                  title sits level with the titles of the columns beside it.
                  The way back is in the footer, with the other verbs. */}
              <div className="-mx-1 hidden h-[22px] items-center @3xl/page:flex">
                <button
                  type="button"
                  onClick={togglePinned}
                  aria-pressed={isPinned}
                  aria-label={isPinned ? 'Unpin run column' : 'Pin run column'}
                  title={isPinned ? 'Unpin — scroll away with the panels' : 'Pin — keep this column while the panels scroll'}
                  className={cn(
                    'ml-auto rounded p-1 transition-colors hover:text-hud-fg',
                    isPinned ? 'text-hud-fg' : 'text-hud-dimmer',
                  )}
                >
                  {isPinned ? <PinOff className="h-3 w-3 stroke-[1.5]" /> : <Pin className="h-3 w-3 stroke-[1.5]" />}
                </button>
              </div>
              {editing === 'name' ? (
                <Input
                  autoFocus
                  aria-label="Run name"
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onKeyDown={handleNameKeyDown}
                  onBlur={commitEdit}
                  onFocus={(e) => e.currentTarget.select()}
                  className={cn(HUD_INPUT, '-mx-2 -my-0.5 h-auto w-[calc(100%+1rem)] px-2 py-0.5 text-base font-semibold leading-snug tracking-tight md:text-[15px]')}
                />
              ) : (
                <button
                  type="button"
                  title="Rename"
                  onClick={() => startEdit('name')}
                  className="-mx-2 -my-0.5 block w-[calc(100%+1rem)] rounded-md border border-transparent px-2 py-0.5 text-left text-[15px] font-semibold leading-snug tracking-tight text-hud-fg [overflow-wrap:anywhere] transition-colors hover:bg-hud-sunken"
                >
                  {activeRun.name}
                </button>
              )}

              {editing === 'description' ? (
                <Textarea
                  autoFocus
                  aria-label="Run description"
                  rows={4}
                  value={editingDescription}
                  onChange={(e) => setEditingDescription(e.target.value)}
                  onKeyDown={handleDescriptionKeyDown}
                  onBlur={commitEdit}
                  placeholder="What question is this run answering?"
                  className={cn(HUD_INPUT, HUD_PROSE, '-mx-2 mt-1 min-h-0 w-[calc(100%+1rem)] resize-none px-2 py-1 text-base md:text-xs')}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => startEdit('description')}
                  className={cn(
                    HUD_PROSE,
                    '-mx-2 mt-1 block w-[calc(100%+1rem)] rounded-md border border-transparent px-2 py-1 text-left text-xs whitespace-pre-line [overflow-wrap:anywhere] transition-colors hover:bg-hud-sunken',
                    activeRun.description ? 'text-hud-dim' : 'text-hud-dimmer',
                  )}
                >
                  {activeRun.description || 'What question is this run answering?'}
                </button>
              )}
            </section>

            {/* ── The run: what reads the material, and what it has made ─ */}
            {/* One line, top to bottom the way the material passes: the
                schema it is read through, the model that reads it, the canon
                its entities are matched against — and where the line ends,
                the outcome. What went wrong, and the remedy, unfolds under it. */}
            <section aria-label="How the run reads">
              <ol>
                <Step
                  icon={Microscope}
                  label={runSchemes.length > 1 ? 'Schemas' : 'Schema'}
                  onOpen={runSchemes.length ? onOpenSchemasDialog : undefined}
                  action={extend('Add schemas to this run', onExtendSchemas)}
                  // With several, each says how many annotations it has made;
                  // with one, those are the assets the outcome counts.
                  detail={runSchemes.length > 1 && (
                    <span className="block space-y-0.5">
                      {runSchemes.slice(0, 5).map((s) => (
                        <span key={s.id} className="flex items-baseline gap-2">
                          <span className="min-w-0 flex-1 truncate text-hud-dim">{s.name}</span>
                          <span className="shrink-0 tabular-nums">{fmt(perSchema[s.id] ?? 0)}</span>
                        </span>
                      ))}
                      {runSchemes.length > 5 && <span className="block">and {runSchemes.length - 5} more</span>}
                    </span>
                  )}
                >
                  {runSchemes.length === 1 ? runSchemes[0].name : runSchemes.length === 0 ? 'None' : `${runSchemes.length} schemas · ${fmt(annotationCount)} annotations`}
                </Step>
                <Step
                  icon={Cpu}
                  label="Model"
                  live={phase === 'running'}
                  detail={(config.provider || modelFlags.length > 0) && [config.provider, ...modelFlags].filter(Boolean).join(' · ')}
                >
                  <span title={model ?? undefined}>{model ? modelName(model) : 'Default'}</span>
                </Step>
                {canonIds.length > 0 && (
                  <Step
                    icon={Library}
                    label="Canon"
                    detail={activeRun.resolve_into_canon && 'New entities wait for your confirmation'}
                  >
                    {canonNames}
                  </Step>
                )}
                <OutcomeStep
                  coverage={coverage}
                  progress={progress}
                  live={isLive}
                  onLive={(v) => onUpdateRun('live', v)}
                  onBrowse={onShowAssets}
                />
              </ol>
              <Failures
                run={activeRun}
                failed={coverage.failed}
                show={coverage.failed > 0 || phase === 'failed'}
                onRetry={() => activeRun.id && onRetryJobFailures(activeRun.id)}
                retryDisabled={isProcessing || isRetryingJob}
                isRetrying={isRetryingJob}
              />
            </section>

            {/* ── Dashboard ────────────────────────────────────────────── */}
            <section className="space-y-3">
              <HudOverline trailing={panels.length > 0 && <HudReadout>{panels.length} {panels.length === 1 ? 'panel' : 'panels'}</HudReadout>}>
                Dashboard
              </HudOverline>

              <div className="flex items-center gap-1.5">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <HudButton icon={Plus} title="Add a panel (Ctrl+P)">Panel</HudButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-72">
                    <div className="p-2">
                      <h4 className="font-medium text-xs mb-2 px-2">Add Visualization Panel</h4>
                      <div className="grid grid-cols-1 gap-0.5">
                        {panelTypes.map(panel => {
                          const Icon = panel.icon;
                          return (
                            <button
                              key={panel.type}
                              onClick={() => handleAddPanel(panel.type)}
                              className="flex items-start gap-2.5 p-2 rounded-md hover:bg-muted/50 transition-colors text-left w-full"
                            >
                              <div className={cn('p-1.5 rounded-md text-white', panel.color)}>
                                <Icon className="h-3.5 w-3.5" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <h5 className="font-medium text-xs">{panel.name}</h5>
                                <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">{panel.description}</p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
                {/* Layout — the canvas-arrangement actions under one menu.
                    Each item mirrors a Ctrl shortcut handled in AnnotationRunner. */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <HudButton icon={Grid3X3} title="Arrange the panels" aria-label="Layout" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-48">
                    <DropdownMenuItem onClick={onCompactLayout} className="text-xs">
                      <Layers className="h-3.5 w-3.5 mr-2 text-muted-foreground/70" />
                      Compact
                      <span className="ml-auto text-[10px] text-muted-foreground">⌃C</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={onRandomizeLayout} className="text-xs">
                      <Shuffle className="h-3.5 w-3.5 mr-2 text-muted-foreground/70" />
                      Shuffle
                      <span className="ml-auto text-[10px] text-muted-foreground">⌃R</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={toggleFocusMode} className="text-xs">
                      <Maximize2 className="h-3.5 w-3.5 mr-2 text-muted-foreground/70" />
                      Focus
                      <span className="ml-auto text-[10px] text-muted-foreground">⌃F</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleOpenSettings} className="text-xs">
                      <Settings2 className="h-3.5 w-3.5 mr-2 text-muted-foreground/70" />
                      Dashboard settings
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <HudButton icon={ArrowRightToLine} onClick={onJumpToEnd} title="Jump to the last panel" aria-label="Jump to the last panel" />
                {/* Saved is the resting state and says so; unsaved is the
                    one worth noticing, so it alone gets a mark. */}
                <HudButton
                  icon={isSaving ? Loader2 : Save}
                  onClick={handleSaveDashboard}
                  disabled={!isDashboardDirty || isSaving}
                  title={isDashboardDirty ? 'Save the dashboard (Ctrl+S)' : 'All changes saved'}
                  className={cn('ml-auto', isSaving && '[&>svg]:animate-spin', !isDashboardDirty && 'border-transparent')}
                >
                  {isDashboardDirty && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />}
                  {isDashboardDirty ? 'Save' : 'Saved'}
                </HudButton>
              </div>

              {/* Run-wide analysis setting, surfaced: every panel splits by
                  it, so it belongs where you can see it, not only in a dialog. */}
              {splitField && (
                <button
                  type="button"
                  onClick={handleOpenSettings}
                  className="flex w-full items-center gap-2 rounded-md border border-hud-line px-2.5 py-1.5 text-left transition-colors hover:border-hud-line-strong"
                >
                  <Split className="h-3 w-3 shrink-0 stroke-[1.5] text-hud-dim" />
                  <span className={cn(HUD_LABEL, 'text-hud-dimmer')}>Split by</span>
                  <span className={cn(HUD_NUM, 'ml-auto truncate text-hud-fg')}>{splitField}</span>
                </button>
              )}

              <PanelIndex panels={panels} />
            </section>
          </div>

          {/* ── The run as a whole: pinned, because these act on everything
              above and should not scroll away with any one part of it.
              Three verbs on one line: leaving at its start; sharing — the
              everyday thing to do with a run — at its end, with the
              occasional and the irreversible one step behind it. ── */}
          <footer className="flex h-11 shrink-0 items-center gap-1 border-t border-hud-line px-2">
            <HudButton
              size="sm"
              icon={ChevronLeft}
              onClick={onClearRun}
              title="Back to all runs"
              className="hidden border-transparent @3xl/page:inline-flex"
            >
              All runs
            </HudButton>
            <HudButton size="sm" icon={Share2} onClick={() => setIsShareDialogOpen(true)} className="ml-auto border-transparent">
              Share
            </HudButton>
            <input ref={importInputRef} type="file" accept=".zip" className="hidden" onChange={handleImportRun} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <HudButton
                  size="sm"
                  icon={isImporting || isExporting ? Loader2 : MoreHorizontal}
                  title="More"
                  aria-label="More run actions"
                  className={cn('shrink-0 border-transparent', (isImporting || isExporting) && '[&>svg]:animate-spin')}
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top" className="w-52">
                {/* The RUN, not just the dashboard: assets (whole trees, with
                    their derived text), bundles, schemas, annotations and the
                    dashboard — everything needed to reconstitute it on
                    another instance. */}
                <DropdownMenuItem onClick={handleExportRun} disabled={isExporting} className="text-xs">
                  <Download className="h-3.5 w-3.5 mr-2 text-muted-foreground/70" />
                  Export run
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => importInputRef.current?.click()} disabled={isImporting} className="text-xs">
                  <Upload className="h-3.5 w-3.5 mr-2 text-muted-foreground/70" />
                  Import a run…
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={onDeleteRun}
                  disabled={isProcessing || isRetryingJob}
                  className="text-xs text-rose-600 focus:text-rose-600 dark:text-rose-400 dark:focus:text-rose-400"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-2" />
                  Delete run
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </footer>
        </div>
      </aside>

      {/* Share Dialog */}
      {isShareDialogOpen && activeRun && (
        <ShareAnnotationRunDialog
          run={activeRun}
          onClose={() => setIsShareDialogOpen(false)}
        />
      )}

      {/* Dashboard Settings Dialog */}
      <Dialog open={isSettingsDialogOpen} onOpenChange={setIsSettingsDialogOpen}>
        <DialogContent className="flex w-full max-w-7xl flex-col">
          <DialogHeader>
            <DialogTitle>Dashboard Settings</DialogTitle>
            <DialogDescription>Configure your dashboard properties and run-wide analysis settings. Live monitoring is set from the run column.</DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto">
            <div className="grid gap-6 py-4">
              <div className="space-y-4">
                <h4 className="text-sm font-medium text-foreground">Basic Settings</h4>
                <div className="grid gap-2">
                  <Label htmlFor="dashboard-name">Dashboard Name</Label>
                  <Input id="dashboard-name" value={settingsName} onChange={(e) => setSettingsName(e.target.value)} placeholder="Enter dashboard name..." />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="dashboard-description">Description</Label>
                  <Textarea id="dashboard-description" value={settingsDescription} onChange={(e) => setSettingsDescription(e.target.value)} placeholder="Enter dashboard description (optional)..." rows={3} />
                </div>
              </div>
              <Separator />
              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-medium text-foreground">Variable Splitting &amp; Grouping</h4>
                  <p className="text-xs text-muted-foreground mt-1">Configure how data is grouped and split across all dashboard panels.</p>
                </div>
                <VariableSplittingControls
                  schemas={allSchemas}
                  results={splitResults}
                  value={(() => {
                    const g = getGlobalVariableSplitting();
                    if (!g) return null;
                    return {
                      enabled: g.enabled,
                      schemaId: g.schemaId,
                      fieldKey: g.fieldKey,
                      visibleSplits: g.visibleSplits ? new Set(g.visibleSplits) : undefined,
                      maxSplits: g.maxSplits,
                      groupOthers: g.groupOthers,
                      valueAliases: g.valueAliases || {},
                    };
                  })()}
                  onChange={(config) => {
                    const storeConfig = config
                      ? {
                          enabled: config.enabled,
                          schemaId: config.schemaId,
                          fieldKey: config.fieldKey,
                          visibleSplits: config.visibleSplits ? Array.from(config.visibleSplits) : undefined,
                          maxSplits: config.maxSplits,
                          groupOthers: config.groupOthers,
                          valueAliases: config.valueAliases || {},
                        }
                      : undefined;
                    setGlobalVariableSplitting(storeConfig);
                  }}
                  showAdvancedControls={true}
                />
              </div>
            </div>
          </div>
          <DialogFooter className="flex-shrink-0">
            <Button variant="outline" onClick={() => setIsSettingsDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveSettings}>Save Settings</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
