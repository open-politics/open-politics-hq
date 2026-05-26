import { AnnotationRunRead, AnnotationRunCreate, AnnotationRunUpdate, AssetRead, AnnotationSchemaRead } from '@/client';
import type {
  FilterSet as ClientFilterSet,
  Formula as ClientFormula,
  MergeMap,
} from '@/client';
import { RunsService as AnnotationRunsServiceApi } from '@/client';
import { FormattedAnnotation, PanelConfig, Scope } from '@/lib/annotations/types';
import { newInlineStubFormula } from '@/lib/annotations/panelEligibility';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { produce } from 'immer';
import { toast } from 'sonner';
import { nanoid } from 'nanoid';
import { useShareableStore } from './storeShareables';

// Helper types
export interface FilterSet {
  logic: 'and' | 'or';
  rules: any[];
}

// Helper function to deserialize timeAxisConfig dates from JSON
const deserializeTimeAxisConfig = (config: any): any => {
  if (!config || typeof config !== 'object') return config;
  
  if (config.timeFrame && typeof config.timeFrame === 'object') {
    const timeFrame = { ...config.timeFrame };
    
    // Convert string dates back to Date objects
    if (timeFrame.startDate && typeof timeFrame.startDate === 'string') {
      try {
        timeFrame.startDate = new Date(timeFrame.startDate);
      } catch (error) {
        console.warn('Failed to parse startDate:', timeFrame.startDate);
        timeFrame.startDate = undefined;
      }
    }
    
    if (timeFrame.endDate && typeof timeFrame.endDate === 'string') {
      try {
        timeFrame.endDate = new Date(timeFrame.endDate);
      } catch (error) {
        console.warn('Failed to parse endDate:', timeFrame.endDate);
        timeFrame.endDate = undefined;
      }
    }
    
    return { ...config, timeFrame };
  }
  
  return config;
};

// Helper function to deserialize entire dashboard config (handles both old and new formats)
const deserializeDashboardConfig = (config: DashboardConfig | null): DashboardConfig | null => {
  if (!config) return null;

  const deserializedConfig = { ...config };

  // Deserialize timeAxisConfig in old panel format settings
  if (deserializedConfig.panels) {
    deserializedConfig.panels = deserializedConfig.panels.map(panel => {
      const settings = (panel as any).settings;
      if (settings?.timeAxisConfig) {
        return {
          ...panel,
          settings: {
            ...settings,
            timeAxisConfig: deserializeTimeAxisConfig(settings.timeAxisConfig)
          }
        };
      }
      return panel;
    });
  }

  return deserializedConfig;
};

// Define shared types for annotation run configuration
export interface MapPointConfig {
  id: string;
  locationString: string;
  coordinates: { latitude: number; longitude: number };
  documentIds: number[];
  bbox?: [number, number, number, number];
  type?: string;
}

export interface GeocodedPointsCache {
  cacheKey: string;
  points: MapPointConfig[];
  timestamp: number;
}

export interface TableConfig {
  columnVisibility?: Record<string, boolean>;
  sorting?: Array<{ id: string; desc: boolean }>;
  pagination?: {
    pageIndex: number;
    pageSize: number;
  };
  globalFilter?: string;
  expanded?: Record<string, boolean>;
}

// Helper function to compact panels by removing gaps in the grid layout
const compactPanels = (panels: PanelConfig[]): PanelConfig[] => {
  if (panels.length === 0) return panels;

  const GRID_COLUMNS = 12;

  // Sort panels by their current position (top to bottom, left to right)
  const sortedPanels = [...panels].sort((a, b) => {
    const aY = a.grid_position?.y || 0;
    const bY = b.grid_position?.y || 0;
    const aX = a.grid_position?.x || 0;
    const bX = b.grid_position?.x || 0;

    if (aY !== bY) {
      return aY - bY;
    }
    return aX - bX;
  });

  // Create a grid to track occupied spaces
  const grid: boolean[][] = [];
  
  // Function to check if a position is available
  const isPositionAvailable = (x: number, y: number, w: number, h: number): boolean => {
    for (let row = y; row < y + h; row++) {
      if (!grid[row]) grid[row] = new Array(GRID_COLUMNS).fill(false);
      for (let col = x; col < x + w; col++) {
        if (col >= GRID_COLUMNS || grid[row][col]) {
          return false;
        }
      }
    }
    return true;
  };

  // Function to mark a position as occupied
  const markPosition = (x: number, y: number, w: number, h: number): void => {
    for (let row = y; row < y + h; row++) {
      if (!grid[row]) grid[row] = new Array(GRID_COLUMNS).fill(false);
      for (let col = x; col < x + w; col++) {
        if (col < GRID_COLUMNS) {
          grid[row][col] = true;
        }
      }
    }
  };

  // Function to find the best available position for a panel
  const findBestPosition = (w: number, h: number): { x: number; y: number } => {
    // Try to place as high and as left as possible
    for (let y = 0; y < 100; y++) { // Reasonable limit to prevent infinite loop
      for (let x = 0; x <= GRID_COLUMNS - w; x++) {
        if (isPositionAvailable(x, y, w, h)) {
          return { x, y };
        }
      }
    }
    
    // Fallback: place at the bottom
    return { x: 0, y: grid.length };
  };

  // Reposition each panel to remove gaps
  const compactedPanels = sortedPanels.map(panel => {
    const w = Math.max(1, Math.min(GRID_COLUMNS, panel.grid_position?.w || 6));
    const h = Math.max(1, panel.grid_position?.h || 4);

    const newPosition = findBestPosition(w, h);
    markPosition(newPosition.x, newPosition.y, w, h);

    return {
      ...panel,
      grid_position: {
        ...panel.grid_position,
        x: newPosition.x,
        y: newPosition.y,
        w,
        h,
      },
    };
  });

  return compactedPanels;
};

// Define the structure for a single panel's configuration
export interface PanelViewConfig {
  id: string; // Unique ID for the panel
  name: string;
  description?: string;
  type: 'table' | 'map' | 'chart' | 'pie' | 'graph';
  filters: FilterSet;
  collapsed?: boolean; // Whether the panel settings are collapsed
  // NEW: Multi-source support for meta-dashboards
  sourceType?: 'run' | 'bundle'; // Default: 'run' (backward compatible)
  sourceId?: number; // run_id or bundle_id
  // Panel-specific settings that persist across sessions
  settings?: {
    // For pie charts
    selectedSchemaId?: number;
    selectedFieldKey?: string;
    selectedMaxSlices?: number;
    aggregateSources?: boolean;
    selectedSourceIds?: number[];
    // For charts  
    timeAxisConfig?: any;
    selectedTimeInterval?: string;
    showStatistics?: boolean;
    selectedSchemaIds?: number[];
    // For maps
    geocodeSource?: { schemaId: number; fieldKey: string };
    labelSource?: { schemaId: number; fieldKey: string };
    showLabels?: boolean;
    showAreas?: boolean; // NEW: Show location bounding boxes
    // NEW: Geocoded points cache for maps
    geocodedPointsCache?: GeocodedPointsCache;
    // For graphs
    selectedGraphSchemaId?: number;
    graphViewConfig?: any; // GraphViewConfig from D3ForceGraph
    // For tables and maps - field selection
    selectedFieldsPerScheme?: Record<number, string[]>;
    // NEW: Table configuration settings
    tableConfig?: TableConfig;
  };
  // Add other panel-specific configurations here
  gridPos: { x: number; y: number; w: number; h: number }; // For react-grid-layout
}

/**
 * Formula — a run-scoped, named, structured-question artifact (the
 * intelligence layer's third primitive — see docs/intelligence/HOW_TO.md).
 *
 * Lives in `DashboardConfig.formulas[]` (JSON on `AnnotationRun.views_config`,
 * no DB table). Carries the six verbs as flat fields — ``group``, ``measures``,
 * ``derives``, ``filter``, ``weight``, ``snippet``, ``order_by``. The backend
 * reads each entry via ``Formula.model_validate(f)`` so the wire shape and
 * the store shape are the same Pydantic ``Formula`` from
 * ``backend/app/api/modules/annotation/formula.py``.
 *
 * Store-side timestamps (``created_at``, ``updated_at``) are stamped by
 * ``addFormula`` / ``updateFormula``; the backend ignores them.
 *
 * The legacy ``projection: any`` field is kept as ``projection?: any`` so
 * pre-cut dashboards don't crash the persist middleware on first load —
 * but new formulas never write it. ``useResolvedProjection`` reads
 * ``projection`` when present (legacy panels) and falls back to the new
 * flat shape (new panels).
 */
export type Formula = ClientFormula & {
  description?: string;
  created_at?: string;
  updated_at?: string;
  /** @deprecated legacy carrier from the PanelProjection era. New formulas
   *  store the body as flat verb fields (``group``, ``measures``, …). */
  projection?: any;
};

/** @deprecated alias for Formula; remove after consumers update. */
export type Observation = Formula;

// Dashboard configuration that gets persisted in the backend
export interface DashboardConfig {
  name: string;
  description?: string;
  layout: {
    type: 'grid';
    columns: number;
  };
  panels: PanelConfig[];
  /** Run-scoped saved Formulas (the intelligence layer's third primitive).
   *  JSON-only for now; lifts into a real table when usage patterns prove out.
   *  Legacy persistence stored these under `observations` — the dashboard
   *  migrator promotes the old key on load. */
  formulas?: Formula[];
  /** Immutable Observation snapshots — frozen outputs of formulas (M5 of
   *  the intelligence-primitive plan). Editing the source Formula does NOT
   *  mutate prior snapshots; re-snapshotting creates a new one. */
  observations?: import('@/lib/annotations/types').ObservationSnapshot[];
  /** Dossier note (markdown). Supports @cite[obs_id, key:(...)] markers. */
  notes_md?: string;
  // NEW: Run-wide settings that apply to all panels
  runWideSettings?: {
    // Global variable splitting configuration (shared across all panels)
    globalVariableSplitting?: {
      enabled: boolean;
      schemaId?: number;
      fieldKey?: string;
      visibleSplits?: string[]; // Convert Set to array for serialization
      maxSplits?: number;
      groupOthers?: boolean;
      valueAliases?: Record<string, string[]>; // Legacy field-agnostic mapping (kept for back-compat)
      /**
       * Per-field value aliases. Preferred shape — keyed by backend field
       * path (e.g. "document.party"), value is canonical → raw-names list.
       * The ValueAliasManager writes here; every panel hydrates its
       * `merge_maps` /view param from this map keyed on the panel's
       * primary categorical axis.
       */
      valueAliasesByField?: Record<string, Record<string, string[]>>;
    };
    // Global time axis preferences
    defaultTimeInterval?: 'day' | 'week' | 'month' | 'quarter' | 'year';
    // Global source aggregation preference
    defaultAggregateSourcesMode?: boolean;
    // Global schema visibility
    defaultSelectedSchemaIds?: number[];
  };
}

/** Detect and migrate old PanelViewConfig format to PanelConfig */
function migratePanelIfNeeded(panel: any): PanelConfig {
  // Already a PanelConfig — backfill any missing required fields defensively.
  // `inspection_granularity` is intentionally dropped; legacy panels with it
  // set drop the field on first rehydration.
  if (panel.projection && panel.local_filters) {
    const { inspection_granularity: _drop, ...rest } = panel;
    return {
      ...rest,
      aggregation: panel.aggregation || {},
      incoming_scopes: panel.incoming_scopes || [],
      merge_maps: panel.merge_maps || [],
      settings: panel.settings || {},
    } as PanelConfig;
  }

  // Old PanelViewConfig — has filters with rules and settings bag.
  // After P2/P3, the new Panel shape requires formula/fields/panel_config/
  // scopes_in. We cast to any to bypass strict typing here since this
  // migration path returns intentionally incomplete records on legacy
  // data; the loaded panel goes through the migration sweep right after
  // and addPanel handles the population.
  const old = panel as PanelViewConfig;
  return {
    id: old.id,
    type: old.type,
    name: old.name,
    description: old.description,
    formula: null as any,
    fields: [],
    panel_config: { kind: old.type } as any,
    scopes_in: [],
    projection: { field_mappings: {}, explosion: null },
    aggregation: {},
    local_filters: { logic: 'and', conditions: [] },
    incoming_scopes: [],
    merge_maps: [],
    grid_position: old.gridPos || { x: 0, y: 0, w: 6, h: 4 },
    collapsed: old.collapsed,
    settings: old.settings,
  } as any;
}

/** Migrate an entire dashboard config, converting any old panels and
 *  promoting legacy `observations[]` (which were saved-projections, the
 *  thing we now call Formulas) into `formulas[]`. The legacy
 *  `observation_id` key on a panel is also rewritten to `formula_id`.
 *  This is a forward-only migration; persisted configs catch up to the
 *  new shape on the next dashboard save. */
function migrateDashboardConfig(raw: any): DashboardConfig {
  const config = raw as DashboardConfig;
  if (config.panels) {
    config.panels = config.panels.map(migratePanelIfNeeded);
  }
  // Promote legacy `observations[]` (saved-projections) → `formulas[]`.
  // Only when `formulas[]` is absent or empty so we don't clobber a
  // forward-migrated config that happens to still carry the legacy key
  // (e.g. partial frontend rollout).
  const cfgAny = config as any;
  const legacyObs: any[] | undefined = cfgAny.observations;
  if (legacyObs && legacyObs.length > 0 && !(config.formulas && config.formulas.length > 0)) {
    // Heuristic: legacy observations are saved-projections — they have a
    // `projection` field. Snapshot-shaped observations (the M5 primitive)
    // have `formula_inline` / `output_blob`. Only the saved-projection
    // shape should migrate to formulas[]; snapshots stay in observations[].
    const looksLikeSavedProjection = (o: any) => o && typeof o === 'object' && 'projection' in o && !('formula_inline' in o);
    const toFormulas = legacyObs.filter(looksLikeSavedProjection);
    const remaining = legacyObs.filter(o => !looksLikeSavedProjection(o));
    if (toFormulas.length > 0) {
      config.formulas = toFormulas;
      cfgAny.observations = remaining;
    }
  }
  // Promote legacy `panel.observation_id` → `panel.formula_id`.
  if (config.panels) {
    for (const p of config.panels as any[]) {
      if (p && typeof p === 'object' && 'observation_id' in p && !('formula_id' in p)) {
        p.formula_id = p.observation_id;
      }
    }
  }
  return config;
}

/**
 * Fire-and-forget dashboard auto-save. Reads ``activeRun`` from the store
 * and calls ``saveDashboardToBackend`` if both ids are known. Debounced via
 * a module-level timer so a burst of formula CRUD (e.g. agent edits across
 * multiple turns) collapses to a single backend write.
 *
 * Errors surface via the existing toast in ``saveDashboardToBackend``; the
 * caller doesn't need to await.
 */
let _autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
function _autoSaveDashboard(get: () => AnnotationRunState): void {
    if (_autoSaveTimer) clearTimeout(_autoSaveTimer);
    _autoSaveTimer = setTimeout(() => {
        const { activeRun, saveDashboardToBackend } = get();
        if (!activeRun) return;
        const infospaceId = (activeRun as any).infospace_id;
        if (!infospaceId) return;
        saveDashboardToBackend(infospaceId, activeRun.id).catch(() => {
            // Toast already handled inside the action.
        });
    }, 400);
}

interface AnnotationRunState {
  runs: AnnotationRunRead[];
  isLoading: boolean;
  error: string | null;
  activeRunId: number | null;
  fetchRuns: (infospaceId: number) => Promise<void>;
  createRun: (infospaceId: number, params: any) => Promise<AnnotationRunRead | null>;
  updateRun: (infospaceId: number, runId: number, updates: Partial<AnnotationRunUpdate>) => Promise<AnnotationRunRead | null>;
  deleteRun: (infospace_id: number, runId: number) => Promise<void>;
  selectRun: (runId: number | null) => void;
  retryRunFailures: (infospaceId: number, runId: number) => Promise<void>;
  exportAnnotationRun: (infospaceId: number, runId: number) => Promise<void>;
  importAnnotationRun: (infospaceId: number, file: File) => Promise<AnnotationRunRead | null>;

  // Dashboard persistence
  saveDashboardToBackend: (infospaceId: number, runId: number) => Promise<void>;
  loadDashboardFromRun: (run: AnnotationRunRead) => void;

  // Dashboard state
  activeRun: AnnotationRunRead | null;
  /** @deprecated — panels now self-fetch via useAnnotationView. Kept for migration. */
  currentRunResults: FormattedAnnotation[];
  isProcessing: boolean;
  dashboardConfig: DashboardConfig | null;
  isDashboardDirty: boolean;
  setActiveRun: (run: AnnotationRunRead | null) => void;
  /** Shallow-patch activeRun without recomputing dashboardConfig. Used by the
   *  presence-stream handler for live progress_current / progress_total / status
   *  updates so we avoid a full re-fetch on every event. */
  patchActiveRun: (updates: Partial<AnnotationRunRead>) => void;
  /** @deprecated — panels now self-fetch via useAnnotationView */
  setCurrentRunResults: (results: FormattedAnnotation[]) => void;
  setIsProcessing: (processing: boolean) => void;
  setDashboardConfig: (config: DashboardConfig | null) => void;
  updateDashboardConfig: (config: Partial<DashboardConfig>) => void;
  addPanel: (panel: { type: PanelConfig['type']; name: string; description?: string; settings?: any; formula_ref?: string | null }) => void;
  updatePanel: (panelId: string, updates: Partial<PanelConfig>) => void;
  removePanel: (panelId: string) => void;
  compactLayout: () => void;
  setDashboardDirty: (isDirty: boolean) => void;

  // Scope management
  addScope: (targetPanelId: string, scope: Scope) => void;
  removeScope: (targetPanelId: string, scopeId: string) => void;
  updateScope: (targetPanelId: string, scopeId: string, updates: Partial<Scope>) => void;
  /** Update all scopes originating from a source panel (for live-linked propagation) */
  updateScopesFromSource: (sourcePanelId: string, newFilter: ClientFilterSet, newLabel: string) => void;

  // Formula CRUD (run-scoped, lives in dashboardConfig.formulas)
  addFormula: (data: Omit<Formula, 'id' | 'created_at' | 'updated_at'>) => Formula | null;
  updateFormula: (id: string, updates: Partial<Omit<Formula, 'id' | 'created_at'>>) => void;
  removeFormula: (id: string) => void;
  getFormula: (id: string) => Formula | null;

  /** Promote a panel's inline Formula to a named entry in the intelligence
   *  formula list. After this, ``panel.formula_id`` refers to the saved
   *  Formula and ``panel.formula_inline`` is cleared. Used when the user
   *  wants to cite, compose, or reuse the panel's formula elsewhere. */
  promotePanelFormula: (panelId: string, name?: string) => void;
  /** Inverse of promote: copy the saved Formula referenced by
   *  ``panel.formula_id`` back into ``panel.formula_inline`` and clear the
   *  saved-id binding. Used to detach a panel from the shared formula so
   *  edits don't propagate to other panels. */
  detachPanelFormula: (panelId: string) => void;
  /** @deprecated use addFormula */
  addObservation?: (data: Omit<Formula, 'id' | 'created_at' | 'updated_at'>) => Formula | null;
  /** @deprecated use updateFormula */
  updateObservation?: (id: string, updates: Partial<Omit<Formula, 'id' | 'created_at'>>) => void;
  /** @deprecated use removeFormula */
  removeObservation?: (id: string) => void;
  /** @deprecated use getFormula */
  getObservation?: (id: string) => Formula | null;

  // Run-wide settings management
  updateRunWideSettings: (updates: Partial<NonNullable<DashboardConfig['runWideSettings']>>) => void;
  getGlobalVariableSplitting: () => NonNullable<DashboardConfig['runWideSettings']>['globalVariableSplitting'] | null;
  setGlobalVariableSplitting: (config: NonNullable<DashboardConfig['runWideSettings']>['globalVariableSplitting']) => void;

  // Focus mode — hides the dashboard-level header and every per-panel header
  // bar so panels get the full canvas. UI-only flag; not persisted, not part
  // of dashboardConfig (so it never leaks into views_config on save).
  focusMode: boolean;
  toggleFocusMode: () => void;
  setFocusMode: (value: boolean) => void;
}

export const useAnnotationRunStore = create<AnnotationRunState>()(
  persist(
    (set, get) => ({
        runs: [],
        isLoading: false,
        error: null,
        activeRunId: null,

        fetchRuns: async (infospaceId) => {
            if (!infospaceId) return;
            set({ isLoading: true, error: null });
            try {
                const response = await AnnotationRunsServiceApi.listRuns({ infospaceId, limit: 1000 });
                set({ runs: response.data, isLoading: false });
            } catch (error: any) {
                const errorMsg = error.body?.detail || 'Failed to fetch annotation runs.';
                set({ error: errorMsg, isLoading: false });
                toast.error(errorMsg);
            }
        },

        createRun: async (infospaceId, params) => {
            set({ isLoading: true });
            try {
                const newRun = await AnnotationRunsServiceApi.createRun({ infospaceId, requestBody: params });
                set(produce((state: AnnotationRunState) => {
                    state.runs.unshift(newRun);
                }));
                toast.success(`Run '${newRun.name}' created successfully.`);
                return newRun;
            } catch (error: any) {
                const errorMsg = error.body?.detail || 'Failed to create annotation run.';
                set({ error: errorMsg, isLoading: false });
                toast.error(errorMsg);
                return null;
            } finally {
                set({ isLoading: false });
            }
        },

        updateRun: async (infospaceId, runId, updates) => {
            set({ isLoading: true, error: null });
            try {
                const updatedRun = await AnnotationRunsServiceApi.updateRun({ infospaceId, runId, requestBody: updates });
                set(produce((state: AnnotationRunState) => {
                    const index = state.runs.findIndex(run => run.id === runId);
                    if (index !== -1) {
                        state.runs[index] = updatedRun;
                    }
                }));
                toast.success(`Run '${updatedRun.name}' updated successfully.`);
                return updatedRun;
            } catch (error: any) {
                const errorMsg = error.body?.detail || 'Failed to update annotation run.';
                set({ error: errorMsg, isLoading: false });
                toast.error(errorMsg);
                return null;
            } finally {
                set({ isLoading: false });
            }
        },

        deleteRun: async (infospaceId, runId) => {
            set({ isLoading: true, error: null });
            try {
                await AnnotationRunsServiceApi.deleteRun({ infospaceId, runId });
                set(produce((state: AnnotationRunState) => {
                    state.runs = state.runs.filter(run => run.id !== runId);
                    if (state.activeRunId === runId) {
                        state.activeRunId = null;
                    }
                }));
                toast.success('Run deleted successfully.');
            } catch (error: any) {
                const errorMsg = error.body?.detail || 'Failed to delete annotation run.';
                set({ error: errorMsg, isLoading: false });
                toast.error(errorMsg);
            } finally {
                set({ isLoading: false });
            }
        },

        selectRun: (runId) => {
            set({ activeRunId: runId });
        },

        retryRunFailures: async (infospaceId, runId) => {
            set({ isLoading: true, error: null });
            try {
                await AnnotationRunsServiceApi.retryFailedAnnotations({ infospaceId, runId });
                toast.success('Retry initiated for failed annotations.');
            } catch (error: any) {
                const errorMsg = error.body?.detail || 'Failed to retry failed annotations.';
                set({ error: errorMsg, isLoading: false });
                toast.error(errorMsg);
            } finally {
                set({ isLoading: false });
            }
        },

        exportAnnotationRun: async (infospaceId, runId) => {
            try {
                // Use the existing shareable store export functionality
                const { exportResource } = useShareableStore.getState();
                await exportResource('run', runId, infospaceId);
                toast.success('Annotation run export started.');
            } catch (error: any) {
                const errorMsg = error.body?.detail || 'Failed to export annotation run.';
                toast.error(errorMsg);
            }
        },

        importAnnotationRun: async (infospaceId, file) => {
            set({ isLoading: true, error: null });
            try {
                // This would need to be implemented based on the import functionality
                toast.success('Import functionality not yet implemented.');
                return null;
            } catch (error: any) {
                const errorMsg = error.body?.detail || 'Failed to import annotation run.';
                set({ error: errorMsg, isLoading: false });
                toast.error(errorMsg);
                return null;
            } finally {
                set({ isLoading: false });
            }
        },

        // Dashboard state management
        activeRun: null,
        currentRunResults: [],
        isProcessing: false,
        dashboardConfig: null,
        isDashboardDirty: false,

        setActiveRun: (run) => {
            // Only rebuild dashboardConfig when the RUN IDENTITY changes (null → id,
            // id → different id, or id → null). Progress/status updates from the
            // SSE + polling path call setActiveRun repeatedly on the same id; if
            // we rebuilt the config each time, every panel would re-mount, losing
            // useAnnotationView's cached `data` and flashing empty-state between
            // incremental commits.
            const prevRunId = get().activeRun?.id ?? null;
            const nextRunId = run?.id ?? null;
            set({ activeRun: run });
            if (prevRunId === nextRunId) return;

            if (run) {
                if (run.views_config && run.views_config.length > 0) {
                    const rawConfig = run.views_config[0] as unknown as DashboardConfig;
                    const config = migrateDashboardConfig(deserializeDashboardConfig(rawConfig) || rawConfig);
                    set({ dashboardConfig: config, isDashboardDirty: false });
                } else {
                    const defaultConfig: DashboardConfig = {
                        name: `Dashboard for ${run.name}`,
                        description: `Analytics dashboard for annotation run: ${run.name}`,
                        layout: { type: 'grid', columns: 12 },
                        panels: [],
                    };
                    set({ dashboardConfig: defaultConfig, isDashboardDirty: false });
                }
            } else {
                set({ dashboardConfig: null, isDashboardDirty: false });
            }
        },

        patchActiveRun: (updates) => {
            set(produce((state: AnnotationRunState) => {
                if (state.activeRun) {
                    Object.assign(state.activeRun, updates);
                }
            }));
        },

        setCurrentRunResults: (results) => {
            set({ currentRunResults: results });
        },

        setIsProcessing: (processing) => {
            set({ isProcessing: processing });
        },

        setDashboardConfig: (config) => {
            set({ dashboardConfig: config, isDashboardDirty: false });
        },

        updateDashboardConfig: (configUpdates) => {
            set(produce((state: AnnotationRunState) => {
                if (state.dashboardConfig) {
                    Object.assign(state.dashboardConfig, configUpdates);
                    state.isDashboardDirty = true;
                }
            }));
        },

        addPanel: (panelData) => {
            set(produce((state: AnnotationRunState) => {
                if (state.dashboardConfig) {
                    const GRID_COLUMNS = 12;
                    const existingPanels = state.dashboardConfig.panels || [];

                    // Find best position in the grid
                    const grid: boolean[][] = [];
                    let maxY = 0;
                    existingPanels.forEach(panel => {
                        if (!panel?.grid_position) return;
                        const { x, y, w, h } = panel.grid_position;
                        const safeX = Math.max(0, Math.min(GRID_COLUMNS - 1, x || 0));
                        const safeY = Math.max(0, y || 0);
                        const safeW = Math.max(1, Math.min(GRID_COLUMNS - safeX, w || 1));
                        const safeH = Math.max(1, h || 1);
                        maxY = Math.max(maxY, safeY + safeH);
                        for (let row = safeY; row < safeY + safeH; row++) {
                            if (!grid[row]) grid[row] = new Array(GRID_COLUMNS).fill(false);
                            for (let col = safeX; col < safeX + safeW; col++) {
                                if (col < GRID_COLUMNS) grid[row][col] = true;
                            }
                        }
                    });

                    const findPos = (w: number, h: number) => {
                        for (let y = 0; y <= maxY + h; y++) {
                            for (let x = 0; x <= GRID_COLUMNS - w; x++) {
                                let ok = true;
                                for (let r = y; r < y + h && ok; r++) {
                                    if (!grid[r]) grid[r] = new Array(GRID_COLUMNS).fill(false);
                                    for (let c = x; c < x + w && ok; c++) {
                                        if (grid[r][c]) ok = false;
                                    }
                                }
                                if (ok) return { x, y };
                            }
                        }
                        return { x: 0, y: maxY };
                    };

                    const defaultSizes: Record<string, { w: number; h: number }> = {
                        table: { w: 12, h: 6 },
                        chart: { w: 8, h: 5 },
                        pie: { w: 6, h: 4 },
                        map: { w: 8, h: 6 },
                        graph: { w: 10, h: 6 },
                    };

                    const size = defaultSizes[panelData.type] || { w: 6, h: 4 };
                    const position = findPos(size.w, size.h);

                    const panelId = nanoid();

                    // Empty Formula — RolePicker fills in filter/group/measures
                    // as the user picks roles. Carries no schema yet (user
                    // picks one via PanelConfigPopover).
                    const emptyFormula = {
                        id: `${panelId}_f`,
                        name: panelData.name,
                        description: undefined,
                        schema_id: null,
                        explosion: null,
                        filter: { logic: 'and' as const, conditions: [] },
                        merge_maps: [],
                        group: [],
                        weight: null,
                        measures: [],
                        derives: [],
                        snippet: null,
                        output_keys: [],
                        order_by: null,
                        version: 1 as const,
                    };

                    // Per-type default panel_config — every role slot empty,
                    // display knobs at sensible defaults. The RolePicker /
                    // PanelConfigPopover writes these as the user configures.
                    const defaultCfg = (() => {
                        const t = panelData.type;
                        if (t === 'pie') return { kind: 'pie', slice_by: null, value: null, facet: null, max_slices: null, legend: true };
                        if (t === 'chart') return { kind: 'chart', x: null, y: [], color: null, mark: 'timeline', stacked: false, analytics_overlays: {}, show_statistics: false };
                        if (t === 'map') return { kind: 'map', position: null, mode: 'markers', color: null, label: [], geocode_source: null, show_labels: true, show_areas: false };
                        if (t === 'table') return { kind: 'table', columns: [], explode: null, sort: null, density: 'comfortable' };
                        if (t === 'graph') return { kind: 'graph', source: null, target: null, edge_label: null, edge_weight_field: null, edge_weight_mode: 'count', forward_properties: [], node_group_by: null, edge_group_by: null, null_policy: 'skip', layout: { kind: 'force_directed', params: {} }, dim_unmatched: true, edits: null };
                        if (t === 'measurements') return { kind: 'measurements', display_mode: 'scalar', label: null };
                        if (t === 'scatter') return { kind: 'scatter', x: null, y: null, color: null, size: null, mark: 'dot', legend: true };
                        return { kind: t };
                    })();

                    const newPanel: PanelConfig = {
                        id: panelId,
                        type: panelData.type,
                        name: panelData.name,
                        description: panelData.description,
                        formula: emptyFormula as any,
                        formula_ref: panelData.formula_ref ?? null,
                        fields: [],
                        panel_config: defaultCfg as any,
                        time_source: null,
                        scopes_in: [],
                        merge_maps: [],
                        collapsed: false,
                        // Legacy compat — empty defaults, removed in P6.
                        projection: { field_mappings: {}, explosion: null },
                        aggregation: {},
                        local_filters: { logic: 'and', conditions: [] },
                        settings: panelData.settings || {},
                        formula_id: (panelData as any).formula_id ?? null,
                        observation_id: (panelData as any).observation_id ?? null,
                        formula_inline: (panelData as any).formula_inline ?? null,
                        grid_position: {
                            x: Math.max(0, Math.min(11, position.x)),
                            y: Math.max(0, position.y),
                            w: Math.max(1, Math.min(12, size.w)),
                            h: Math.max(1, size.h),
                        },
                    };

                    state.dashboardConfig.panels.push(newPanel);
                    state.isDashboardDirty = true;
                }
            }));
        },

        updatePanel: (panelId, updates) => {
            set(produce((state: AnnotationRunState) => {
                if (state.dashboardConfig) {
                    const panelIndex = state.dashboardConfig.panels.findIndex(p => p.id === panelId);
                    if (panelIndex !== -1) {
                        const currentPanel = state.dashboardConfig.panels[panelIndex];

                        const updatedPanel: PanelConfig = {
                            ...currentPanel,
                            ...updates,
                            grid_position: updates.grid_position
                                ? {
                                    x: Math.max(0, Math.min(11, updates.grid_position.x ?? currentPanel.grid_position.x)),
                                    y: Math.max(0, updates.grid_position.y ?? currentPanel.grid_position.y),
                                    w: Math.max(1, Math.min(12, updates.grid_position.w ?? currentPanel.grid_position.w)),
                                    h: Math.max(1, updates.grid_position.h ?? currentPanel.grid_position.h),
                                }
                                : currentPanel.grid_position,
                            settings: updates.settings
                                ? { ...currentPanel.settings, ...updates.settings }
                                : currentPanel.settings,
                            local_filters: updates.local_filters
                                ? { ...currentPanel.local_filters, ...updates.local_filters }
                                : currentPanel.local_filters,
                            incoming_scopes: updates.incoming_scopes ?? currentPanel.incoming_scopes,
                            merge_maps: updates.merge_maps ?? currentPanel.merge_maps,
                        };

                        state.dashboardConfig.panels[panelIndex] = updatedPanel;
                        state.isDashboardDirty = true;
                    }
                }
            }));
        },

        removePanel: (panelId) => {
            set(produce((state: AnnotationRunState) => {
                if (state.dashboardConfig) {
                    // Remove the panel
                    state.dashboardConfig.panels = state.dashboardConfig.panels.filter(p => p.id !== panelId);
                    
                    // Compact the grid layout to remove gaps
                    state.dashboardConfig.panels = compactPanels(state.dashboardConfig.panels);
                    
                    state.isDashboardDirty = true;
                }
            }));
        },

        setDashboardDirty: (isDirty) => {
            set({ isDashboardDirty: isDirty });
        },

        // Dashboard persistence methods
        saveDashboardToBackend: async (infospaceId, runId) => {
            const { dashboardConfig } = get();
            if (!dashboardConfig) return;
            
            try {
                await AnnotationRunsServiceApi.updateRun({
                    infospaceId,
                    runId,
                    requestBody: { views_config: [dashboardConfig as any] }
                });
                set({ isDashboardDirty: false });
                toast.success('Dashboard configuration saved');
            } catch (error: any) {
                const errorMsg = error.body?.detail || 'Failed to save dashboard configuration';
                toast.error(errorMsg);
                throw error;
            }
        },

        loadDashboardFromRun: (run) => {
            if (run.views_config && run.views_config.length > 0) {
                const rawConfig = run.views_config[0] as unknown as DashboardConfig;
                const config = migrateDashboardConfig(rawConfig);

                // Schema ID remapping for imported runs
                const runConfig = run.configuration as any;
                const currentSchemaIds = runConfig?.schema_ids || (run as any)?.schema_ids || (run as any)?.target_schema_ids || [];

                if (currentSchemaIds.length > 0) {
                    config.panels = config.panels.map(panel => {
                        if (!panel.settings) return panel;
                        const s = { ...panel.settings };
                        if (s.geocodeSource?.schemaId) {
                            s.geocodeSource = { ...s.geocodeSource, schemaId: currentSchemaIds[0] };
                            delete s.geocodedPointsCache;
                        }
                        if (s.labelSource?.schemaId) s.labelSource = { ...s.labelSource, schemaId: currentSchemaIds[0] };
                        if (s.selectedSchemaId) s.selectedSchemaId = currentSchemaIds[0];
                        if (s.selectedGraphSchemaId) s.selectedGraphSchemaId = currentSchemaIds[0];
                        if (s.selectedFieldsPerScheme) {
                            const oldKeys = Object.keys(s.selectedFieldsPerScheme);
                            if (oldKeys.length > 0) {
                                const newFields: Record<number, string[]> = {};
                                newFields[currentSchemaIds[0]] = s.selectedFieldsPerScheme[parseInt(oldKeys[0])];
                                s.selectedFieldsPerScheme = newFields;
                            }
                        }
                        return { ...panel, settings: s };
                    });
                }

                set({ dashboardConfig: config, isDashboardDirty: false });
            } else {
                set({
                    dashboardConfig: {
                        name: `Dashboard for ${run.name}`,
                        description: `Analytics dashboard for annotation run: ${run.name}`,
                        layout: { type: 'grid', columns: 12 },
                        panels: [],
                    },
                    isDashboardDirty: false,
                });
            }
        },

        compactLayout: () => {
            set(produce((state: AnnotationRunState) => {
                if (state.dashboardConfig) {
                    state.dashboardConfig.panels = compactPanels(state.dashboardConfig.panels);
                    state.isDashboardDirty = true;
                }
            }));
        },

        // --- Scope management ---
        addScope: (targetPanelId, scope) => {
            set(produce((state: AnnotationRunState) => {
                const panel = state.dashboardConfig?.panels.find(p => p.id === targetPanelId);
                if (panel) {
                    panel.incoming_scopes.push(scope);
                    state.isDashboardDirty = true;
                }
            }));
        },

        removeScope: (targetPanelId, scopeId) => {
            set(produce((state: AnnotationRunState) => {
                const panel = state.dashboardConfig?.panels.find(p => p.id === targetPanelId);
                if (panel) {
                    panel.incoming_scopes = panel.incoming_scopes.filter(s => s.id !== scopeId);
                    state.isDashboardDirty = true;
                }
            }));
        },

        updateScope: (targetPanelId, scopeId, updates) => {
            set(produce((state: AnnotationRunState) => {
                const panel = state.dashboardConfig?.panels.find(p => p.id === targetPanelId);
                if (panel) {
                    const scope = panel.incoming_scopes.find(s => s.id === scopeId);
                    if (scope) Object.assign(scope, updates);
                    state.isDashboardDirty = true;
                }
            }));
        },

        updateScopesFromSource: (sourcePanelId, newFilter, newLabel) => {
            set(produce((state: AnnotationRunState) => {
                if (!state.dashboardConfig) return;
                for (const panel of state.dashboardConfig.panels) {
                    for (const scope of panel.incoming_scopes) {
                        if (scope.source_panel_id === sourcePanelId && scope.mode === 'link') {
                            scope.filter = newFilter;
                            scope.label = newLabel;
                        }
                    }
                }
                state.isDashboardDirty = true;
            }));
        },

        // Formula CRUD — JSON-only, lives in dashboardConfig.formulas.
        // Renamed from Observation in M2 of the intelligence-primitive plan.
        // The legacy method names (addObservation/updateObservation/...) are
        // wired below as aliases for back-compat with consumers mid-migration.
        //
        // Auto-save flow: agent-authored formulas land on the backend
        // immediately (via MCP). For symmetry, user-driven CRUD also
        // auto-persists in the background — otherwise a "delete" would do
        // nothing visible to the backend and the formula would reappear on
        // reload. The save is fire-and-forget (toast on failure); the local
        // store mutates synchronously so the UI updates instantly.
        addFormula: (data) => {
            let created: Formula | null = null;
            set(produce((state: AnnotationRunState) => {
                if (!state.dashboardConfig) return;
                if (!state.dashboardConfig.formulas) state.dashboardConfig.formulas = [];
                const now = new Date().toISOString();
                // Spread the new flat-Formula body (group/measures/derives/…)
                // and stamp store-side metadata. The backend ignores the
                // timestamps; the ``Formula.model_validate`` call there
                // tolerates extra keys defensively.
                const f: Formula = {
                    ...data,
                    id: nanoid(),
                    created_at: now,
                    updated_at: now,
                    version: 1,
                };
                state.dashboardConfig.formulas.push(f);
                state.isDashboardDirty = true;
                created = f;
            }));
            _autoSaveDashboard(get);
            return created;
        },

        updateFormula: (id, updates) => {
            set(produce((state: AnnotationRunState) => {
                if (!state.dashboardConfig?.formulas) return;
                const idx = state.dashboardConfig.formulas.findIndex(f => f.id === id);
                if (idx === -1) return;
                const current = state.dashboardConfig.formulas[idx];
                state.dashboardConfig.formulas[idx] = {
                    ...current,
                    ...updates,
                    id: current.id,
                    created_at: current.created_at,
                    updated_at: new Date().toISOString(),
                };
                state.isDashboardDirty = true;
            }));
            _autoSaveDashboard(get);
        },

        removeFormula: (id) => {
            set(produce((state: AnnotationRunState) => {
                if (!state.dashboardConfig?.formulas) return;
                state.dashboardConfig.formulas = state.dashboardConfig.formulas.filter(f => f.id !== id);
                state.isDashboardDirty = true;
            }));
            _autoSaveDashboard(get);
        },

        getFormula: (id) => {
            const { dashboardConfig } = get();
            return dashboardConfig?.formulas?.find(f => f.id === id) ?? null;
        },

        promotePanelFormula: (panelId, name) => {
            set(produce((state: AnnotationRunState) => {
                const cfg = state.dashboardConfig;
                if (!cfg) return;
                const panel = cfg.panels.find(p => p.id === panelId);
                if (!panel) return;
                const inline = (panel as any).formula_inline;
                if (!inline) {
                    toast.error('Panel has no inline formula to promote.');
                    return;
                }
                // Avoid name collisions with existing formulas. Suffix until unique.
                const existingNames = new Set((cfg.formulas ?? []).map((f: any) => f.name));
                let proposed = name?.trim() || inline.name || panel.name || 'formula';
                let n = 1;
                while (existingNames.has(proposed)) {
                    n += 1;
                    proposed = `${name?.trim() || inline.name || panel.name || 'formula'}_${n}`;
                }
                const newId = `f_${nanoid()}`;
                const promoted: Formula = {
                    ...inline,
                    id: newId,
                    name: proposed,
                    updated_at: new Date().toISOString(),
                    created_at: new Date().toISOString(),
                } as Formula;
                if (!cfg.formulas) cfg.formulas = [];
                cfg.formulas.push(promoted);
                (panel as any).formula_id = newId;
                (panel as any).formula_inline = null;
                state.isDashboardDirty = true;
            }));
            _autoSaveDashboard(get);
        },

        detachPanelFormula: (panelId) => {
            set(produce((state: AnnotationRunState) => {
                const cfg = state.dashboardConfig;
                if (!cfg) return;
                const panel = cfg.panels.find(p => p.id === panelId);
                if (!panel) return;
                const fid = (panel as any).formula_id;
                if (!fid) {
                    toast.error('Panel is not bound to a saved formula.');
                    return;
                }
                const source = (cfg.formulas ?? []).find((f: any) => f.id === fid);
                if (!source) {
                    toast.error('Bound formula no longer exists; cannot detach.');
                    return;
                }
                // Clone with a fresh id so the inline copy is independent.
                const cloned: Formula = {
                    ...(source as any),
                    id: `inl_${nanoid()}`,
                } as Formula;
                (panel as any).formula_id = null;
                (panel as any).formula_inline = cloned;
                state.isDashboardDirty = true;
            }));
            _autoSaveDashboard(get);
        },

        // Legacy aliases — same implementations, renamed parameters. Remove
        // after all consumers (workspace, popover, binder) are renamed.
        addObservation(data) { return this.addFormula(data); },
        updateObservation(id, updates) { return this.updateFormula(id, updates); },
        removeObservation(id) { return this.removeFormula(id); },
        getObservation(id) { return this.getFormula(id); },

        // Run-wide settings management
        updateRunWideSettings: (updates) => {
            set(produce((state: AnnotationRunState) => {
                if (state.dashboardConfig) {
                    if (!state.dashboardConfig.runWideSettings) {
                        state.dashboardConfig.runWideSettings = {};
                    }
                    Object.assign(state.dashboardConfig.runWideSettings, updates);
                    state.isDashboardDirty = true;
                }
            }));
        },

        getGlobalVariableSplitting: () => {
            const { dashboardConfig } = get();
            return dashboardConfig?.runWideSettings?.globalVariableSplitting || null;
        },

        setGlobalVariableSplitting: (config) => {
            set(produce((state: AnnotationRunState) => {
                if (state.dashboardConfig) {
                    if (!state.dashboardConfig.runWideSettings) {
                        state.dashboardConfig.runWideSettings = {};
                    }
                    state.dashboardConfig.runWideSettings.globalVariableSplitting = config;
                    state.isDashboardDirty = true;
                }
            }));
        },

        // Focus mode — see interface comment.
        focusMode: false,
        toggleFocusMode: () => set((s) => ({ focusMode: !s.focusMode })),
        setFocusMode: (value) => set({ focusMode: value }),
    }),
    {
        name: 'annotation-run-store',
        storage: createJSONStorage(() => localStorage),
        partialize: (state) => ({
            activeRunId: state.activeRunId,
            dashboardConfig: state.dashboardConfig,
        }),
    }
  )
);

// Selectors for optimized re-renders
export const useAnnotationRunSelectors = {
  useRuns: () => useAnnotationRunStore(state => state.runs),
  useActiveRun: () => useAnnotationRunStore(state => state.activeRun),
  useIsLoading: () => useAnnotationRunStore(state => state.isLoading),
  useError: () => useAnnotationRunStore(state => state.error),
  useDashboardConfig: () => useAnnotationRunStore(state => state.dashboardConfig),
  useIsDashboardDirty: () => useAnnotationRunStore(state => state.isDashboardDirty),
  useCurrentRunResults: () => useAnnotationRunStore(state => state.currentRunResults),
  useIsProcessing: () => useAnnotationRunStore(state => state.isProcessing),
};