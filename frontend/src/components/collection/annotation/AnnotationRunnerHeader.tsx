'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { TopbarSlot } from '@/components/layout/TopbarSlot';
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Save,
  Settings2,
  Plus,
  Download,
  Upload,
  Share2,
  Grid3X3,
  MoreHorizontal,
  Table,
  PieChart,
  MapPin,
  Network,
  TrendingUp,
  Layers,
  Shuffle,
  Microscope,
  FileText,
  RefreshCw,
  Trash2,
  XCircle,
  AlertCircle,
  AlertTriangle,
  Check,
  Play,
  X,
  Maximize2,
  Radio,
  ChevronDown,
  Library
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ButtonGroup } from '@/components/ui/button-group';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AnnotationRunRead, AnnotationSchemaRead, AssetRead } from '@/client';
import { DashboardConfig, PanelViewConfig, useAnnotationRunStore } from '@/zustand_stores/useAnnotationRunStore';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { FormattedAnnotation } from '@/lib/annotations/types';
import ShareAnnotationRunDialog from './ShareAnnotationRunDialog';
import { VariableSplittingControls } from './VariableSplittingControls';
import { useCanons } from '@/hooks/useCanons';
import { PanelHeader } from '@/components/layout/PanelHeader';
import { ActionOverflow } from '@/components/layout/ActionOverflow';
import { useContainerWidth } from '@/hooks/useContainerWidth';

const panelTypes = [
  { type: 'table', name: 'Data Table', description: 'Tabular view with filtering and sorting', icon: Table, color: 'bg-blue-500 dark:bg-blue-600' },
  { type: 'chart', name: 'Time Series / Bar Chart', description: 'Trends over time or count comparisons', icon: TrendingUp, color: 'bg-green-500 dark:bg-green-600' },
  { type: 'pie', name: 'Pie Chart', description: 'Distribution and proportion visualization', icon: PieChart, color: 'bg-amber-500 dark:bg-amber-600' },
  { type: 'map', name: 'Geographic Map', description: 'Spatial visualization of geocoded data', icon: MapPin, color: 'bg-red-500 dark:bg-red-600' },
  { type: 'graph', name: 'Knowledge Graph', description: 'Network visualization of relationships', icon: Network, color: 'bg-purple-500 dark:bg-purple-600' },
];

interface AnnotationRunnerHeaderProps {
  activeRun: AnnotationRunRead;
  dashboardConfig: DashboardConfig | null;
  isDashboardDirty: boolean;
  runSchemes: AnnotationSchemaRead[];
  currentRunAssets: AssetRead[];
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
  onOpenAssetsDialog: () => void;
  // Extension flow — null means extension is gated off (continuous run, flow
  // step, etc.). When set, the header shows a small "Extend" dropdown next
  // to the assets/schemas buttons.
  onExtendAssets?: () => void;
  onExtendSchemas?: () => void;
  canExtend?: boolean;

  allSchemas: AnnotationSchemaRead[];
  allResults: FormattedAnnotation[];
}

export default function AnnotationRunnerHeader({
  activeRun,
  dashboardConfig,
  isDashboardDirty,
  runSchemes,
  currentRunAssets,
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
  onOpenAssetsDialog,
  onExtendAssets,
  onExtendSchemas,
  canExtend,
  allSchemas,
  allResults,
}: AnnotationRunnerHeaderProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [editingName, setEditingName] = useState(activeRun.name ?? '');
  const [editingDescription, setEditingDescription] = useState(activeRun.description ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
  const [isSettingsDialogOpen, setIsSettingsDialogOpen] = useState(false);
  const [settingsName, setSettingsName] = useState('');
  const [settingsDescription, setSettingsDescription] = useState('');
  const [isPartialAlertDismissed, setIsPartialAlertDismissed] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  // Track whether name/description have unsaved edits
  const nameIsDirty = editingName.trim() !== (activeRun.name ?? '');
  const descriptionIsDirty = editingDescription.trim() !== (activeRun.description ?? '');

  const { getGlobalVariableSplitting, setGlobalVariableSplitting, toggleFocusMode, focusMode } = useAnnotationRunStore();
  const exportAnnotationRun = useAnnotationRunStore(s => s.exportAnnotationRun);
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

  // Canon frame the run resolves into — surfaced as a subtle chip by name.
  const { canons } = useCanons();
  const canonIds = activeRun.canon_ids ?? [];
  const canonNames = canonIds
    .map((id) => canons.find((c) => c.id === id)?.name ?? `Canon ${id}`)
    .join(', ');

  // A run is one durable object — its own ``status`` is the truth. A *live* run
  // that's completed isn't "done", it's caught up and watching, so it gets its
  // own affordance (green, no pulse, "Watching") distinct from a finished one-off.
  const status = activeRun.status;
  const isLive = !!(activeRun as any).live;
  const isRunning = status === 'running' || status === 'pending';
  const isFailed = status === 'failed';
  const isPartial = status === 'completed_with_errors';
  const isCompleted = status === 'completed';
  const isWatching = isLive && isCompleted;

  // Sync editing fields when activeRun changes
  useEffect(() => {
    setEditingName(activeRun.name ?? '');
    setEditingDescription(activeRun.description ?? '');
  }, [activeRun.id, activeRun.name, activeRun.description]);

  // Reset dismissed state when run/status changes so new partial runs can show the alert again.
  useEffect(() => {
    setIsPartialAlertDismissed(false);
  }, [activeRun.id, activeRun.status, activeRun.error_message]);

  // --- Status dot ---
  const statusDotColor = isWatching
    ? 'bg-green-500 animate-pulse'
    : isCompleted
    ? 'bg-green-500'
    : isRunning
    ? 'bg-blue-500 animate-pulse'
    : isFailed
    ? 'bg-red-500'
    : isPartial
    ? 'bg-yellow-500'
    : 'bg-gray-400';

  const statusLabel = isWatching
    ? 'Watching'
    : isCompleted
    ? 'Completed'
    : isRunning
    ? (status === 'pending' ? 'Pending' : 'Running')
    : isFailed
    ? 'Failed'
    : isPartial
    ? (isLive ? 'Watching (with errors)' : 'Partial')
    : (status ?? '').replace(/_/g, ' ');

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

  const handleNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); saveName(); }
    if (e.key === 'Escape') { setEditingName(activeRun.name ?? ''); }
  };

  const handleDescriptionKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') { setEditingDescription(activeRun.description ?? ''); }
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

  const hasProgress = isRunning && activeRun.progress_total != null && activeRun.progress_total > 0;

  // Nineteen controls do not fit an app bar that is ~310px wide on a phone.
  // They used to overflow it and get clipped by the shell's `overflow-hidden`,
  // which left them on screen in the sense that they were rendered and off it
  // in every sense that matters. Below this width the whole cluster moves into
  // a sheet instead.
  //
  // Measured on the bar, not the window: this header is also squeezed when the
  // dock opens a split beside it, and that is the same problem at a wide
  // viewport. `null` (before the first measurement) leans compact so a phone's
  // first paint is already correct rather than flashing the full strip.
  const { ref: barRef, width: barWidth } = useContainerWidth<HTMLDivElement>();
  const compactActions = barWidth === null || barWidth < 520;

  return (
    <>
      <TopbarSlot>
            {/* The run name used to be capped at `max-w-[30vw]` and the
                description at `max-w-[20vw] hidden md:inline` — both measuring
                the browser window, which is not the thing they sit in. This bar
                is hoisted into the app top bar and shares it with the sidebar
                trigger, and on the runner it can also be squeezed into a dock
                split. PanelHeader measures the bar itself, so the description
                retires when the bar is short rather than when the screen is. */}
            <PanelHeader
              ref={barRef}
              className="w-full gap-x-2 px-0"
              lead={<Play className="h-4 w-4 shrink-0 text-muted-foreground" />}
              title={
                <span className="text-sm font-medium" title={activeRun.name}>
                  {activeRun.name}
                </span>
              }
              hint={activeRun.description ? `\u201C${activeRun.description}\u201D` : undefined}
              extras={
                <>
                <button
                  type="button"
                  onClick={() => setIsExpanded((v) => !v)}
                  title="Edit run details"
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                >
                  <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', isExpanded && 'rotate-180')} />
                </button>

                <TooltipProvider delayDuration={100}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className={cn('inline-block h-2.5 w-2.5 rounded-full shrink-0', statusDotColor)} />
                    </TooltipTrigger>
                    <TooltipContent><p>{statusLabel}</p></TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                {hasProgress && (
                  <div className="flex items-center gap-1.5 min-w-[3rem] max-w-[140px] @sm/panelheader:min-w-[100px]">
                    <Progress value={((activeRun.progress_current ?? 0) / activeRun.progress_total!) * 100} className="h-1.5 flex-1" />
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                      {activeRun.progress_current ?? 0}/{activeRun.progress_total}
                    </span>
                  </div>
                )}

                {!isCompleted && !isRunning && (
                  <span className="hidden text-[10px] text-muted-foreground capitalize whitespace-nowrap @sm/panelheader:inline">{statusLabel}</span>
                )}

                {canonIds.length > 0 && (
                  <span
                    className="hidden items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground shrink-0 @md/panelheader:inline-flex"
                    title={`Resolves into canon: ${canonNames}`}
                  >
                    <Library className="h-3 w-3" />
                    <span className="truncate max-w-[10rem]">{canonNames}</span>
                  </span>
                )}

                {isDashboardDirty && (
                  <div className="flex items-center gap-1 shrink-0">
                    <div className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" />
                    <span className="hidden text-[10px] text-amber-600 whitespace-nowrap @sm/panelheader:inline">Unsaved</span>
                  </div>
                )}
                </>
              }
              actions={
                <ActionOverflow
                  compact={compactActions}
                  label="Run actions"
                  description={activeRun.name}
                >
                <ButtonGroup>
                  {/* Group 1: Data */}
                  <ButtonGroup>
                    <Button variant="outline" size="sm" className="h-6 text-[11px] px-1.5" onClick={onOpenAssetsDialog} disabled={currentRunAssets.length === 0}>
                      <FileText className="h-3 w-3 mr-1 text-green-600 dark:text-green-400" />
                      <span className="control-label">Assets</span> ({currentRunAssets.length})
                    </Button>
                    {canExtend && (onExtendAssets || onExtendSchemas) && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm" className="h-6 text-[11px] px-1.5" title="Add data to this run">
                            <Plus className="h-3 w-3 mr-1 text-emerald-600 dark:text-emerald-400" />
                            {/* <span className="control-label">Add</span> */}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                          {onExtendAssets && (
                            <DropdownMenuItem onClick={onExtendAssets} className="text-xs">
                              <FileText className="h-3.5 w-3.5 mr-2 text-green-600 dark:text-green-400" />
                              <div>
                                <div className="font-medium">Add assets</div>
                                <div className="text-[10px] text-muted-foreground">Annotate more assets with this run's schemas.</div>
                              </div>
                            </DropdownMenuItem>
                          )}
                          {onExtendSchemas && (
                            <DropdownMenuItem onClick={onExtendSchemas} className="text-xs">
                              <Microscope className="h-3.5 w-3.5 mr-2 text-sky-600 dark:text-sky-400" />
                              <div>
                                <div className="font-medium">Add schemas</div>
                                <div className="text-[10px] text-muted-foreground">Apply more schemas to this run's existing assets.</div>
                              </div>
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                    <Button variant="outline" size="sm" className="h-6 text-[11px] px-1.5" onClick={onOpenSchemasDialog} disabled={runSchemes.length === 0}>
                      <Microscope className="h-3 w-3 mr-1 text-sky-600 dark:text-sky-400" />
                      <span className="control-label">Schemas</span> ({runSchemes.length})
                    </Button>
                  </ButtonGroup>

                  {/* Group 2: Dashboard actions */}
                  <ButtonGroup>
                    {/* Add Panel — blue plus icon to stand out */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="h-6 text-[11px] px-2">
                          <Plus className="h-3 w-3 mr-1 text-blue-600 dark:text-blue-400" />
                          <span className="control-label">Panel</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-72">
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
                    {/* Layout — groups the canvas-arrangement actions
                        (Compact / Shuffle / Focus) under one menu. Each item
                        mirrors a Ctrl shortcut handled in AnnotationRunner. */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="h-6 text-[11px] px-1.5" title="Layout actions">
                          <Grid3X3 className="h-3 w-3 mr-1 text-muted-foreground/70" />
                          <span className="control-label">Layout</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
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
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Button
                      onClick={handleSaveDashboard}
                      disabled={!isDashboardDirty || isSaving}
                      variant="outline"
                      size="sm"
                      className="h-6 text-[11px] px-1.5"
                    >
                      {isSaving ? (
                        <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <Save className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                      )}
                      <span className="control-label ml-1">Save</span>
                    </Button>
                    <Button variant="outline" size="sm" className="h-6 text-[11px] px-1.5" onClick={handleOpenSettings}>
                      <Settings2 className="h-3 w-3 mr-1 text-gray-500 dark:text-gray-400" />
                      <span className="control-label">Settings</span>
                    </Button>
                  </ButtonGroup>

                  {/* Group 3: Meta */}
                  <ButtonGroup>
                    <Button variant="outline" size="sm" className="h-6 text-[11px] px-1.5" onClick={() => setIsShareDialogOpen(true)}>
                      <Share2 className="h-3 w-3 mr-1 text-indigo-600 dark:text-indigo-400" />
                      <span className="control-label">Share</span>
                    </Button>
                    <Button variant="outline" size="sm" className="h-6 text-[11px] px-1.5" onClick={onClearRun}>
                      <XCircle className="h-3 w-3 mr-1 text-red-300/70 dark:text-red-400" />
                      <span className="control-label">Clear</span>
                    </Button>
                    {(isFailed || isPartial) && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 text-[11px] px-1.5"
                        onClick={() => activeRun.id && onRetryJobFailures(activeRun.id)}
                        disabled={isProcessing || isRetryingJob}
                      >
                        <RefreshCw className={cn('h-3 w-3 mr-1 text-amber-600 dark:text-amber-400', isRetryingJob && 'animate-spin')} />
                        <span className="control-label">{isFailed ? 'Retry' : 'Retry'}</span>
                      </Button>
                    )}
                    {/* Overflow — import/export/delete */}
                    <input
                      ref={importInputRef}
                      type="file"
                      accept=".zip"
                      className="hidden"
                      onChange={handleImportRun}
                    />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="h-6 w-6 p-0">
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {/* Exports the RUN, not just the dashboard: assets (whole
                            trees, with their derived text), bundles, schemas,
                            annotations and this dashboard — everything needed to
                            reconstitute it on another instance. */}
                        <DropdownMenuItem onClick={handleExportRun} disabled={isExporting}>
                          <Download className="h-4 w-4 mr-2" />
                          {isExporting ? 'Exporting…' : 'Export Run'}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => importInputRef.current?.click()} disabled={isImporting}>
                          <Upload className="h-4 w-4 mr-2" />
                          {isImporting ? 'Importing…' : 'Import Run'}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={onDeleteRun} disabled={isProcessing || isRetryingJob} className="text-destructive focus:text-destructive">
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete Run
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </ButtonGroup>
                </ButtonGroup>
                </ActionOverflow>
              }
            />
      </TopbarSlot>

      {/* Run details — inline editor on the run page (not the bar) */}
      {!focusMode && isExpanded && (
        <div className="rounded-md border bg-background/95 backdrop-blur">
            <div className="px-3 py-2.5 space-y-2.5">
              {/* Name */}
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground whitespace-nowrap w-20">Name</Label>
                <Input
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onKeyDown={handleNameKeyDown}
                  className="h-7 text-sm flex-1"
                />
                {nameIsDirty && (
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0" onClick={saveName}>
                    <Check className="h-3.5 w-3.5 text-green-600" />
                  </Button>
                )}
              </div>

              {/* Description */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Description</Label>
                <div className="flex gap-2">
                  <Textarea
                    value={editingDescription}
                    onChange={(e) => setEditingDescription(e.target.value)}
                    onKeyDown={handleDescriptionKeyDown}
                    placeholder="Add a description..."
                    rows={3}
                    className="text-sm flex-1"
                  />
                  {descriptionIsDirty && (
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0 self-start mt-0.5" onClick={saveDescription}>
                      <Check className="h-3.5 w-3.5 text-green-600" />
                    </Button>
                  )}
                </div>
              </div>

              {/* Error / warning alerts */}
              {isFailed && activeRun.error_message && (
                <Alert variant="destructive" className="text-xs p-2">
                  <AlertCircle className="h-3.5 w-3.5" />
                  <AlertTitle>Run Failed</AlertTitle>
                  <AlertDescription>{activeRun.error_message}</AlertDescription>
                </Alert>
              )}
              {isPartial && !isPartialAlertDismissed && (
                <Alert variant="default" className="relative text-xs p-2 pr-8 bg-yellow-100 dark:bg-yellow-900/30 border-yellow-300 dark:border-yellow-700 max-h-80 overflow-y-auto scrollbar-hide">
                  <button
                    type="button"
                    aria-label="Dismiss partial run warning"
                    onClick={() => setIsPartialAlertDismissed(true)}
                    className="absolute right-2 top-2 inline-flex items-center justify-center rounded-sm text-yellow-700 hover:text-yellow-900 dark:text-yellow-300 dark:hover:text-yellow-100 focus:outline-none focus:ring-2 focus:ring-yellow-500/60"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                  <AlertTriangle className="h-3.5 w-3.5 text-yellow-600 dark:text-yellow-400" />
                  <AlertTitle className="text-yellow-800 dark:text-yellow-200">Completed with Errors</AlertTitle>
                  <AlertDescription className="text-yellow-700 dark:text-yellow-300">
                    Some annotations may have failed. {activeRun.error_message && `Error: ${activeRun.error_message}`}
                  </AlertDescription>
                </Alert>
              )}
            </div>
        </div>
      )}

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
            <DialogDescription>Configure your dashboard properties and run-wide analysis settings.</DialogDescription>
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
              <div className="space-y-3">
                <div>
                  <h4 className="text-sm font-medium text-foreground">Live monitoring</h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    A live run keeps watching its scope and re-annotates new content as it lands.
                    Applies immediately.
                  </p>
                </div>
                <Tabs value={isLive ? 'live' : 'once'} onValueChange={(v) => onUpdateRun('live', v === 'live')}>
                  <TabsList className="h-9">
                    <TabsTrigger value="once" className="text-xs px-3 py-1">Run once</TabsTrigger>
                    <TabsTrigger value="live" className="text-xs px-3 py-1 data-[state=active]:text-green-600 dark:data-[state=active]:text-green-400">
                      <Radio className={cn('h-3 w-3 mr-1', isLive && 'animate-pulse')} />
                      Live
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
              <Separator />
              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-medium text-foreground">Variable Splitting &amp; Grouping</h4>
                  <p className="text-xs text-muted-foreground mt-1">Configure how data is grouped and split across all dashboard panels.</p>
                </div>
                <VariableSplittingControls
                  schemas={allSchemas}
                  results={allResults}
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
