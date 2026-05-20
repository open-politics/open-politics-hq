'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
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
  Maximize2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ButtonGroup } from '@/components/ui/button-group';
import { FormulaListPopover } from './formulas/FormulaListPopover';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AnnotationRunRead, AnnotationSchemaRead, AssetRead } from '@/client';
import { DashboardConfig, PanelViewConfig, useAnnotationRunStore } from '@/zustand_stores/useAnnotationRunStore';
import { FormattedAnnotation } from '@/lib/annotations/types';
import ShareAnnotationRunDialog from './ShareAnnotationRunDialog';
import { VariableSplittingControls } from './VariableSplittingControls';

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

  onUpdateRun: (field: 'name' | 'description', value: string) => void;
  onRetryJobFailures: (runId: number) => void;
  onSaveDashboard: () => Promise<void>;
  onUpdateDashboardConfig: (updates: Partial<DashboardConfig>) => void;
  onAddPanel: (panel: Omit<PanelViewConfig, 'id' | 'gridPos' | 'filters'>) => void;
  onCompactLayout: () => void;
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

  /** Open the run-scoped Formula workspace. id=null = new formula. */
  onOpenFormula?: (id: string | null) => void;
  /** Open the DossierAgent chat overlay (M7). Receives the run id so the
   *  agent scopes to it. Header just calls; the runner owns the overlay. */
  onOpenDossierAgent?: () => void;
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
  onDeleteRun,
  onClearRun,
  onOpenSchemasDialog,
  onOpenAssetsDialog,
  onExtendAssets,
  onExtendSchemas,
  canExtend,
  allSchemas,
  allResults,
  onOpenFormula,
  onOpenDossierAgent,
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

  // Track whether name/description have unsaved edits
  const nameIsDirty = editingName.trim() !== (activeRun.name ?? '');
  const descriptionIsDirty = editingDescription.trim() !== (activeRun.description ?? '');

  const { getGlobalVariableSplitting, setGlobalVariableSplitting, toggleFocusMode } = useAnnotationRunStore();

  // ``effective_status`` reflects the family rollup — when an extension run
  // is mid-flight the parent's stored ``status`` stays ``completed`` but
  // ``effective_status`` flips to ``running``. The dot, label, and progress
  // bar all read from the rolled-up state so the UI shows the extension's
  // live activity. ``isCompleted`` stays anchored to ``status`` so the
  // "completed" affordance only appears when the *whole* family is done.
  const effective = (activeRun as any).effective_status ?? activeRun.status;
  const isRunning = effective === 'running' || effective === 'pending';
  const isFailed = effective === 'failed';
  const isPartial = effective === 'completed_with_errors';
  const isCompleted = effective === 'completed';

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
  const statusDotColor = isCompleted
    ? 'bg-green-500'
    : isRunning
    ? 'bg-blue-500 animate-pulse'
    : isFailed
    ? 'bg-red-500'
    : isPartial
    ? 'bg-yellow-500'
    : 'bg-gray-400';

  const statusLabel = isCompleted
    ? 'Completed'
    : isRunning
    ? (activeRun.status === 'pending' ? 'Pending' : 'Running')
    : isFailed
    ? 'Failed'
    : isPartial
    ? 'Partial'
    : (activeRun.status ?? '').replace(/_/g, ' ');

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

  // Stop propagation helper — prevents clicks on interactive elements from toggling the fold
  const stopProp = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <>
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <div className="rounded-md border-b sticky top-0 bg-background/95 rounded-none backdrop-blur z-10">
          {/* BAR — Whole thing is the fold trigger */}
          <CollapsibleTrigger asChild>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-3 py-2 cursor-pointer select-none hover:bg-muted/30 transition-colors">
              {/* LEFT — identity + status */}
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <Play className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm font-medium truncate max-w-[30vw]" title={activeRun.name}>
                  {activeRun.name}
                </span>

                <TooltipProvider delayDuration={100}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className={cn('inline-block h-2.5 w-2.5 rounded-full shrink-0', statusDotColor)} />
                    </TooltipTrigger>
                    <TooltipContent><p>{statusLabel}</p></TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                {hasProgress && (
                  <div className="flex items-center gap-1.5 min-w-[100px] max-w-[140px]">
                    <Progress value={((activeRun.progress_current ?? 0) / activeRun.progress_total!) * 100} className="h-1.5 flex-1" />
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                      {activeRun.progress_current ?? 0}/{activeRun.progress_total}
                    </span>
                  </div>
                )}

                {!isCompleted && !isRunning && (
                  <span className="text-[10px] text-muted-foreground capitalize whitespace-nowrap">{statusLabel}</span>
                )}

                {activeRun.description && (
                  <span className="text-[11px] text-muted-foreground truncate max-w-[20vw] hidden md:inline" title={activeRun.description}>
                    &ldquo;{activeRun.description}&rdquo;
                  </span>
                )}

                {isDashboardDirty && (
                  <div className="flex items-center gap-1 shrink-0">
                    <div className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" />
                    <span className="text-[10px] text-amber-600 whitespace-nowrap">Unsaved</span>
                  </div>
                )}
              </div>

              {/* RIGHT — grouped action buttons, stopProp so they don't toggle fold */}
              <div className="flex items-center shrink-0" onClick={stopProp}>
                <ButtonGroup>
                  {/* Group 1: Data */}
                  <ButtonGroup>
                    <Button variant="outline" size="sm" className="h-6 text-[11px] px-1.5" onClick={onOpenAssetsDialog} disabled={currentRunAssets.length === 0}>
                      <FileText className="h-3 w-3 mr-1 text-green-600 dark:text-green-400" />
                      <span className="hidden lg:inline">Assets</span> ({currentRunAssets.length})
                    </Button>
                    {canExtend && (onExtendAssets || onExtendSchemas) && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm" className="h-6 text-[11px] px-1.5" title="Add data to this run">
                            <Plus className="h-3 w-3 mr-1 text-emerald-600 dark:text-emerald-400" />
                            {/* <span className="hidden lg:inline">Add</span> */}
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
                      <span className="hidden lg:inline">Schemas</span> ({runSchemes.length})
                    </Button>
                  </ButtonGroup>

                  {/* Group 2: Dashboard actions */}
                  <ButtonGroup>
                    {/* Add Panel — blue plus icon to stand out */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="h-6 text-[11px] px-2">
                          <Plus className="h-3 w-3 mr-1 text-blue-600 dark:text-blue-400" />
                          <span className="hidden sm:inline">Panel</span>
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
                    {onOpenFormula && (
                      <FormulaListPopover onOpenFormula={onOpenFormula} />
                    )}
                    {onOpenDossierAgent && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 text-[11px] px-1.5"
                        onClick={onOpenDossierAgent}
                        title="Open the DossierAgent — chat-driven formula authoring + observation snapshots"
                      >
                        <span className="text-purple-600 dark:text-purple-400">◆</span>
                        <span className="ml-1 hidden lg:inline">Agent</span>
                      </Button>
                    )}
                    <Button variant="outline" size="sm" className="h-6 text-[11px] px-1.5" onClick={onCompactLayout}>
                      <Layers className="h-3 w-3 mr-1 text-muted-foreground/70" />
                      <span className="hidden lg:inline">Compact</span>
                    </Button>
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
                      <span className="ml-1 hidden sm:inline">Save</span>
                    </Button>
                    <Button variant="outline" size="sm" className="h-6 text-[11px] px-1.5" onClick={handleOpenSettings}>
                      <Settings2 className="h-3 w-3 mr-1 text-gray-500 dark:text-gray-400" />
                      <span className="hidden lg:inline">Settings</span>
                    </Button>
                    <TooltipProvider delayDuration={100}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 text-[11px] px-1.5"
                            onClick={toggleFocusMode}
                            aria-label="Enter focus mode"
                          >
                            <Maximize2 className="h-3 w-3 mr-1 text-gray-500 dark:text-gray-400" />
                            <span className="hidden lg:inline">Focus</span>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          Hide all chrome for a clean viewing canvas (Ctrl+F)
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </ButtonGroup>

                  {/* Group 3: Meta */}
                  <ButtonGroup>
                    <Button variant="outline" size="sm" className="h-6 text-[11px] px-1.5" onClick={() => setIsShareDialogOpen(true)}>
                      <Share2 className="h-3 w-3 mr-1 text-indigo-600 dark:text-indigo-400" />
                      <span className="hidden lg:inline">Share</span>
                    </Button>
                    <Button variant="outline" size="sm" className="h-6 text-[11px] px-1.5" onClick={onClearRun}>
                      <XCircle className="h-3 w-3 mr-1 text-red-300/70 dark:text-red-400" />
                      <span className="hidden lg:inline">Clear</span>
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
                        <span className="hidden lg:inline">{isFailed ? 'Retry' : 'Retry'}</span>
                      </Button>
                    )}
                    {/* Overflow — import/export/delete */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="h-6 w-6 p-0">
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem>
                          <Download className="h-4 w-4 mr-2" />
                          Export Dashboard
                        </DropdownMenuItem>
                        <DropdownMenuItem>
                          <Upload className="h-4 w-4 mr-2" />
                          Import Dashboard
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
              </div>
            </div>
          </CollapsibleTrigger>

          {/* FOLDOUT — edit name & description */}
          <CollapsibleContent>
            <Separator />
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
          </CollapsibleContent>
        </div>
      </Collapsible>

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
