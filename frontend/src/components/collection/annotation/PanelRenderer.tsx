import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { X, ChevronsUp, Edit, Check, XCircle, RotateCcw, Maximize2, Minimize2, Copy, Edit2, Settings, LayoutPanelTop } from 'lucide-react';
import { cn } from "@/lib/utils";
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FormattedAnnotation, TimeAxisConfig, PanelConfig } from '@/lib/annotations/types';
import { AnnotationSchemaRead } from '@/client';
import { FilterSet, FILTER_UI_OP_TO_BACKEND } from './AnnotationFilterControls';
import type { Scope } from '@/lib/annotations/types';
import AnnotationResultsChart from './AnnotationResultsChart';
import AnnotationResultsPieChart from './AnnotationResultsPieChart';
import AnnotationResultsTable from './AnnotationResultsTable';
import AnnotationResultsMap, { MapPoint } from './AnnotationResultsMap';
import AnnotationResultsGraph from './AnnotationResultsGraph';
import { FormulaPreview } from './formulas/FormulaPreview';
import { AnnotationTimeAxisControls } from './AnnotationTimeAxisControls';
import { UnifiedFilterControls } from './AnnotationFilterControls';
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

// Grid constants
const GRID_COLUMNS = 12;
const MIN_WIDTH = 1;
const MIN_HEIGHT = 1;

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
  const [isEditingMetadata, setIsEditingMetadata] = useState(false);
  const [editingName, setEditingName] = useState(panel.name);
  const [editingDescription, setEditingDescription] = useState(panel.description || '');
  const [showLayoutControls, setShowLayoutControls] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartPosition, setDragStartPosition] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [dragOverZone, setDragOverZone] = useState<'left' | 'right' | 'top' | 'bottom' | 'center' | null>(null);

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
  
  // Geocoding is now owned by AnnotationResultsMap — it kicks the
  // `POST /runs/{rid}/action/geocode` endpoint and subscribes via
  // useActionWatch. PanelRenderer no longer threads stubbed marker state.

  // Use cross-panel highlight state for appropriate panel types
  const highlightLocation = panel.type === 'map' ? mapHighlightLocation : null;
  const highlightTimestamp = panel.type === 'chart' ? chartHighlightTimestamp : null;
  
  // Get run-wide settings from Zustand store — use selectors to avoid unnecessary re-renders
  const dashboardConfig = useAnnotationRunStore(state => state.dashboardConfig);
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
      x: panel.grid_position.x, 
      y: panel.grid_position.y,
      w: panel.grid_position.w,
      h: panel.grid_position.h
    });
    
    // Store panel information in dataTransfer for access by drop target
    const dragData = {
      panelId: panel.id,
      grid_position: panel.grid_position
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

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    
    // Calculate drag over zone for visual feedback
    const rect = e.currentTarget.getBoundingClientRect();
    const dropX = e.clientX - rect.left;
    const dropY = e.clientY - rect.top;
    const relativeX = dropX / rect.width;
    const relativeY = dropY / rect.height;
    
    let zone: 'left' | 'right' | 'top' | 'bottom' | 'center' = 'center';
    
    if (relativeX > 0.6) zone = 'right';
    else if (relativeX < 0.4) zone = 'left';
    else if (relativeY > 0.6) zone = 'bottom';
    else if (relativeY < 0.4) zone = 'top';
    
    setDragOverZone(zone);
  };

  const handleDragLeave = () => {
    setDragOverZone(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const dragDataStr = e.dataTransfer.getData('text/plain');
    
    try {
      const dragData = JSON.parse(dragDataStr);
      const draggedPanelId = dragData.panelId;
      const draggedPanelGridPos = dragData.grid_position;
      
      if (draggedPanelId && draggedPanelId !== panel.id && draggedPanelGridPos) {
        const targetPos = { x: panel.grid_position.x, y: panel.grid_position.y };
        
        // Get the bounds of the drop target
        const rect = e.currentTarget.getBoundingClientRect();
        const dropX = e.clientX - rect.left;
        const dropY = e.clientY - rect.top;
        const relativeX = dropX / rect.width;
        const relativeY = dropY / rect.height;
        
        // Determine if we should place side-by-side or swap
        const targetPanel = panel;
        const targetWidth = targetPanel.grid_position.w;
        const targetHeight = targetPanel.grid_position.h;
        
        let newPosition = { x: targetPos.x, y: targetPos.y };
        let shouldSwap = false;
        
        // If dropping on the right half, try to place to the right
        if (relativeX > 0.6 && targetPos.x + targetWidth < 12) {
          const spaceToRight = 12 - (targetPos.x + targetWidth);
          if (spaceToRight >= Math.min(draggedPanelGridPos.w, 3)) { // Use dragged panel's width or minimum
            newPosition = {
              x: targetPos.x + targetWidth,
              y: targetPos.y
            };
          } else {
            shouldSwap = true;
          }
        }
        // If dropping on the left half, try to place to the left  
        else if (relativeX < 0.4 && targetPos.x >= Math.min(draggedPanelGridPos.w, 3)) {
          newPosition = {
            x: Math.max(0, targetPos.x - draggedPanelGridPos.w),
            y: targetPos.y
          };
        }
        // If dropping on the bottom half, try to place below
        else if (relativeY > 0.6) {
          newPosition = {
            x: targetPos.x,
            y: targetPos.y + targetHeight
          };
        }
        // If dropping on the top half, try to place above
        else if (relativeY < 0.4) {
          newPosition = {
            x: targetPos.x,
            y: Math.max(0, targetPos.y - draggedPanelGridPos.h)
          };
        }
        // Otherwise, swap positions (default behavior)
        else {
          shouldSwap = true;
        }
        
        if (shouldSwap) {
          newPosition = targetPos;
          // Move the target panel to where the dragged panel was
          onUpdatePanel(panel.id, {
            grid_position: {
              ...panel.grid_position,
              x: draggedPanelGridPos.x,
              y: draggedPanelGridPos.y,
            }
          });
        }
        
        // Update the dragged panel's position (keep its original size)
        onUpdatePanel(draggedPanelId, {
          grid_position: {
            x: newPosition.x,
            y: newPosition.y,
            w: draggedPanelGridPos.w, // Keep original width
            h: draggedPanelGridPos.h, // Keep original height
          }
        });
      }
    } catch (error) {
      console.warn('Failed to parse drag data:', error);
    }
  };

  // Panels now self-fetch with server-side filtering via useAnnotationView
  const filteredResults = allResults;

  // Filter UI uses its own shape (``FilterSet { logic, rules[] }``) because
  // it was built before the backend adopted the flat ``{path, operator, value}``
  // FieldCondition shape. Persist the UI state opaquely in panel settings so
  // users don't lose their rules, AND translate to the backend shape on every
  // change so ``local_filters`` actually drives the ``/view`` query. The
  // picker emits paths with ``[*]`` for array-item fields natively, so the
  // translation is a 1:1 passthrough at save time.
  //
  // Migration shim for filters authored before the picker emitted ``[*]``
  // natively: walk the schema, inject ``[*]`` at the first array node in the
  // stored path so the Select renders a match and the backend query still
  // fans over the array. Idempotent on already-normalized paths.
  const migrateLegacyPath = useCallback((path: string, schemaId?: number): string => {
    if (!path || path.includes('[*]') || !schemaId) return path;
    const schema = allSchemas.find((s) => s.id === schemaId);
    const props = (schema?.output_contract as any)?.properties;
    if (!props || typeof props !== 'object') return path;
    const parts = path.split('.');
    const out: string[] = [];
    let cursor: any = props;
    for (let i = 0; i < parts.length; i++) {
      const key = parts[i];
      const node = cursor?.[key];
      if (!node) { out.push(...parts.slice(i)); break; }
      if (node.type === 'array') {
        out.push(`${key}[*]`);
        const items = node.items;
        if (items?.type === 'object' && items.properties) {
          cursor = items.properties;
        } else {
          out.push(...parts.slice(i + 1));
          break;
        }
      } else {
        out.push(key);
        if (node.type === 'object' && node.properties) cursor = node.properties;
        else { out.push(...parts.slice(i + 1)); break; }
      }
    }
    return out.join('.');
  }, [allSchemas]);

  const migratedFilterSet = useMemo<FilterSet | undefined>(() => {
    const raw = panel.settings?.filterUIState as FilterSet | undefined;
    if (!raw) return undefined;
    let changed = false;
    const rules = (raw.rules ?? []).map((r) => {
      if (!r.fieldKey) return r;
      const next = migrateLegacyPath(r.fieldKey, r.schemaId);
      if (next !== r.fieldKey) changed = true;
      return changed && next !== r.fieldKey ? { ...r, fieldKey: next } : r;
    });
    return changed ? { ...raw, rules } : raw;
  }, [panel.settings?.filterUIState, migrateLegacyPath]);

  const handleFilterChange = (newFilterSet: FilterSet) => {
    const conditions = (newFilterSet.rules ?? [])
      .filter((rule) => rule.isActive !== false && rule.fieldKey)
      .map((rule) => ({
        path: migrateLegacyPath(rule.fieldKey!, rule.schemaId),
        operator: FILTER_UI_OP_TO_BACKEND[rule.operator] ?? 'eq',
        value: rule.value,
      }));

    onUpdatePanel(panel.id, {
      local_filters: { logic: newFilterSet.logic ?? 'and', conditions },
      settings: {
        ...(panel.settings ?? {}),
        filterUIState: newFilterSet,
      },
    } as any);
  };

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
      const currentGridPos = panel.grid_position || { x: 0, y: 0, w: 6, h: 4 };
      
      onUpdatePanel(panel.id, { 
        grid_position: { 
          ...currentGridPos,
          w: clampedWidth 
        } 
      });
    } catch (error) {
      console.warn('Error updating panel width:', error);
    }
  };

  const handleHeightChange = (newHeight: number) => {
    try {
      const clampedHeight = Math.max(MIN_HEIGHT, newHeight);
      const currentGridPos = panel.grid_position || { x: 0, y: 0, w: 6, h: 4 };
      
      onUpdatePanel(panel.id, { 
        grid_position: { 
          ...currentGridPos,
          h: clampedHeight 
        } 
      });
    } catch (error) {
      console.warn('Error updating panel height:', error);
    }
  };

  const handleQuickSize = (size: 'small' | 'medium' | 'large' | 'full') => {
    const sizeMap = {
      small: { w: 4, h: 3 },
      medium: { w: 6, h: 4 },
      large: { w: 8, h: 5 },
      full: { w: 12, h: 6 }
    };
    
    const newSize = sizeMap[size];
    onUpdatePanel(panel.id, { 
      grid_position: { ...panel.grid_position, ...newSize } 
    });
    toast.success(`Panel resized to ${size}`);
  };

  const handleResetLayout = () => {
    onUpdatePanel(panel.id, { 
      grid_position: { x: 0, y: 0, w: 12, h: 4 } 
    });
    toast.success('Panel layout reset');
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
                  onResultSelect={onResultSelect}
                  onRetrySingleResult={onRetrySingleResult}
                  retryingResultId={retryingResultId}
                  onTimestampClick={onTimestampClick ? (timestamp, fieldKey) => onTimestampClick(timestamp, fieldKey, panel.id) : undefined}
                  onLocationClick={onLocationClick ? (location, fieldKey) => onLocationClick(location, fieldKey, panel.id) : undefined}
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
                  showControls={!isCollapsed}
                  onResultSelect={onResultSelect}
                  onFieldInteraction={onFieldInteraction}
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
                  showControls={!isCollapsed}
                  onResultSelect={onResultSelect}
                  onFieldInteraction={onFieldInteraction}
                  onScopeGesture={handleScopeGesture}
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
                  onPointClick={onMapPointClick}
                  onResultSelect={onResultSelect}
                  highlightLocation={highlightLocation}
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
                  onResultSelect={onResultSelect}
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

  return (
    <PanelHeaderSlotProvider>
    <div
      className={cn(
        "flex flex-col relative group transition-all duration-200 h-full rounded-sm w-full overflow-y-auto",
        "border",
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
          
          {/* Top Drop Zone */}
          {dragOverZone === 'top' && (
            <div className="absolute top-0 left-0 w-full h-1 bg-primary/60 rounded-t-lg z-30 animate-pulse" />
          )}
          
          {/* Bottom Drop Zone */}
          {dragOverZone === 'bottom' && (
            <div className="absolute bottom-0 left-0 w-full h-1 bg-primary/60 rounded-b-lg z-30 animate-pulse" />
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
          className="absolute top-0 left-1/2 transform -translate-x-1/2 w-8 h-3 cursor-move z-20"
          draggable
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          aria-label="Drag panel"
        />
      )}

      {/* Resize target — bottom-right invisible corner. Same pattern as
          the drag target: cursor change carries the affordance. */}
      {!isCollapsed && !focusMode && (
        <div
          className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize z-10"
          aria-label="Resize panel"
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation(); // Prevent drag start when resizing
          const startX = e.clientX;
          const startY = e.clientY;
          const startWidth = panel.grid_position.w;
          const startHeight = panel.grid_position.h;
          
          // Get the grid container to calculate actual grid cell size
          const gridContainer = e.currentTarget.closest('[style*="grid"]') as HTMLElement;
          let gridCellWidth = 100; // fallback
          let gridCellHeight = 150; // fallback
          
          if (gridContainer) {
            const containerRect = gridContainer.getBoundingClientRect();
            gridCellWidth = containerRect.width / 12; // 12 columns
            gridCellHeight = 150; // Fixed row height from the CSS
          }
          
          const handleMouseMove = (e: MouseEvent) => {
            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;
            
            // Calculate new size based on actual grid cell dimensions
            const widthChange = Math.round(deltaX / gridCellWidth);
            const heightChange = Math.round(deltaY / gridCellHeight);
            
            const newWidth = Math.max(MIN_WIDTH, Math.min(GRID_COLUMNS, startWidth + widthChange));
            const newHeight = Math.max(MIN_HEIGHT, startHeight + heightChange);
            
            // Only update if the size actually changed to prevent unnecessary updates
            if (newWidth !== panel.grid_position.w || newHeight !== panel.grid_position.h) {
              handleWidthChange(newWidth);
              handleHeightChange(newHeight);
            }
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

      {!focusMode && (
      <div className="flex flex-row items-center justify-between border-b px-2 py-1 flex-shrink-0">
        {/* Panel Name */}
        <div className="flex items-center gap-1.5 min-w-0 flex-shrink-1">
          <div className="flex items-center gap-1 min-w-0">
            <span className="text-xs font-semibold truncate">{panel.name}</span>
          </div>
          {/* Inline description hint */}
          {panel.description && !isEditingMetadata && (
            <span className="text-[10px] text-muted-foreground truncate max-w-[200px] hidden sm:inline" title={panel.description}>
              {panel.description}
            </span>
          )}
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
        </div>

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

        

        {/* Panel controls */}
        <div className="flex items-center ml-1 flex-shrink-0">
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
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">
                  <LayoutPanelTop className="h-3 w-3" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-3" align="end" side="bottom">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium text-xs">Panel Layout</h4>
                    <span className="text-[10px] text-muted-foreground">
                      {panel.grid_position.w} × {panel.grid_position.h}
                    </span>
                  </div>

                  {/* Quick Size Buttons */}
                  <div>
                    <Label className="text-[10px] text-muted-foreground mb-1.5 block">Quick Sizes</Label>
                    <div className="grid grid-cols-2 gap-1.5">
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => handleQuickSize('small')}>
                        Small (4×3)
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => handleQuickSize('medium')}>
                        Medium (6×4)
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => handleQuickSize('large')}>
                        Large (8×5)
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => handleQuickSize('full')}>
                        Full (12×6)
                      </Button>
                    </div>
                  </div>

                  {/* Manual Size Controls */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label htmlFor="panel-width" className="text-[10px] text-muted-foreground">Width</Label>
                      <Select value={panel.grid_position.w.toString()} onValueChange={(v) => handleWidthChange(parseInt(v))}>
                        <SelectTrigger className="h-7 text-xs">
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
                      <Select value={panel.grid_position.h.toString()} onValueChange={(v) => handleHeightChange(parseInt(v))}>
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: 10 }, (_, i) => i + MIN_HEIGHT).map(h => (
                            <SelectItem key={h} value={h.toString()}>
                              {h} units
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
        </div>
      </div>
      )}

      <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
        {/* Main Content */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {renderPanelContent()}
        </div>
      </div>
    </div>
    </PanelHeaderSlotProvider>
  );
}; 