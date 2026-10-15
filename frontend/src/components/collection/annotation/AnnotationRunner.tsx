'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { RunStrip, scrollToRunColumn } from './strip/RunStrip';
import type { RunLedger } from '@/lib/annotations/ledger';
import { columnWidth, heightOf, stripColumns } from '@/lib/annotations/strip';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, X, AlertCircle, Info, Pencil, BarChart3, Table as TableIcon, MapPin, SlidersHorizontal, XCircle, RefreshCw, AlertTriangle, ChevronDown, ChevronUp, PieChartIcon, Download, Share2, Network, LayoutDashboard, FileText, Sparkles, Trash2, Microscope, Image as ImageIcon, Video, Music, Globe, Type, Mail, Eye, CheckCircle, Minimize2 } from 'lucide-react';
import {
  AnnotationSchemaRead,
  AssetRead,
  AnnotationRunRead,
  AnnotationRead,
  AnnotationRunUpdate,
} from '@/client';
import { FormattedAnnotation, TimeAxisConfig } from '@/lib/annotations/types';
import AnnotationResultsChart from './AnnotationResultsChart';
import AnnotationResultsPieChart from './AnnotationResultsPieChart';
import { format } from 'date-fns';
import { ResultFilter, FilterSet } from './AnnotationFilterControls';
import { getTargetKeysForScheme, extractLocationString } from '@/lib/annotations/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast as sonnerToast } from 'sonner';
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils";
import AssetDetailView from '../assets/Views/AssetDetailView';
import AnnotationResultDisplay from './AnnotationResultDisplay';
import AssetDetailOverlay from '../assets/Views/AssetDetailOverlay';
import { useTutorialStore } from '../../../zustand_stores/storeTutorial';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { HelpCircle } from 'lucide-react';
import AnnotationResultsMap, { MapPoint } from './AnnotationResultsMap';
import { TextSpanHighlightProvider } from '@/components/collection/contexts/TextSpanHighlightContext';
import { useProvidersStore } from '@/zustand_stores/storeProviders';
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useAnnotationSettingsStore } from '@/zustand_stores/storeAnnotationSettings';
import AnnotationSchemaEditor from './AnnotationSchemaEditor';
import AnnotationResultsTable from './AnnotationResultsTable';
import AnnotationResultsGraph from './AnnotationResultsGraph';
import { Switch } from '@/components/ui/switch';
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { useAnnotationRunStore, PanelViewConfig } from '@/zustand_stores/useAnnotationRunStore';
import { useSurfaceCommands } from '@/hooks/useSurfaceCommands';
import AnnotationRunnerHeader from './AnnotationRunnerHeader';
import { PanelRenderer } from './PanelRenderer';
import { PanelTypePicker } from './panels/PanelTypePicker';
import { DragScopeProvider, DroppablePanelZone } from './panels/DragScopeProvider';
import { createScopeFromSelection, validateScopeGraph } from '@/lib/annotations/scopes';
import { resolveGridGeometry } from '@/lib/annotations/grid';
import { useShareableStore } from '@/zustand_stores/storeShareables';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { adaptEnhancedAnnotationToFormattedAnnotation } from '@/lib/annotations/adapters';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import Link from 'next/link';
import { AnnotationTimeAxisControls } from './AnnotationTimeAxisControls';
import { SchemePreview } from './schemaCreation/SchemePreview';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAnnotationSystem } from '@/hooks/useAnnotationSystem';
import { AnnotationResultStatus } from '@/lib/annotations/types';
import { toast } from 'sonner';
import AssetSelector from '../assets/AssetSelector';
import AnnotationSchemaCard from './AnnotationSchemaCard';
import AssetDetailProvider, { AssetDetailContext } from '../assets/Views/AssetDetailProvider';
import RunHistoryView from './AnnotationRunHistory';
import { nanoid } from 'nanoid';

export type FilterLogicMode = 'and' | 'or';

// Helper function to get asset icon
interface AnnotationRunnerProps {
  allRuns: AnnotationRunRead[];
  isLoadingRuns: boolean;
  onSelectRun: (runId: number) => void;
  allSchemas: AnnotationSchemaRead[];
  activeRun: AnnotationRunRead | null;
  isProcessing: boolean;
  /** Where the run's scope stands, as counts (see `lib/annotations/ledger`). */
  ledger: RunLedger;
  onClearRun: () => void;
  onRunWithNewAssets: (template: { schemaIds: number[], config: any, assetIds: number[] }) => void;
  onRetrySingleResult?: (resultId: number, customPrompt?: string) => Promise<AnnotationRead | null>;
}

// --- Note: PanelRenderer is now imported from separate file ---

export default function AnnotationRunner({
  allRuns,
  isLoadingRuns,
  onSelectRun,
  allSchemas,
  activeRun,
  isProcessing: isProcessingProp,
  ledger,
  onClearRun,
  onRunWithNewAssets,
  onRetrySingleResult: onRetrySingleResultProp,
}: AnnotationRunnerProps) {
  const {
    retryJobFailures,
    isRetryingJob,
    retrySingleResult: hookRetrySingleResult,
    isRetryingResultId,
    updateJob,
    deleteRun,
    extendRun,
  } = useAnnotationSystem();

  // BYOK keys live in browser state and are passed into the run config at
  // submission time. Extension flows have to inject fresh keys too — the
  // backend strips ``api_keys`` from the inherited parent config so a stale
  // (rotated / depleted) snapshot can't pin the child run.
  const { apiKeys: currentApiKeys } = useProvidersStore();
  
  // Use prop version if provided, otherwise use hook version
  const retrySingleResult = onRetrySingleResultProp || hookRetrySingleResult;
  
  const isActuallyProcessing = isProcessingProp || isRetryingJob;

  // State managed by Zustand now
  // Field by field, so a store change this component does not read (a poll
  // landing on another slice) does not re-render it and every panel below.
  const {
    dashboardConfig,
    isDashboardDirty,
    updateDashboardConfig,
    addPanel,
    updatePanel,
    removePanel,
    compactLayout,
    randomizeLayout,
    saveDashboardToBackend,
    setActiveRun,
    addScope,
    focusMode,
    toggleFocusMode,
  } = useAnnotationRunStore(
    useShallow((s) => ({
      dashboardConfig: s.dashboardConfig,
      isDashboardDirty: s.isDashboardDirty,
      updateDashboardConfig: s.updateDashboardConfig,
      addPanel: s.addPanel,
      updatePanel: s.updatePanel,
      removePanel: s.removePanel,
      compactLayout: s.compactLayout,
      randomizeLayout: s.randomizeLayout,
      saveDashboardToBackend: s.saveDashboardToBackend,
      setActiveRun: s.setActiveRun,
      addScope: s.addScope,
      focusMode: s.focusMode,
      toggleFocusMode: s.toggleFocusMode,
    })),
  );
  
  const { activeInfospace } = useInfospaceStore();

  // Grid geometry (columns + px row height) for the active dashboard. Drives the
  // CSS grid track count, row height, and every per-panel position clamp below.
  // Legacy dashboards resolve to 12 × 150px; new ones to the finer default.
  const gridGeo = resolveGridGeometry(dashboardConfig?.layout);

  // The page is one strip, read left to right (`strip/RunStrip`): sources,
  // assets, an asset up close, the run, then its panels.
  const isRunColumnPinned = useAnnotationRunStore((s) => s.runColumnPinned);
  const sourcesOpen = useAnnotationRunStore((s) => s.runSourcesOpen);
  const setSourcesOpen = useAnnotationRunStore((s) => s.setRunSourcesOpen);
  const [detailAssetId, setDetailAssetId] = useState<number | null>(null);
  // Narrow, the assets stack above the run, and only when asked for.
  const [narrowAssetsOpen, setNarrowAssetsOpen] = useState(false);
  useEffect(() => {
    setDetailAssetId(null);
    setNarrowAssetsOpen(false);
  }, [activeRun?.id]);
  // To the last column, whichever element is doing the scrolling — the strip
  // when wide, the panels' own row when narrow.
  const jumpToEnd = useCallback(() => {
    const columns = document.querySelectorAll('[data-panel-strip] [data-strip-column]');
    columns[columns.length - 1]?.scrollIntoView({ behavior: 'smooth', inline: 'end', block: 'nearest' });
  }, []);
  const showAssets = useCallback(() => {
    setNarrowAssetsOpen(true);
    scrollToRunColumn('assets');
  }, []);

  // Initialize dashboard config when activeRun changes
  useEffect(() => {
    setActiveRun(activeRun); // This handles both activeRun and null cases
  }, [activeRun, setActiveRun]);

  // ── Operator drive verbs (the `dashboard:*` surface commands) ──────────────
  // Coarse and self-contained: addPanel creates AND configures a panel in one shot
  // (via a before/after id diff) so the operator never juggles internal panel ids.
  // Filters + axes ONLY — never formulas. The empty inline `formula` stub addPanel
  // creates is left untouched; we only ever set `panel_config` (axes) and
  // `formula.filter`, spreading the current value so nothing else is clobbered.
  // Gated on `dashboardConfig` so a buffered directive flushes only once a run's
  // dashboard is actually loaded (run.start navigates here with ?runId=).
  const ARRAY_AXIS_ROLES = new Set(['y', 'label', 'columns']);
  const normalizeAxis = (axis: Record<string, any>) => {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(axis)) {
      out[k] = ARRAY_AXIS_ROLES.has(k) && typeof v === 'string' ? [v] : v;
    }
    return out;
  };
  const normalizeFilter = (filter: any): { logic: 'and' | 'or'; conditions: any[] } => {
    if (typeof filter === 'string') {
      try { filter = JSON.parse(filter); } catch { return { logic: 'and', conditions: [] }; }
    }
    if (Array.isArray(filter)) return { logic: 'and', conditions: filter };
    return { logic: filter?.logic === 'or' ? 'or' : 'and', conditions: Array.isArray(filter?.conditions) ? filter.conditions : [] };
  };
  const findPanelByRef = (panels: any[], p: any) => {
    if (p?.index != null) return panels[Number(p.index)];
    if (p?.name != null) {
      const n = String(p.name).toLowerCase();
      return panels.find((x) => String(x.name).toLowerCase() === n);
    }
    return undefined;
  };
  const applyPanelUpdates = (panelId: string, p: any) => {
    const panel = useAnnotationRunStore.getState().dashboardConfig?.panels.find((x: any) => x.id === panelId);
    if (!panel) return;
    const updates: any = {};
    if (p?.description != null) updates.description = String(p.description);
    if (p?.axis && typeof p.axis === 'object') updates.panel_config = { ...(panel as any).panel_config, ...normalizeAxis(p.axis) };
    if (p?.filter) {
      const runSchemaId = (activeRun as any)?.target_schema_ids?.[0] ?? null;
      updates.formula = {
        ...(panel as any).formula,
        filter: normalizeFilter(p.filter),
        // Bind the schema so the filter editor + compile resolve field paths.
        schema_id: (panel as any).formula?.schema_id ?? runSchemaId,
      };
      // Drop any stale UI filter state so the header reconstructs (and SHOWS) the new
      // filter from formula.filter, instead of an empty saved stub winning.
      updates.settings = { ...((panel as any).settings ?? {}), filterUIState: undefined };
    }
    if (p?.size && typeof p.size === 'object') updates.grid_position = p.size; // updatePanel clamps + merges
    if (Object.keys(updates).length) useAnnotationRunStore.getState().updatePanel(panelId, updates);
  };
  const persistDashboard = () => {
    const iid = activeInfospace?.id, rid = activeRun?.id;
    if (iid && rid) void useAnnotationRunStore.getState().saveDashboardToBackend(iid, rid);
  };

  // Per-type default sizes (24-col grid). The operator shouldn't hand-size panels;
  // these are the house standards and compactLayout() arranges positions afterwards.
  const PANEL_SIZE: Record<string, { w: number; h: number }> = {
    pie: { w: 8, h: 6 }, chart: { w: 16, h: 6 }, table: { w: 24, h: 6 },
    graph: { w: 24, h: 12 }, map: { w: 16, h: 6 }, scatter: { w: 12, h: 8 }, measurements: { w: 8, h: 6 },
  };
  // Create one panel and fully configure it (size + axes + filter) via the before/after
  // id diff, so the caller never needs the internal panel id.
  const createConfiguredPanel = (spec: any) => {
    const type = String(spec?.type ?? 'table');
    const before = new Set((useAnnotationRunStore.getState().dashboardConfig?.panels ?? []).map((x: any) => x.id));
    useAnnotationRunStore.getState().addPanel({ type: type as any, name: String(spec?.name ?? 'Panel'), description: spec?.description });
    const created = (useAnnotationRunStore.getState().dashboardConfig?.panels ?? []).find((x: any) => !before.has(x.id));
    if (!created) return;
    // A graph needs a source; default to the common relation array when omitted.
    if (type === 'graph' && (spec?.axis == null || spec.axis.source == null)) {
      spec = { ...spec, axis: { ...(spec?.axis ?? {}), source: 'document.triplets[*]' } };
    }
    // A map needs a location; default to the top-level location field when omitted.
    if (type === 'map' && (spec?.axis == null || spec.axis.position == null)) {
      spec = { ...spec, axis: { ...(spec?.axis ?? {}), position: 'document.location' } };
    }
    // Pie: exclude empty slice values by default (blanks otherwise dominate).
    if (type === 'pie' && spec?.axis?.slice_by && spec?.filter == null) {
      spec = { ...spec, filter: { logic: 'and', conditions: [{ path: spec.axis.slice_by, operator: 'ne', value: '' }] } };
    }
    // Chart/timeline: x defaults to the top-level timestamp (the operator shouldn't
    // have to ask); numerical score axes read 1–10 when explicit y measures are set
    // (a count chart keeps its auto range).
    if (type === 'chart') {
      const ax = { ...(spec?.axis ?? {}) };
      if (ax.x == null) ax.x = 'document.timestamp';
      const hasY = Array.isArray(ax.y) ? ax.y.length > 0 : ax.y != null;
      if (hasY && ax.y_min == null && ax.y_max == null) { ax.y_min = 1; ax.y_max = 10; }
      spec = { ...spec, axis: ax };
    }
    const size = (spec?.size && typeof spec.size === 'object') ? spec.size : (PANEL_SIZE[type] ?? { w: 12, h: 8 });
    applyPanelUpdates(created.id, { ...spec, size });
  };

  useSurfaceCommands('dashboard', {
    addPanel: (p) => { createConfiguredPanel(p); persistDashboard(); },
    // Batch: create ALL panels in one gesture, then pack them into a tidy layout.
    addPanels: (p) => {
      const specs = Array.isArray(p?.panels) ? p.panels : [];
      specs.forEach(createConfiguredPanel);
      useAnnotationRunStore.getState().compactLayout();
      persistDashboard();
    },
    setPanel: (p) => {
      const panel = findPanelByRef(useAnnotationRunStore.getState().dashboardConfig?.panels ?? [], p);
      if (!panel) return;
      applyPanelUpdates(panel.id, p);
      persistDashboard();
    },
    removePanel: (p) => {
      const panel = findPanelByRef(useAnnotationRunStore.getState().dashboardConfig?.panels ?? [], p);
      if (panel) { useAnnotationRunStore.getState().removePanel(panel.id); persistDashboard(); }
    },
  }, { enabled: !!dashboardConfig });

  // Every run opens on its overview — where, when and who, read from buckets,
  // so it is fast at any size and fills live as rows land. Added as soon as
  // the first row exists; nothing to configure.
  useEffect(() => {
    if (activeRun &&
        dashboardConfig &&
        (!dashboardConfig.panels || dashboardConfig.panels.length === 0) &&
        (ledger.summary?.annotations ?? 0) > 0) {
      addPanel({
        type: 'overview',
        name: 'Overview',
        description: 'Where, when and who — the run at a glance',
        settings: {},
      });
    }
  }, [activeRun, dashboardConfig, ledger.summary?.annotations, addPanel]);

  const [isSchemesCollapsed, setIsSchemesCollapsed] = useState(false);
  // Ctrl+P quick panel picker (keyboard-navigable).
  const [isPanelPickerOpen, setIsPanelPickerOpen] = useState(false);
  const [isAssetSelectorOpen, setIsAssetSelectorOpen] = useState(false);
  const [selectedAssetIds, setSelectedAssetIds] = useState<number[]>([]);
  const [viewingSchema, setViewingSchema] = useState<AnnotationSchemaRead | null>(null);

  // Dialog state - changed to support both annotation results and map points
  const [isResultDialogOpen, setIsResultDialogOpen] = useState(false);
  const [selectedAnnotationResult, setSelectedAnnotationResult] = useState<FormattedAnnotation | null>(null);
  const [selectedAssetId, setSelectedAssetId] = useState<number | null>(null);
  const [selectedMapPointForDialog, setSelectedMapPointForDialog] = useState<MapPoint | null>(null);
  const [previousAnnotationResult, setPreviousAnnotationResult] = useState<FormattedAnnotation | null>(null); // Track previous annotation when viewing asset
  const [mapHighlightLocation, setMapHighlightLocation] = useState<{ location: string; fieldKey: string } | null>(null); // NEW: For cross-panel map navigation
  const [chartHighlightTimestamp, setChartHighlightTimestamp] = useState<{ timestamp: Date; fieldKey: string } | null>(null); // NEW: For cross-panel chart highlighting

  // Asset detail overlay state - shows the normal asset view when clicking results
  const [isAssetDetailOpen, setIsAssetDetailOpen] = useState(false);
  const [selectedAssetIdForDetail, setSelectedAssetIdForDetail] = useState<number | null>(null);

  // Clear all dialog selections
  const closeDetailsDialog = useCallback(() => {
    setIsResultDialogOpen(false);
    setSelectedAnnotationResult(null);
    setSelectedAssetId(null);
    setSelectedMapPointForDialog(null);
    setPreviousAnnotationResult(null);
  }, []);

  // Close asset detail overlay
  const closeAssetDetail = useCallback(() => {
    setIsAssetDetailOpen(false);
    setSelectedAssetIdForDetail(null);
  }, []);

  // --- Panel interaction callbacks ---
  // Stable references (setState setters + store getState) so they can flow into
  // the memoized panel content subtree without busting it on every render. This
  // is what lets panels shift position / resize without re-rendering (and thus
  // visually "reloading") their charts/maps/graphs.
  const handleMapPointClick = useCallback((point: MapPoint) => {
    setSelectedMapPointForDialog(point);
    setIsResultDialogOpen(true);
  }, []);

  const handleResultSelect = useCallback((result: FormattedAnnotation) => {
    setSelectedAssetIdForDetail(result.asset_id);
    setIsAssetDetailOpen(true);
  }, []);

  // Cross-panel nav — read the current dashboard via getState so the callback
  // stays referentially stable (doesn't capture dashboardConfig).
  const handleTimestampClick = useCallback((timestamp: Date, fieldKey: string) => {
    const cfg = useAnnotationRunStore.getState().dashboardConfig;
    const chartPanel = cfg?.panels?.find((p) => p.type === 'chart');
    if (!chartPanel) {
      toast.info('No chart panel found. Add a chart panel to visualize time-based data.');
      return;
    }
    // Clear any active time filter so the highlighted point shows in full context.
    if (chartPanel.settings?.timeAxisConfig?.timeFrame?.enabled) {
      updatePanel(chartPanel.id, {
        settings: {
          ...chartPanel.settings,
          timeAxisConfig: {
            ...chartPanel.settings.timeAxisConfig,
            timeFrame: { enabled: false, startDate: undefined, endDate: undefined },
          },
        },
      });
    }
    setChartHighlightTimestamp({ timestamp, fieldKey });
    setTimeout(() => setChartHighlightTimestamp(null), 5000);
    setTimeout(() => {
      const el = document.querySelector(`[data-panel-id="${chartPanel.id}"]`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-2', 'ring-blue-500', 'ring-offset-2');
      setTimeout(() => el.classList.remove('ring-2', 'ring-blue-500', 'ring-offset-2'), 2000);
    }, 100);
  }, [updatePanel]);

  const handleLocationClick = useCallback((location: string, fieldKey: string) => {
    const cfg = useAnnotationRunStore.getState().dashboardConfig;
    const mapPanel = cfg?.panels?.find((p) => p.type === 'map');
    if (!mapPanel) {
      toast.info('No map panel found. Add a map panel and geocode your location data.');
      return;
    }
    setMapHighlightLocation({ location, fieldKey });
    setTimeout(() => setMapHighlightLocation(null), 500);
    setTimeout(() => {
      const el = document.querySelector(`[data-panel-id="${mapPanel.id}"]`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-2', 'ring-emerald-500', 'ring-offset-2');
      setTimeout(() => el.classList.remove('ring-2', 'ring-emerald-500', 'ring-offset-2'), 2000);
    }, 100);
  }, [updatePanel]);

  // Save the dashboard to the backend. Shared by the header Save button and the
  // Ctrl+S shortcut.
  const saveDashboard = useCallback(async () => {
    if (activeRun && activeInfospace) {
      await saveDashboardToBackend(activeInfospace.id, activeRun.id);
    }
  }, [activeRun, activeInfospace, saveDashboardToBackend]);

  // Smooth-scroll a panel into view and pulse its border — the "jump to the
  // panel I just created" affordance.
  const scrollToPanel = useCallback((panelId: string) => {
    setTimeout(() => {
      const el = document.querySelector(`[data-panel-id="${panelId}"]`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-2', 'ring-blue-500', 'ring-offset-2');
      setTimeout(() => el.classList.remove('ring-2', 'ring-blue-500', 'ring-offset-2'), 1600);
    }, 80);
  }, []);

  // Create a panel from the Ctrl+P picker, then auto-navigate to it. addPanel is
  // a void store action that mints the id internally, so we diff the panel list
  // before/after to find the newly-created panel and scroll to it.
  const handlePickPanel = useCallback((def: { type: string; name: string; description: string }) => {
    const store = useAnnotationRunStore.getState();
    const before = new Set((store.dashboardConfig?.panels ?? []).map((p) => p.id));
    addPanel({ type: def.type as any, name: def.name, description: def.description });
    const after = useAnnotationRunStore.getState().dashboardConfig?.panels ?? [];
    const created = after.find((p) => !before.has(p.id));
    toast.success(`${def.name} panel added`);
    if (created) scrollToPanel(created.id);
  }, [addPanel, scrollToPanel]);

  // Runner keyboard shortcuts. Ctrl-only — NOT ⌘ — so Mac users keep ⌘+R / ⌘+S
  // / ⌘+P etc. for their browser defaults. Suppressed while typing in an
  // input/textarea/contentEditable so they don't hijack normal editing. Ctrl+C
  // additionally yields to a live text selection so copy still works.
  useEffect(() => {
    if (!activeRun) return;
    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      switch (e.key.toLowerCase()) {
        case 'f': e.preventDefault(); toggleFocusMode(); break;
        case 'p': e.preventDefault(); setIsPanelPickerOpen(true); break;
        case 's': e.preventDefault(); void saveDashboard(); break;
        case 'c':
          // Defer to an active text selection so the user can still copy.
          if ((window.getSelection()?.toString() ?? '').length > 0) return;
          e.preventDefault();
          compactLayout();
          break;
        case 'r': e.preventDefault(); randomizeLayout(); break;
        default: break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeRun, toggleFocusMode, saveDashboard, compactLayout, randomizeLayout]);

  // Leaving the runner: drop focus mode so its chrome-hiding (layout top bar +
  // dock read this global flag) doesn't persist onto other routes.
  useEffect(() => {
    return () => {
      const s = useAnnotationRunStore.getState();
      if (s.focusMode) s.toggleFocusMode();
    };
  }, []);

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isSchemasDialogOpen, setIsSchemasDialogOpen] = useState(false);
  // Extension flow — adding assets / schemas to the active run.
  const [isExtendSchemasOpen, setIsExtendSchemasOpen] = useState(false);
  const [extendSelectedSchemaIds, setExtendSelectedSchemaIds] = useState<number[]>([]);
  const [isExtendingRun, setIsExtendingRun] = useState(false);

  // Extension is gated to plain one_off runs. Continuous runs self-extend on
  // poll; flow-driven runs assume single-run semantics.
  const canExtendRun = useMemo(() => (
    !!activeRun &&
    activeRun.run_type === "one_off" &&
    !(activeRun as any).source_bundle_id &&
    !(activeRun as any).flow_execution_id
  ), [activeRun]);

  const parentExistingSchemaIds = useMemo(() => (
    (activeRun?.schema_ids ?? []) as number[]
  ), [activeRun]);

  const schemasAvailableToAdd = useMemo(() => (
    allSchemas.filter(s => !parentExistingSchemaIds.includes(s.id))
  ), [allSchemas, parentExistingSchemaIds]);
  
  // Keyed on the ids, not the run: the run is a new object on every bit of
  // progress, and every panel memoizes on this list.
  const runSchemeIds: number[] =
    (activeRun as any)?.schema_ids || (activeRun?.configuration as any)?.schema_ids || (activeRun as any)?.target_schema_ids || [];
  const runSchemeKey = runSchemeIds.join(',');
  const runSchemes = useMemo(() => {
    const ids = new Set(runSchemeKey ? runSchemeKey.split(',').map(Number) : []);
    return allSchemas.filter((s) => ids.has(s.id));
  }, [runSchemeKey, allSchemas]);

  // Handle field interactions from charts/visualizations - now just shows the asset
  const handleFieldInteraction = useCallback((result: FormattedAnnotation, fieldKey: string) => {
    // Open the asset detail view for this result
    setSelectedAssetIdForDetail(result.asset_id);
    setIsAssetDetailOpen(true);
  }, []);

  const handleUpdateRun = useCallback((field: 'name' | 'description' | 'live', value: string | boolean) => {
    if (!activeRun) return;
    const updatePayload: AnnotationRunUpdate = { [field]: value };
    updateJob(activeRun.id, updatePayload);
  }, [activeRun, updateJob]);

  const handleDeleteRun = async () => {
    if (!activeRun) return;
    try {
      await deleteRun(activeRun.id);
      setIsDeleteDialogOpen(false);
      onClearRun(); // Clear the active run from parent component
      toast.success(`Run "${activeRun.name}" deleted successfully.`);
    } catch (error) {
      console.error('Error deleting run:', error);
      // Error toast is already handled by deleteRun hook
    }
  };

  // Bridge the shared AssetDetailContext to AnnotationRunner's overlay state
  // + annotation context. Panels nested below call
  // ``useAssetDetail().openDetailOverlay(assetId)`` from anywhere and get
  // the **split content + annotations** view instead of the raw asset
  // inspector that the layout-level provider would show (that one has no
  // annotations/schemas wired in).
  // Declared before the early `!activeRun` return so hook count stays stable.
  const navAssetIdsRef = useRef<number[]>([]);
  const [navTick, setNavTick] = useState(0);
  const setNavAssetIdsBridge = useCallback((ids: number[]) => {
    const prev = navAssetIdsRef.current;
    // Tables report their rows on every render; only a different list is news.
    if (prev.length === ids.length && prev.every((id, i) => id === ids[i])) return;
    navAssetIdsRef.current = ids;
    setNavTick((t) => t + 1);
  }, []);
  const openDetailOverlayBridge = useCallback((assetId: number) => {
    setSelectedAssetIdForDetail(assetId);
    setIsAssetDetailOpen(true);
  }, []);
  const navigateAdjacentBridge = useCallback((direction: 'prev' | 'next') => {
    const ids = navAssetIdsRef.current;
    if (!ids.length || selectedAssetIdForDetail == null) return;
    const idx = ids.indexOf(selectedAssetIdForDetail);
    if (idx < 0) return;
    const target = direction === 'prev' ? idx - 1 : idx + 1;
    if (target < 0 || target >= ids.length) return;
    openDetailOverlayBridge(ids[target]);
  }, [selectedAssetIdForDetail, openDetailOverlayBridge]);
  const assetDetailBridge = useMemo(() => {
    const navIds = navAssetIdsRef.current;
    const navIdx = selectedAssetIdForDetail != null ? navIds.indexOf(selectedAssetIdForDetail) : -1;
    const hasNav = navIds.length > 0 && navIdx >= 0;
    void navTick; // dependency tag — included so memo re-derives when nav list changes
    return {
      openDetailOverlay: openDetailOverlayBridge,
      openBundleDetail: (_bundleId: number) => {
        // Run-scoped overlay doesn't handle bundles; ignore.
      },
      closeDetailOverlay: closeAssetDetail,
      isOpen: isAssetDetailOpen,
      selectedAssetId: selectedAssetIdForDetail,
      selectedBundleId: null,
      viewType: (isAssetDetailOpen ? 'asset' : null) as 'asset' | 'bundle' | null,
      setNavAssetIds: setNavAssetIdsBridge,
      navigateAdjacent: navigateAdjacentBridge,
      hasNav,
      navHasPrev: hasNav && navIdx > 0,
      navHasNext: hasNav && navIdx < navIds.length - 1,
    };
  }, [
    isAssetDetailOpen,
    selectedAssetIdForDetail,
    closeAssetDetail,
    openDetailOverlayBridge,
    setNavAssetIdsBridge,
    navigateAdjacentBridge,
    navTick,
  ]);

  if (!activeRun) {
    return (
      <RunHistoryView
        runs={allRuns}
        activeRunId={null}
        onSelectRun={onSelectRun}
        isLoading={isLoadingRuns}
      />
    );
  }

  return (
    <AssetDetailContext.Provider value={assetDetailBridge}>
    {/* Floating exit-focus button — only rendered while focus mode is on.
        Stays in the top-right of the viewport so the panel canvas has
        zero chrome below it. Tooltip surfaces the Ctrl+F shortcut. */}
    {focusMode && (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              onClick={toggleFocusMode}
              className="fixed top-3 right-3 z-50 h-7 w-7 bg-background/80 backdrop-blur shadow-sm"
              aria-label="Exit focus mode"
            >
              <Minimize2 className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">
            Exit focus mode (Ctrl+F)
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )}

    {/* One strip of columns, niri-style: sources, assets and an asset up
        close to the left of the run (`RunStrip`), every panel to its right.
        Sideways scrolling moves along it and snaps to column edges, so
        nothing rests half in view. Each panel takes its share of the page's
        width and all of its height — the strip has no rows, so there is no
        height to leave empty.

        Narrow, the run folds to a line above and the panels are a strip of
        their own, one page wide each. */}
    <RunStrip
      run={activeRun}
      ledger={ledger}
      schemas={runSchemes}
      pinned={isRunColumnPinned}
      sourcesOpen={sourcesOpen}
      onSourcesOpen={setSourcesOpen}
      detailAssetId={detailAssetId}
      onDetailAsset={(id) => {
        // Narrow, there is no room beside the list: the asset opens over it.
        const strip = document.querySelector('[data-panel-strip]');
        if (id != null && strip && getComputedStyle(strip).flexDirection === 'column') {
          openDetailOverlayBridge(id);
          return;
        }
        setDetailAssetId(id);
      }}
      narrowAssetsOpen={narrowAssetsOpen}
      onExtendAssets={canExtendRun ? () => {
        setSelectedAssetIds([]);
        setIsAssetSelectorOpen(true);
      } : undefined}
    >
        <AnnotationRunnerHeader
          onJumpToEnd={jumpToEnd}
          activeRun={activeRun}
          dashboardConfig={dashboardConfig}
          isDashboardDirty={isDashboardDirty}
          runSchemes={runSchemes}
          summary={ledger.summary}
          isProcessing={isActuallyProcessing}
          isRetryingJob={isRetryingJob}
          onUpdateRun={handleUpdateRun}
          onRetryJobFailures={retryJobFailures}
          onSaveDashboard={saveDashboard}
          onUpdateDashboardConfig={updateDashboardConfig}
          onAddPanel={addPanel}
          onCompactLayout={compactLayout}
          onRandomizeLayout={randomizeLayout}
          onDeleteRun={() => setIsDeleteDialogOpen(true)}
          onClearRun={onClearRun}
          onOpenSchemasDialog={() => setIsSchemasDialogOpen(true)}
          onShowAssets={showAssets}
          onExtendSchemas={canExtendRun ? () => {
            setExtendSelectedSchemaIds([]);
            setIsExtendSchemasOpen(true);
          } : undefined}
          canExtend={canExtendRun}
          allSchemas={runSchemes}
        />



        {/* Wide, this wrapper steps out of the box tree (`contents`) so the
            panels sit in the same strip as the run column. Narrow, it is the
            strip. */}
        <div className="flex min-h-0 min-w-0 flex-1 snap-x snap-proximity gap-px overflow-x-auto overflow-y-hidden @3xl/page:contents">
          {/* Render the panels as soon as we have a dashboard config —
              even while the run is still processing. Panels self-fetch and
              re-render as incremental annotations land (per-row commits in
              process_assets_parallel + 3s polling). Header shows the
              run-level progress bar; no full-view blocking state. */}
          {!dashboardConfig ? (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">Loading dashboard configuration...</div>
          ) : (
            <DragScopeProvider
              onResolve={(targetPanelId, pending) => {
                const sourcePanel = dashboardConfig?.panels?.find(
                  (p) => p.id === pending.sourcePanelId,
                );
                if (!sourcePanel) return;
                const scope = createScopeFromSelection(
                  sourcePanel.id,
                  {
                    type: pending.gestureType,
                    fieldPath: pending.fieldPath,
                    data: pending.value,
                  },
                  sourcePanel,
                  'push',
                  {
                    mergeMaps: sourcePanel.merge_maps,
                    groupValue: pending.groupValue,
                  },
                );
                // Cycle check before commit — avoids adding a scope that
                // would create a link-mode loop once link mode ships.
                const projected = (dashboardConfig?.panels ?? []).map((p) =>
                  p.id === targetPanelId
                    ? { ...p, scopes_in: [...(p.scopes_in ?? []), scope] }
                    : p,
                );
                const validation = validateScopeGraph(projected);
                if (!validation.valid) {
                  toast.error(
                    `Scope would create a cycle: ${validation.cycle?.join(' → ') ?? '?'}`,
                  );
                  return;
                }
                addScope(targetPanelId, scope);
                toast.success(
                  `Pushed scope to ${
                    dashboardConfig?.panels?.find((p) => p.id === targetPanelId)?.name ?? 'panel'
                  }`,
                );
              }}
            >
              {stripColumns((dashboardConfig?.panels || []).filter(panel => panel && panel.id && panel.grid_position))
                .map(members => {
                  // A column of the strip, as wide as its share of the grid's
                  // columns and never narrower than a panel can be read at.
                  // Growing by the same share closes the gap when the columns
                  // together are narrower than the page. Its panels stack top
                  // to bottom at the heights they declare; room they leave at
                  // the bottom stays until Compact is asked to fill it.
                  const cols = gridGeo.columns;
                  const width = Math.max(1, Math.min(cols, columnWidth(members)));

                  return (
                    <div
                      key={members[0].id}
                      data-strip-column
                      className={cn(
                        "relative flex min-h-0 min-w-0 shrink-0 basis-full snap-start flex-col gap-px",
                        "@3xl/page:grow-[var(--grid-w)] @3xl/page:basis-[max(20rem,calc(var(--grid-w)/var(--grid-cols)*(100%_-_var(--pinned,0px))))]",
                      )}
                      style={{ '--grid-w': width, '--grid-cols': cols } as React.CSSProperties}
                    >
                      {members.map((panel) => (
                          <div
                            key={panel.id}
                            data-panel-id={panel.id}
                            className="relative min-h-0 overflow-hidden"
                            // Shrinkable by the hairline gaps, so three thirds
                            // fill the column exactly instead of overflowing it.
                            style={{ flex: `0 1 ${heightOf(panel) * 100}%` }}
                          >
                          <DroppablePanelZone
                            panelId={panel.id}
                            className="relative w-full h-full"
                          >
                            <PanelRenderer
                              panel={panel}
                              infospaceId={activeInfospace?.id || 0}
                              runId={activeRun?.id || 0}
                              allSchemas={runSchemes}
                              onUpdatePanel={updatePanel}
                              onRemovePanel={removePanel}
                              onMapPointClick={handleMapPointClick}
                              mapHighlightLocation={mapHighlightLocation}
                              chartHighlightTimestamp={chartHighlightTimestamp}
                              onResultSelect={handleResultSelect}
                              onRetrySingleResult={retrySingleResult}
                              retryingResultId={isRetryingResultId}
                              onFieldInteraction={handleFieldInteraction}
                              onTimestampClick={handleTimestampClick}
                              onLocationClick={handleLocationClick}
                            />
                          </DroppablePanelZone>
                          </div>
                      ))}
                    </div>
                  );
                })
              }
              
              {/* Empty State */}
              {(!dashboardConfig?.panels || dashboardConfig.panels.length === 0) && (
                <div className="m-2 flex min-w-0 flex-1 basis-full snap-start items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50/50">
                  <div className="text-center text-gray-500">
                    <LayoutDashboard className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <h3 className="text-lg font-medium mb-2">No Dashboard Panels</h3>
                    <p className="text-sm">Add visualization panels from the run column.</p>
                  </div>
                </div>
              )}
            </DragScopeProvider>
          )}
        </div>
    </RunStrip>

      <Dialog open={isAssetSelectorOpen} onOpenChange={setIsAssetSelectorOpen}>
        <DialogContent className="max-w-7xl h-[80vh] flex flex-col">
            <DialogHeader>
                <DialogTitle>Add assets to this run</DialogTitle>
                <DialogDescription>
                    Pick assets to annotate against this run's existing schemas. Already-annotated
                    assets are skipped automatically — accidental re-selects no-op. The data
                    lands on this run's dashboard (no new run is created in the history).
                </DialogDescription>
            </DialogHeader>
            <div className="flex-1 min-h-0">
                <AssetSelector
                    selectedItems={new Set(selectedAssetIds.map(id => `asset-${id}`))}
                    onSelectionChange={(newSelection) => {
                        const assetIds = Array.from(newSelection)
                            .filter(id => id.startsWith('asset-'))
                            .map(id => parseInt(id.replace('asset-', '')));
                        setSelectedAssetIds(assetIds);
                    }}
                />
            </div>
            <DialogFooter>
                <Button variant="outline" onClick={() => setIsAssetSelectorOpen(false)} disabled={isExtendingRun}>Cancel</Button>
                <Button
                  disabled={isExtendingRun || !activeRun}
                  onClick={async () => {
                    if (!activeRun) return;
                    if (selectedAssetIds.length === 0) {
                      toast.warning("Pick at least one asset.");
                      return;
                    }
                    setIsExtendingRun(true);
                    try {
                      const result = await extendRun({
                        runId: activeRun.id,
                        assetIds: selectedAssetIds,
                        // Inject fresh BYOK keys — backend strips inherited
                        // ``api_keys`` from the parent so a stale snapshot
                        // can't pin the child run.
                        configurationOverrides: Object.keys(currentApiKeys).length > 0
                          ? { api_keys: currentApiKeys }
                          : undefined,
                      });
                      if (result) {
                        setIsAssetSelectorOpen(false);
                        setSelectedAssetIds([]);
                      }
                    } finally {
                      setIsExtendingRun(false);
                    }
                  }}
                >
                  {isExtendingRun ? "Extending…" : "Extend run"}
                </Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isExtendSchemasOpen} onOpenChange={setIsExtendSchemasOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add schemas to this run</DialogTitle>
            <DialogDescription>
              Pick one or more schemas to apply to every asset already in this run. The new
              schemas annotate the existing corpus; they don't replace the run's current
              schemas. Already-annotated (asset, schema) pairs are skipped.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[50vh] pr-2">
            {schemasAvailableToAdd.length === 0 ? (
              <div className="text-sm text-muted-foreground py-8 text-center">
                No additional schemas available — this run already targets every active schema in the infospace.
              </div>
            ) : (
              <div className="space-y-2">
                {schemasAvailableToAdd.map((schema) => {
                  const checked = extendSelectedSchemaIds.includes(schema.id);
                  return (
                    <label
                      key={schema.id}
                      className="flex items-start gap-3 p-2 rounded-md border border-muted hover:bg-muted/40 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          setExtendSelectedSchemaIds(prev =>
                            e.target.checked
                              ? [...prev, schema.id]
                              : prev.filter(id => id !== schema.id)
                          );
                        }}
                        className="mt-1"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm">{schema.name}</div>
                        {schema.description && (
                          <div className="text-xs text-muted-foreground mt-0.5">{schema.description}</div>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsExtendSchemasOpen(false)} disabled={isExtendingRun}>Cancel</Button>
            <Button
              disabled={isExtendingRun || extendSelectedSchemaIds.length === 0 || !activeRun}
              onClick={async () => {
                if (!activeRun) return;
                setIsExtendingRun(true);
                try {
                  const result = await extendRun({
                    runId: activeRun.id,
                    schemaIds: extendSelectedSchemaIds,
                    configurationOverrides: Object.keys(currentApiKeys).length > 0
                      ? { api_keys: currentApiKeys }
                      : undefined,
                  });
                  if (result) {
                    setIsExtendSchemasOpen(false);
                    setExtendSelectedSchemaIds([]);
                  }
                } finally {
                  setIsExtendingRun(false);
                }
              }}
            >
              {isExtendingRun ? "Extending…" : `Add ${extendSelectedSchemaIds.length} schema${extendSelectedSchemaIds.length === 1 ? '' : 's'}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    <Dialog open={isSchemasDialogOpen} onOpenChange={setIsSchemasDialogOpen}>
      <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Schemas Used in This Run</DialogTitle>
          <DialogDescription>
            This run uses {runSchemes.length} annotation schema{runSchemes.length !== 1 ? 's' : ''}. Click "View Details" to see the full schema definition.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="flex-1 p-4">
          {runSchemes.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              <LayoutDashboard className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No schemas found for this run.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {runSchemes.map((schema) => (
                <Card key={schema.id} className="p-4 border border-sky-200 dark:border-sky-800 bg-sky-50/20 dark:bg-sky-950/10">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="p-1.5 rounded-md bg-sky-500/20 dark:bg-sky-500/20 text-sky-700 dark:text-sky-400">
                          <Microscope className="w-4 h-4" />
                        </div>
                        <h3 className="font-semibold text-lg truncate text-gray-900 dark:text-gray-100">{schema.name}</h3>
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                        {schema.description || 'No description available'}
                      </p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-gray-500 dark:text-gray-500">
                        <span>ID: {schema.id}</span>
                        <span>Created: {format(new Date(schema.created_at), 'MMM d, yyyy')}</span>
                        {schema.updated_at && schema.updated_at !== schema.created_at && (
                          <span>Updated: {format(new Date(schema.updated_at), 'MMM d, yyyy')}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 ml-4">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setViewingSchema(schema);
                          setIsSchemasDialogOpen(false);
                        }}
                        className="border-sky-200 dark:border-sky-800 bg-sky-50/20 dark:bg-sky-950/10 text-sky-700 dark:text-sky-400 hover:bg-sky-100/50 dark:hover:bg-sky-900/20"
                      >
                        View Details
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" onClick={() => setIsSchemasDialogOpen(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AnnotationSchemaCard
        show={!!viewingSchema}
        onClose={() => setViewingSchema(null)}
        title={`Schema: ${viewingSchema?.name}`}
        mode="watch"
      >
        {viewingSchema && <SchemePreview scheme={viewingSchema} />}
    </AnnotationSchemaCard>

    <Dialog open={isResultDialogOpen} onOpenChange={closeDetailsDialog}> 
      <DialogContent className="max-w-[95vw] w-full max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Details</DialogTitle>
          <DialogDescription>
            {selectedAnnotationResult
              ? `Annotation result for Asset ID: ${selectedAnnotationResult.asset_id}`
              : selectedMapPointForDialog 
              ? `Showing assets for location: ${selectedMapPointForDialog.locationString}`
              : `Detailed view for the selected asset.`
            }
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-auto">
          <div className="min-w-0">
            <TextSpanHighlightProvider>
              { selectedAnnotationResult ? (
                <AnnotationResultDisplay
                  result={selectedAnnotationResult}
                  schema={runSchemes.find(s => s.id === selectedAnnotationResult.schema_id) || runSchemes[0]}
                  asset={null}
                  renderContext="dialog"
                  compact={false}
                />
              ) : selectedAssetId ? (
                <AssetDetailView
                    selectedAssetId={selectedAssetId}
                    schemas={runSchemes}
                    onLoadIntoRunner={() => {}}
                    onEdit={() => {}}
                    highlightAssetIdOnOpen={null}
                    enableHighlighting={true}
                />
              ) : selectedMapPointForDialog ? (
                <div className="space-y-4">
                  {selectedMapPointForDialog.documentIds.map(assetId => (
                      <div key={assetId} className="pb-4 mb-4">
                          <h3 className="text-lg font-semibold mb-2">Asset #{assetId}</h3>
                           <AssetDetailView
                              selectedAssetId={assetId}
                              schemas={runSchemes}
                              onLoadIntoRunner={() => {}}
                              onEdit={() => {}}
                              highlightAssetIdOnOpen={null}
                              enableHighlighting={true}
                           />
                      </div>
                  ))}
                </div>
              ) : null}
            </TextSpanHighlightProvider>
          </div>
        </div>
        <DialogFooter>
          {selectedAnnotationResult && (
            <Button 
              variant="outline" 
              onClick={() => {
                setPreviousAnnotationResult(selectedAnnotationResult);
                setSelectedAssetId(selectedAnnotationResult.asset_id);
                setSelectedAnnotationResult(null);
              }}
              className="mr-2"
            >
              <FileText className="mr-2 h-4 w-4" />
              View Asset Details
            </Button>
          )}
          {selectedAssetId && previousAnnotationResult && (
            <Button 
              variant="outline" 
              onClick={() => {
                setSelectedAnnotationResult(previousAnnotationResult);
                setSelectedAssetId(null);
                setPreviousAnnotationResult(null);
              }}
              className="mr-2"
            >
              <Sparkles className="mr-2 h-4 w-4" />
              Back to Annotation
            </Button>
          )}
          <Button variant="outline" onClick={closeDetailsDialog}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* The asset over the page — from a panel, or narrow. It fetches the
        asset's annotations in this run itself. */}
    <AssetDetailOverlay
      open={isAssetDetailOpen}
      onClose={closeAssetDetail}
      assetId={selectedAssetIdForDetail}
      highlightAssetIdOnOpen={null}
      schemas={runSchemes}
      activeRunId={activeRun?.id}
    />

    <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Annotation Run</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete the run "{activeRun?.name}"? This will permanently delete the run and all its annotations. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction 
            onClick={handleDeleteRun}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete Run
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    {/* Ctrl+P quick panel picker — keyboard-navigable, auto-jumps to the new panel. */}
    <PanelTypePicker
      open={isPanelPickerOpen}
      onOpenChange={setIsPanelPickerOpen}
      onPick={handlePickPanel}
    />
    </AssetDetailContext.Provider>
  );
}