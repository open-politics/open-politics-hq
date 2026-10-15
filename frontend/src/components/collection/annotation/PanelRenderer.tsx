import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { X, ChevronsUp, Edit, Check, XCircle, RotateCcw, Maximize2, Minimize2, Copy, Edit2, Settings, LayoutPanelTop, ArrowLeft, ArrowRight } from 'lucide-react';
import { cn } from "@/lib/utils";
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FormattedAnnotation, TimeAxisConfig, PanelConfig } from '@/lib/annotations/types';
import { AnnotationSchemaRead } from '@/client';
import type { Scope } from '@/lib/annotations/types';
import AnnotationResultsChart from './AnnotationResultsChart';
import AnnotationResultsPieChart from './AnnotationResultsPieChart';
import AnnotationResultsTable from './AnnotationResultsTable';
import AnnotationResultsMap, { MapPoint } from './AnnotationResultsMap';
import AnnotationResultsGraph from './AnnotationResultsGraph';
import dynamic from 'next/dynamic';

// MapLibre + deck.gl ship only with a dashboard that shows an overview, and
// cosmos.gl only with one that shows a network.
const OverviewPanel = dynamic(
  () => import('./overview/OverviewPanel').then((m) => m.OverviewPanel),
  { ssr: false, loading: () => null },
);
const NetworkPanel = dynamic(
  () => import('./network/NetworkPanel').then((m) => m.NetworkPanel),
  { ssr: false, loading: () => null },
);
import { AnnotationTimeAxisControls } from './AnnotationTimeAxisControls';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { PanelViewConfig, useAnnotationRunStore, DashboardConfig } from '@/zustand_stores/useAnnotationRunStore';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { nanoid } from 'nanoid';

// Panels used to wrap in AssetDetailProvider, but ``allResults`` is
// EMPTY_ANNOTATIONS now that panels self-fetch — which made the per-panel
// overlay open with no annotations. Dropping that wrap lets ``useAssetDetail``
// inside panels resolve up to the AnnotationRunner bridge (which has the
// real run results + schemas + activeRunId), so the drawer's asset clicks
// open the same rich split view the table uses.
// checkFilterMatch removed — filtering is now server-side via /view endpoint
import { TextSpanHighlightProvider } from '@/components/collection/contexts/TextSpanHighlightContext';
import { ScopeBadge, ScopeTargetPicker } from './ScopeOverlay';
import { createScopeFromSelection, GestureType } from '@/lib/annotations/scopes';
import { useDragScope, DraggableScopeChip } from './panels/DragScopeProvider';
import { PanelHeaderSlotProvider, PanelHeaderSlotRenderer } from './panels/PanelHeaderSlot';
import { PanelConfigPopover } from './panels/PanelConfigPopover';
import { isPanelConfigured } from '@/lib/annotations/panelCompile';
import { HEIGHTS, heightOf, stripColumns, stripOrder, type StripPlacement } from '@/lib/annotations/strip';
import { useShallow } from 'zustand/react/shallow';
import { resolveGridGeometry, quickWidth, quickSizeLabel, defaultPanelSize, type QuickSize } from '@/lib/annotations/grid';
import { PanelHeader } from '@/components/layout/PanelHeader';

type DropZone = 'left' | 'right' | 'center';
const DROP_PLACEMENT: Record<DropZone, StripPlacement> = {
  left: 'before',
  right: 'after',
  center: 'swap',
};

// Grid constants. The column count + row height are resolved per-dashboard from
// ``layout`` (see lib/annotations/grid.ts); these are only floors.
const MIN_WIDTH = 1;

// Stable empty-array references for legacy shims. Panels now self-fetch via
// useAnnotationView, so these paths never carry data.
const EMPTY_ANNOTATIONS: FormattedAnnotation[] = [];
const EMPTY_ANY_ARRAY: any[] = [];

interface PanelRendererProps {
  panel: PanelConfig;
  infospaceId: number;
  runId: number;
  allSchemas: AnnotationSchemaRead[];
  onUpdatePanel: (panelId: string, updates: Partial<PanelConfig>) => void;
  onRemovePanel: (panelId: string) => void;
  onMapPointClick?: (point: MapPoint) => void;
  onResultSelect?: (result: any) => void;
  onRetrySingleResult?: (resultId: number, customPrompt?: string) => Promise<any>;
  retryingResultId?: number | null;
  onFieldInteraction?: (result: FormattedAnnotation, fieldKey: string) => void;
  onTimestampClick?: (timestamp: Date, fieldKey: string, sourcePanelId: string) => void;
  onLocationClick?: (location: string, fieldKey: string, sourcePanelId: string) => void;
  mapHighlightLocation?: { location: string; fieldKey: string } | null;
  chartHighlightTimestamp?: { timestamp: Date; fieldKey: string } | null;
}

export const PanelRenderer: React.FC<PanelRendererProps> = ({
  panel,
  infospaceId,
  runId,
  allSchemas,
  onUpdatePanel,
  onRemovePanel,
  onMapPointClick,
  onResultSelect,
  onRetrySingleResult,
  retryingResultId,
  onFieldInteraction,
  onTimestampClick,
  onLocationClick,
  mapHighlightLocation,
  chartHighlightTimestamp,
}) => {
  // Shims for code that still references old props
  const activeRunId = runId;
  const allResults = EMPTY_ANNOTATIONS; // Panels now self-fetch
  const allSources = EMPTY_ANY_ARRAY;
  const allAssets = EMPTY_ANY_ARRAY;
  // grid_position is optional on the panel (older/ad-hoc panels, e.g. ones a chat
  // tool emits, may omit it) — normalize once so every read/spread below is safe.
  const gridPos = panel.grid_position ?? { x: 0, y: 0, w: 6, h: 4 };
  const [isEditingMetadata, setIsEditingMetadata] = useState(false);
  const [editingName, setEditingName] = useState(panel.name);
  const [editingDescription, setEditingDescription] = useState(panel.description || '');
  const [showLayoutControls, setShowLayoutControls] = useState(false);
  // Distinct facet values the pie chart discovered in its fetched data.
  // Lifted here (rather than refetched in the popover) so the config
  // popover's "which pies to show" toggle reuses the data the panel already
  // has. Empty for non-pie panels / unfaceted pies.
  const [pieFacetValues, setPieFacetValues] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartPosition, setDragStartPosition] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [dragOverZone, setDragOverZone] = useState<DropZone | null>(null);
  const movePanel = useAnnotationRunStore((s) => s.movePanel);
  const shiftPanel = useAnnotationRunStore((s) => s.shiftPanel);
  const setPanelHeight = useAnnotationRunStore((s) => s.setPanelHeight);
  // Where this panel stands in the run's strip: its place in the order, and
  // the column it has flowed into.
  const place = useAnnotationRunStore(useShallow((s) => {
    const panels = s.dashboardConfig?.panels ?? [];
    const columns = stripColumns(panels);
    return {
      index: stripOrder(panels).findIndex((p) => p.id === panel.id),
      count: panels.length,
      column: columns.findIndex((members) => members.some((p) => p.id === panel.id)),
      columns: columns.length,
    };
  }));

  // --- Scope gesture state ---
  // The local `pendingScopeGesture` powers the legacy ScopeTargetPicker
  // popover; the provider-level pending gesture powers the new drag chip.
  // Both surfaces coexist during the Phase 5 transition.
  const [pendingScopeGesture, setPendingScopeGesture] = useState<{
    fieldPath: string;
    value: any;
    gestureType: GestureType;
  } | null>(null);

  const dragScope = useDragScope();

  const handleScopeGesture = useCallback((fieldPath: string, value: any, gestureType: GestureType) => {
    setPendingScopeGesture({ fieldPath, value, gestureType });
    // Also announce to the DragScopeProvider so the floating chip appears.
    dragScope.setPending({
      sourcePanelId: panel.id,
      fieldPath,
      value,
      gestureType,
      // groupValue is filled later if the source panel is grouped (the
      // receiver honors it through the scope.group_context). For now, we
      // pass undefined — the chart's own onScopeGesture can enhance later.
    });
  }, [dragScope, panel.id]);

  const handleScopeTarget = useCallback((targetPanelId: string, mode: 'push' | 'link') => {
    if (!pendingScopeGesture) return;
    const scope = createScopeFromSelection(
      panel.id,
      { type: pendingScopeGesture.gestureType, fieldPath: pendingScopeGesture.fieldPath, data: pendingScopeGesture.value },
      panel,
      mode,
    );
    const { addScope } = useAnnotationRunStore.getState();
    addScope(targetPanelId, scope);
    setPendingScopeGesture(null);
  }, [pendingScopeGesture, panel]);

  // Memoized panel update callback — stable reference across PanelRenderer re-renders
  // prevents child panel effects that depend on onUpdatePanel from firing on every parent render
  const handlePanelUpdate = useCallback((updates: Partial<PanelConfig>) => {
    onUpdatePanel(panel.id, updates);
  }, [onUpdatePanel, panel.id]);

  // Interaction callbacks captured in a ref and exposed as stable wrappers.
  // The content subtree below is memoized against data (not layout); routing
  // its callbacks through stable wrappers means a parent passing fresh callback
  // identities can't bust that memo. This is what lets a panel change position
  // or size without re-rendering — and thus visually "reloading" — its
  // chart/map/graph. (Resize is still reflected: each renderer has its own
  // ResizeObserver / ResponsiveContainer.)
  const cbRef = useRef({ onResultSelect, onMapPointClick, onTimestampClick, onLocationClick, onFieldInteraction, onRetrySingleResult });
  cbRef.current = { onResultSelect, onMapPointClick, onTimestampClick, onLocationClick, onFieldInteraction, onRetrySingleResult };
  const cb = useMemo(() => ({
    onResultSelect: (r: any) => cbRef.current.onResultSelect?.(r),
    onMapPointClick: (p: MapPoint) => cbRef.current.onMapPointClick?.(p),
    onTimestampClick: (t: Date, k: string, pid: string) => cbRef.current.onTimestampClick?.(t, k, pid),
    onLocationClick: (l: string, k: string, pid: string) => cbRef.current.onLocationClick?.(l, k, pid),
    onFieldInteraction: (r: FormattedAnnotation, k: string) => cbRef.current.onFieldInteraction?.(r, k),
    onRetrySingleResult: (id: number, prompt?: string) =>
      cbRef.current.onRetrySingleResult?.(id, prompt) ?? Promise.resolve(null),
  }), []);
  
  // Geocoding is now owned by AnnotationResultsMap — it kicks the
  // `POST /runs/{rid}/action/geocode` endpoint and subscribes via
  // useActionWatch. PanelRenderer no longer threads stubbed marker state.

  // Use cross-panel highlight state for appropriate panel types
  const highlightLocation = panel.type === 'map' ? mapHighlightLocation : null;
  const highlightTimestamp = panel.type === 'chart' ? chartHighlightTimestamp : null;
  
  // Get run-wide settings from Zustand store — use selectors to avoid unnecessary re-renders
  const dashboardConfig = useAnnotationRunStore(state => state.dashboardConfig);
  // Grid geometry for this dashboard (column count + row height). Drives every
  // size clamp, quick-size preset, and the drag-resize cell math below.
  const gridGeo = resolveGridGeometry(dashboardConfig?.layout);
  const GRID_COLUMNS = gridGeo.columns;
  const getGlobalVariableSplitting = useAnnotationRunStore(state => state.getGlobalVariableSplitting);
  const globalVariableSplitting = getGlobalVariableSplitting();
  // Focus mode — when on, hide the per-panel header bar so panel content
  // gets the full canvas. Drag/resize handles + drop zones still work since
  // they're absolute-positioned hover reveals on the wrapper.
  const focusMode = useAnnotationRunStore(state => state.focusMode);
  
  // Convert to component format if exists - MEMOIZED to prevent constant re-rendering
  const globalVariableSplittingConfig = useMemo(() => {
    if (!globalVariableSplitting) return null;
    
    return {
      enabled: globalVariableSplitting.enabled,
      schemaId: globalVariableSplitting.schemaId,
      fieldKey: globalVariableSplitting.fieldKey,
      visibleSplits: globalVariableSplitting.visibleSplits ? new Set(globalVariableSplitting.visibleSplits) : undefined,
      maxSplits: globalVariableSplitting.maxSplits,
      groupOthers: globalVariableSplitting.groupOthers,
      valueAliases: globalVariableSplitting.valueAliases || {}
    };
  }, [
    globalVariableSplitting?.enabled,
    globalVariableSplitting?.schemaId,
    globalVariableSplitting?.fieldKey,
    globalVariableSplitting?.maxSplits,
    globalVariableSplitting?.groupOthers,
    JSON.stringify(globalVariableSplitting?.visibleSplits), // Use JSON.stringify for array comparison
    JSON.stringify(globalVariableSplitting?.valueAliases)   // Use JSON.stringify for object comparison
  ]);
  

  
  // Get collapsed state from panel config, default to false
  const isCollapsed = panel.collapsed || false;

  const handleToggleCollapse = () => {
    onUpdatePanel(panel.id, { collapsed: !isCollapsed });
  };

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent) => {
    setIsDragging(true);
    setDragStartPosition({ 
      x: gridPos.x, 
      y: gridPos.y,
      w: gridPos.w,
      h: gridPos.h
    });
    
    // Store panel information in dataTransfer for access by drop target
    const dragData = {
      panelId: panel.id,
      grid_position: gridPos
    };
    
    e.dataTransfer.setData('text/plain', JSON.stringify(dragData));
    e.dataTransfer.effectAllowed = 'move';
    
    // Create a custom drag image
    const dragImage = e.currentTarget.cloneNode(true) as HTMLElement;
    dragImage.style.transform = 'rotate(3deg)';
    dragImage.style.opacity = '0.8';
    e.dataTransfer.setDragImage(dragImage, 50, 20);
  };

  const handleDragEnd = () => {
    setIsDragging(false);
    setDragStartPosition(null);
    setDragOverZone(null);
  };

  // Which part of the panel a drag is over: either side puts the dragged
  // panel before or after this one in the strip, the middle trades places.
  const dropZoneAt = (e: React.DragEvent): DropZone => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relativeX = (e.clientX - rect.left) / rect.width;
    if (relativeX < 1 / 3) return 'left';
    if (relativeX > 2 / 3) return 'right';
    return 'center';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverZone(dropZoneAt(e));
  };

  const handleDragLeave = () => {
    setDragOverZone(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverZone(null);
    try {
      const { panelId: draggedId } = JSON.parse(e.dataTransfer.getData('text/plain'));
      if (draggedId && draggedId !== panel.id) {
        movePanel(draggedId, panel.id, DROP_PLACEMENT[dropZoneAt(e)]);
      }
    } catch (error) {
      console.warn('Failed to parse drag data:', error);
    }
  };

  // Panels now self-fetch with server-side filtering via useAnnotationView
  const filteredResults = allResults;

  const handleSaveName = () => {
    const trimmedName = editingName.trim();
    if (!trimmedName) {
      toast.error('Panel name cannot be empty');
      setEditingName(panel.name);
      return;
    }
    onUpdatePanel(panel.id, { 
      name: trimmedName,
      description: editingDescription.trim() || undefined
    });
    setIsEditingMetadata(false);
    toast.success('Panel details updated');
  };

  const handleSaveDescription = () => {
    handleSaveName();
  };

  const handleCancelNameEdit = () => {
    setEditingName(panel.name);
    setEditingDescription(panel.description || '');
    setIsEditingMetadata(false);
  };

  const handleCancelDescriptionEdit = () => {
    handleCancelNameEdit();
  };

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveName();
    } else if (e.key === 'Escape') {
      handleCancelNameEdit();
    }
  };

  const handleDescriptionKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSaveDescription();
    } else if (e.key === 'Escape') {
      handleCancelDescriptionEdit();
    }
  };

  // Panel resize and positioning handlers with safety checks
  const handleWidthChange = (newWidth: number) => {
    try {
      const clampedWidth = Math.max(MIN_WIDTH, Math.min(GRID_COLUMNS, newWidth));
      onUpdatePanel(panel.id, {
        grid_position: {
          ...gridPos,
          w: clampedWidth
        }
      });
    } catch (error) {
      console.warn('Error updating panel width:', error);
    }
  };

  const handleQuickSize = (size: QuickSize) => {
    handleWidthChange(quickWidth(size, gridGeo));
  };

  // Back to the panel type's default width, and the whole column's height.
  const handleResetLayout = () => {
    handleWidthChange(defaultPanelSize(panel.type, gridGeo).w);
    setPanelHeight(panel.id, 1);
  };
  
  const handlePanelSettingsUpdate = useCallback((newSettings: Partial<PanelViewConfig['settings']>) => {
    if (!newSettings || typeof newSettings !== 'object') {
      console.warn('Invalid settings provided to handlePanelSettingsUpdate');
      return;
    }
    
    // Simply update the panel settings - keeping this function for compatibility
    const currentSettings = panel.settings || {};
    const updatedSettings = {
      ...currentSettings,
      ...newSettings
    };
    
    onUpdatePanel(panel.id, {
      settings: updatedSettings
    });
  }, [panel.id, panel.settings, onUpdatePanel]);

  // =============================================================================

  const renderPanelContent = () => {
    // New dispatch (P3): every panel carries ``panel.formula`` (the data
    // spec, edited via RolePicker) + ``panel.panel_config`` (the typed
    // viz map per panel type, also edited via RolePicker) + optional
    // ``panel.formula_ref`` (pointer to a saved Workspace formula).
    //
    // The effective Formula = ``formula_ref`` resolution (if set) ELSE
    // ``panel.formula``. Renderers read it via useAnnotationView; the
    // panel object itself stays the single source of truth.
    //
    // Empty-state heuristic: when the panel's data spec has neither
    // group nor measures and the panel_config has no roles set, the
    // panel is unconfigured — prompt the user to open RolePicker.

    // Single source of truth for "is this panel configured?" — same
    // predicate the PanelConfigPopover uses for its warning badge.
    // Tables and measurements have sensible defaults so they always
    // pass; the other types need at least one data-side role picked.
    const configured = isPanelConfigured(panel as any);

    if (!configured) {
      return (
        <div className="h-full flex flex-col items-center justify-center text-center px-6 py-8 text-xs text-muted-foreground gap-2">
          <div className="italic">Panel not configured.</div>
          <div className="text-[11px]">
            Open the configure popover in the header to pick fields, time
            source, and filters.
          </div>
        </div>
      );
    }

    switch(panel.type) {
      case 'overview':
        return (
          <OverviewPanel
            panel={panel}
            infospaceId={infospaceId}
            runId={runId}
            schemas={allSchemas}
            onUpdatePanel={handlePanelUpdate}
          />
        );

      case 'network':
        return (
          <NetworkPanel
            panel={panel}
            infospaceId={infospaceId}
            runId={runId}
            schemas={allSchemas}
            onUpdatePanel={handlePanelUpdate}
          />
        );

      case 'table':
        return (
          <div className="h-full flex flex-col overflow-y-auto">
            <div className="flex-1 min-h-0 overflow-y-auto">
              <TextSpanHighlightProvider>
                <AnnotationResultsTable
                  infospaceId={infospaceId}
                  runId={runId}
                  schemas={allSchemas}
                  panelConfig={panel}
                  onUpdatePanel={handlePanelUpdate}
                  onResultSelect={cb.onResultSelect}
                  onRetrySingleResult={cb.onRetrySingleResult}
                  retryingResultId={retryingResultId}
                  onTimestampClick={(timestamp, fieldKey) => cb.onTimestampClick(timestamp, fieldKey, panel.id)}
                  onLocationClick={(location, fieldKey) => cb.onLocationClick(location, fieldKey, panel.id)}
                />
              </TextSpanHighlightProvider>
            </div>
          </div>
        );
      
      case 'chart':
        return (
          <div className="h-full flex flex-col overflow-y-auto">
            <div className="flex-1 min-h-0 overflow-y-auto">
              <TextSpanHighlightProvider>
                <AnnotationResultsChart
                  infospaceId={infospaceId}
                  runId={runId}
                  schemas={allSchemas}
                  panelConfig={panel}
                  onUpdatePanel={handlePanelUpdate}
                  showControls={!isCollapsed && !focusMode}
                  onResultSelect={cb.onResultSelect}
                  onFieldInteraction={cb.onFieldInteraction}
                  highlightedTimestamp={highlightTimestamp}
                  onScopeGesture={handleScopeGesture}
                />
              </TextSpanHighlightProvider>
            </div>
          </div>
        );
      
      case 'pie':
        return (
          <div className="h-full flex flex-col space-y-2 overflow-y-auto">
            <div className="flex-1 min-h-0 overflow-y-auto">
              <TextSpanHighlightProvider>
                <AnnotationResultsPieChart
                  infospaceId={infospaceId}
                  runId={runId}
                  schemas={allSchemas}
                  panelConfig={panel}
                  onUpdatePanel={handlePanelUpdate}
                  showControls={!isCollapsed && !focusMode}
                  onResultSelect={cb.onResultSelect}
                  onFieldInteraction={cb.onFieldInteraction}
                  onScopeGesture={handleScopeGesture}
                  onFacetValuesChange={setPieFacetValues}
                />
              </TextSpanHighlightProvider>
            </div>
          </div>
        );
      
      case 'map':
        return (
          <div className="h-full flex flex-col overflow-hidden">
            <div className="flex-1 min-h-0 overflow-hidden">
              <TextSpanHighlightProvider>
                <AnnotationResultsMap
                  infospaceId={infospaceId}
                  runId={runId}
                  schemas={allSchemas}
                  panelConfig={panel}
                  onUpdatePanel={handlePanelUpdate}
                  onPointClick={cb.onMapPointClick}
                  onResultSelect={cb.onResultSelect}
                  highlightLocation={highlightLocation}
                  showControls={!isCollapsed && !focusMode}
                />
              </TextSpanHighlightProvider>
            </div>
          </div>
        );
      
      case 'graph':
        return (
          <div className="h-full flex flex-col overflow-hidden">
            <div className="flex-1 min-h-0 overflow-hidden">
              <TextSpanHighlightProvider>
                <AnnotationResultsGraph
                  infospaceId={infospaceId}
                  runId={runId}
                  schemas={allSchemas}
                  panelConfig={panel}
                  onUpdatePanel={handlePanelUpdate}
                  allSchemas={allSchemas}
                  onResultSelect={cb.onResultSelect}
                />
              </TextSpanHighlightProvider>
            </div>
          </div>
        );
      
      default:
        return (
          <div className="text-center text-muted-foreground p-8">
            <p>Panel type '{panel.type}' is not yet implemented.</p>
            <p className="text-xs mt-2">Available types: table, chart, pie, graph</p>
          </div>
        );
    }
  };

  // Memoize the panel content against DATA, not layout. ``grid_position`` is
  // deliberately excluded: updatePanel preserves the reference of every field
  // it doesn't touch, so a move/resize/compact/shuffle leaves all of these deps
  // unchanged → the cached element is returned → the chart/map/graph subtree is
  // not re-rendered (and never refetches). A genuine data/config edit flips the
  // relevant ref and recomputes. Resize is still honored by each renderer's own
  // ResizeObserver. renderPanelContent is intentionally omitted from deps (it's
  // re-created each render); its captured values are all listed explicitly.
  const content = useMemo(
    () => renderPanelContent(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      panel.id, panel.type, panel.name, panel.description, panel.collapsed,
      panel.formula, panel.formula_ref, panel.panel_config,
      (panel as any).scopes_in, (panel as any).incoming_scopes, panel.merge_maps,
      panel.settings, panel.fields, (panel as any).local_filters, (panel as any).time_source,
      infospaceId, runId, allSchemas, handlePanelUpdate, handleScopeGesture, cb,
      isCollapsed, focusMode, retryingResultId, highlightTimestamp, highlightLocation,
    ],
  );

  return (
    <PanelHeaderSlotProvider>
    <div
      className={cn(
        // `overflow-hidden`: the body below is the one scroll container. The frame
        // used to scroll too, as did the body wrapper, as did the body — three
        // nested scrollers, so a swipe on a phone moved whichever one happened
        // to be under the finger.
        "flex flex-col relative group transition-all duration-200 h-full rounded-sm w-full overflow-hidden",
        "bg-background/60 backdrop-blur-sm",
        isDragging && "opacity-50 scale-95 rotate-1",
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drop Zone Visual Indicators */}
      {dragOverZone && (
        <>
          {/* Left Drop Zone */}
          {dragOverZone === 'left' && (
            <div className="absolute left-0 top-0 w-1 h-full bg-primary/60 rounded-l-lg z-30 animate-pulse" />
          )}
          
          {/* Right Drop Zone */}
          {dragOverZone === 'right' && (
            <div className="absolute right-0 top-0 w-1 h-full bg-primary/60 rounded-r-lg z-30 animate-pulse" />
          )}

          {/* Center Drop Zone (swap) */}
          {dragOverZone === 'center' && (
            <div className="absolute inset-0 border-2 border-dashed border-primary/60 rounded-lg z-30 bg-primary/10 flex items-center justify-center">
              <div className="bg-primary/80 text-primary-foreground px-3 py-1 rounded text-xs font-medium">
                Swap positions
              </div>
            </div>
          )}
        </>
      )}

      {/* Drag target — top-center invisible strip. The cursor flips to
          ``move`` on hover so the affordance is discoverable without a
          painted handle. Hidden entirely in focus mode. */}
      {!focusMode && (
        <div
          className="absolute top-0 left-1/2 transform -translate-x-1/2 w-8 h-3 cursor-move z-20 @max-3xl/page:hidden"
          draggable
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          aria-label="Drag panel"
        />
      )}

      {/* Resize target — the right edge, full height. Panels are columns of
          the run's strip and always take its full height, so the only size a
          panel has is its width: one grid column is one share of the strip's
          width, the same unit the strip lays panels out in. The cursor change
          carries the affordance, as with the drag target. */}
      {!isCollapsed && !focusMode && (
        <div
          className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-ew-resize @max-3xl/page:hidden"
          aria-label="Resize panel"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation(); // Prevent drag start when resizing
            const startX = e.clientX;
            const startWidth = gridPos.w;
            const strip = e.currentTarget.closest('[data-panel-strip]') as HTMLElement | null;
            const columnWidth = (strip?.clientWidth ?? window.innerWidth) / GRID_COLUMNS;

            const handleMouseMove = (e: MouseEvent) => {
              const widthChange = Math.round((e.clientX - startX) / columnWidth);
              const newWidth = Math.max(MIN_WIDTH, Math.min(GRID_COLUMNS, startWidth + widthChange));
              if (newWidth !== gridPos.w) handleWidthChange(newWidth);
            };

            const handleMouseUp = () => {
              document.removeEventListener('mousemove', handleMouseMove);
              document.removeEventListener('mouseup', handleMouseUp);
            };

            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
          }}
        />
      )}

      {/* The panel's title bar — always present, so the panel keeps its name.
          Geometry, truncation and what gives way first live in PanelHeader;
          the scope affordances and the control cluster are interactive, so
          both drop away in focus mode and only the title remains. */}
      <PanelHeader
        className="border-b"
        title={panel.name}
        hint={isEditingMetadata ? undefined : panel.description}
        extras={!focusMode && (
          <>
            {/* Scope badge — shows count of incoming cross-panel scopes */}
            <ScopeBadge
              panelConfig={panel}
              allPanels={dashboardConfig?.panels || []}
              onRemoveScope={(scopeId) => {
                const { removeScope } = useAnnotationRunStore.getState();
                removeScope(panel.id, scopeId);
              }}
            />
            {/* Scope target picker — click-based fallback. Drag-based handoff
                is live via DraggableScopeChip alongside. Both resolve the same
                pendingScopeGesture. */}
            {pendingScopeGesture && (
              <>
                <ScopeTargetPicker
                  sourcePanelId={panel.id}
                  allPanels={dashboardConfig?.panels || []}
                  onPush={(targetId) => handleScopeTarget(targetId, 'push')}
                  onLink={(targetId) => handleScopeTarget(targetId, 'link')}
                  trigger={
                    <Button variant="outline" size="sm" className="h-6 px-2 text-[10px] animate-pulse">
                      Push selection...
                    </Button>
                  }
                />
                {dragScope.pending?.sourcePanelId === panel.id && (
                  <DraggableScopeChip />
                )}
              </>
            )}
          </>
        )}
        actions={!focusMode && (
          <ButtonGroup >
            {/* Per-panel display knobs (mark, layout, density, geocoding,
                graph edits, etc.) mount here via PanelHeaderSlot — they stay
                on the renderer because they're per-type and don't cross-cut.
                The PanelConfigPopover (next sibling) carries the
                cross-cutting concerns: filter, time source, roles,
                explosion, and the Advanced summary of Workspace-only
                Formula features. */}
            <PanelHeaderSlotRenderer />
            <PanelConfigPopover
              panel={panel}
              schemas={allSchemas}
              availableFacets={pieFacetValues}
              onUpdate={(next) => onUpdatePanel(panel.id, next as any)}
            />
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => {
                setEditingName(panel.name);
                setEditingDescription(panel.description || '');
                setIsEditingMetadata(true);
              }}
              title="Edit panel details"
            >
              <Edit2 className="h-3 w-3" />
            </Button>
            <Popover open={showLayoutControls} onOpenChange={setShowLayoutControls}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs @max-3xl/page:hidden">
                  <LayoutPanelTop className="h-3 w-3" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-3" align="end" side="bottom">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium text-xs">Panel Layout</h4>
                    <span className="text-[10px] tabular-nums text-muted-foreground">
                      {place.index + 1} of {place.count} · column {place.column + 1}
                    </span>
                  </div>

                  {/* Position — one place earlier or later in the strip. */}
                  <div>
                    <Label className="text-[10px] text-muted-foreground mb-1.5 block">Position</Label>
                    <div className="grid grid-cols-2 gap-1.5">
                      <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={place.index <= 0} onClick={() => shiftPanel(panel.id, -1)}>
                        <ArrowLeft className="h-3 w-3 mr-1.5" />
                        Move left
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={place.index < 0 || place.index >= place.count - 1} onClick={() => shiftPanel(panel.id, 1)}>
                        Move right
                        <ArrowRight className="h-3 w-3 ml-1.5" />
                      </Button>
                    </div>
                  </div>

                  {/* Quick widths */}
                  <div>
                    <Label className="text-[10px] text-muted-foreground mb-1.5 block">Quick Widths</Label>
                    <div className="grid grid-cols-2 gap-1.5">
                      {(['small', 'medium', 'large', 'full'] as QuickSize[]).map((s) => (
                        <Button key={s} size="sm" variant="ghost" className="h-7 text-xs" onClick={() => handleQuickSize(s)}>
                          {quickSizeLabel(s)}
                        </Button>
                      ))}
                    </div>
                  </div>

                  {/* Width is a share of the page, height a share of a column.
                      Panels of one width flow into a column while they fit. */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label htmlFor="panel-width" className="text-[10px] text-muted-foreground">Width</Label>
                      <Select value={gridPos.w.toString()} onValueChange={(v) => handleWidthChange(parseInt(v))}>
                        <SelectTrigger id="panel-width" className="h-7 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: GRID_COLUMNS - MIN_WIDTH + 1 }, (_, i) => i + MIN_WIDTH).map(w => (
                            <SelectItem key={w} value={w.toString()}>
                              {w} / {GRID_COLUMNS}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="panel-height" className="text-[10px] text-muted-foreground">Height</Label>
                      <Select
                        value={String(heightOf(panel))}
                        onValueChange={(v) => setPanelHeight(panel.id, Number(v))}
                      >
                        <SelectTrigger id="panel-height" className="h-7 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {HEIGHTS.map(({ value, label }) => (
                            <SelectItem key={label} value={String(value)}>
                              {value === 1 ? 'Full column' : `${label} of column`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Reset Button */}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="w-full h-7 text-xs"
                    onClick={handleResetLayout}
                  >
                    <RotateCcw className="h-2.5 w-2.5 mr-1.5" />
                    Reset
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => onRemovePanel(panel.id)}>
              <X className="h-3 w-3" />
            </Button>
          </ButtonGroup>
        )}
      />

      {/* Description editing overlay */}
      {isEditingMetadata && (
        <div className="absolute top-8 left-2 right-2 z-20 bg-background border p-2">
          <div className="space-y-2">
            <Input
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              onKeyDown={handleNameKeyDown}
              className="text-xs h-8"
              placeholder="Panel name"
              autoFocus
            />
            <div className="flex items-start gap-2">
              <Textarea
                value={editingDescription}
                onChange={(e) => setEditingDescription(e.target.value)}
                onKeyDown={handleDescriptionKeyDown}
                className="text-xs min-h-[50px] flex-1 min-w-0"
                placeholder="Panel description (optional)"
              />
              <div className="flex flex-col gap-1 flex-shrink-0">
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handleSaveDescription}>
                  <Check className="h-3 w-3" />
                </Button>
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handleCancelDescriptionEdit}>
                  <XCircle className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col min-h-0">
        {/* Main Content — the frame's single scroll container. */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {content}
        </div>
      </div>
    </div>
    </PanelHeaderSlotProvider>
  );
}; 