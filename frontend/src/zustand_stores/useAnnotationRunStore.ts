import { AnnotationRunRead, AnnotationRunCreate, AnnotationRunUpdate, AssetRead, AnnotationSchemaRead } from '@/client/models';
import { RunsService as AnnotationRunsServiceApi } from '@/client/services';
import { FormattedAnnotation } from '@/lib/annotations/types';
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

// Helper function to deserialize entire dashboard config
const deserializeDashboardConfig = (config: DashboardConfig | null): DashboardConfig | null => {
  if (!config) return null;
  
  const deserializedConfig = { ...config };
  
  // Deserialize timeAxisConfig in each panel's settings
  if (deserializedConfig.panels) {
    deserializedConfig.panels = deserializedConfig.panels.map(panel => {
      if (panel.settings?.timeAxisConfig) {
        return {
          ...panel,
          settings: {
            ...panel.settings,
            timeAxisConfig: deserializeTimeAxisConfig(panel.settings.timeAxisConfig)
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
const compactPanels = (panels: PanelViewConfig[]): PanelViewConfig[] => {
  if (panels.length === 0) return panels;

  const GRID_COLUMNS = 12;
  
  // Sort panels by their current position (top to bottom, left to right)
  const sortedPanels = [...panels].sort((a, b) => {
    const aY = a.gridPos?.y || 0;
    const bY = b.gridPos?.y || 0;
    const aX = a.gridPos?.x || 0;
    const bX = b.gridPos?.x || 0;
    
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
    const w = Math.max(1, Math.min(GRID_COLUMNS, panel.gridPos?.w || 6));
    const h = Math.max(1, panel.gridPos?.h || 4);
    
    const newPosition = findBestPosition(w, h);
    markPosition(newPosition.x, newPosition.y, w, h);
    
    return {
      ...panel,
      gridPos: {
        ...panel.gridPos,
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
    // NEW: Geocoded points cache for maps
    geocodedPointsCache?: GeocodedPointsCache;
    // For graphs
    selectedGraphSchemaId?: number;
    // For tables and maps - field selection
    selectedFieldsPerScheme?: Record<number, string[]>;
    // NEW: Table configuration settings
    tableConfig?: TableConfig;
  };
  // Add other panel-specific configurations here
  gridPos: { x: number; y: number; w: number; h: number }; // For react-grid-layout
}

// Dashboard configuration that gets persisted in the backend
export interface DashboardConfig {
  name: string;
  description?: string;
  layout: {
    type: 'grid';
    columns: number;
  };
  panels: PanelViewConfig[];
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
      valueAliases?: Record<string, string[]>; // Enhanced: many-to-one mapping
    };
    // Global time axis preferences
    defaultTimeInterval?: 'day' | 'week' | 'month' | 'quarter' | 'year';
    // Global source aggregation preference
    defaultAggregateSourcesMode?: boolean;
    // Global schema visibility
    defaultSelectedSchemaIds?: number[];
  };
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
  currentRunResults: FormattedAnnotation[];
  isProcessing: boolean;
  dashboardConfig: DashboardConfig | null;
  isDashboardDirty: boolean;
  setActiveRun: (run: AnnotationRunRead | null) => void;
  setCurrentRunResults: (results: FormattedAnnotation[]) => void;
  setIsProcessing: (processing: boolean) => void;
  setDashboardConfig: (config: DashboardConfig | null) => void;
  updateDashboardConfig: (config: Partial<DashboardConfig>) => void;
  addPanel: (panel: Omit<PanelViewConfig, 'id' | 'gridPos' | 'filters'>) => void;
  updatePanel: (panelId: string, updates: Partial<PanelViewConfig>) => void;
  removePanel: (panelId: string) => void;
  compactLayout: () => void;
  setDashboardDirty: (isDirty: boolean) => void;
  
  // NEW: Run-wide settings management
  updateRunWideSettings: (updates: Partial<NonNullable<DashboardConfig['runWideSettings']>>) => void;
  getGlobalVariableSplitting: () => NonNullable<DashboardConfig['runWideSettings']>['globalVariableSplitting'] | null;
  setGlobalVariableSplitting: (config: NonNullable<DashboardConfig['runWideSettings']>['globalVariableSplitting']) => void;
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
            set({ activeRun: run });
            // Load dashboard configuration from run or initialize default
            if (run) {
                // Call loadDashboardFromRun logic directly to avoid potential binding issues
                if (run.views_config && run.views_config.length > 0) {
                    const rawConfig = run.views_config[0] as unknown as DashboardConfig;
                    const config = deserializeDashboardConfig(rawConfig);
                    set({ dashboardConfig: config, isDashboardDirty: false });
                } else {
                    // Initialize default config if none exists
                    const defaultConfig: DashboardConfig = {
                        name: `Dashboard for ${run.name}`,
                        description: `Analytics dashboard for annotation run: ${run.name}`,
                        layout: {
                            type: 'grid',
                            columns: 12,
                        },
                        panels: [],
                    };
                    set({ dashboardConfig: defaultConfig, isDashboardDirty: false });
                }
            } else {
                set({ dashboardConfig: null, isDashboardDirty: false });
            }
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
                    // Find the best position for the new panel
                    const findBestPosition = (width: number, height: number) => {
                        const GRID_COLUMNS = 12;
                        const existingPanels = state.dashboardConfig?.panels || [];
                        
                        // Create a grid to track occupied spaces
                        const grid: boolean[][] = [];
                        let maxY = 0;
                        
                        // Initialize grid and mark occupied spaces
                        existingPanels.forEach(panel => {
                            if (!panel?.gridPos) return;
                            
                            const { x, y, w, h } = panel.gridPos;
                            const safeX = Math.max(0, Math.min(GRID_COLUMNS - 1, x || 0));
                            const safeY = Math.max(0, y || 0);
                            const safeW = Math.max(1, Math.min(GRID_COLUMNS - safeX, w || 1));
                            const safeH = Math.max(1, h || 1);
                            
                            maxY = Math.max(maxY, safeY + safeH);
                            
                            for (let row = safeY; row < safeY + safeH; row++) {
                                if (!grid[row]) grid[row] = new Array(GRID_COLUMNS).fill(false);
                                for (let col = safeX; col < safeX + safeW; col++) {
                                    if (col < GRID_COLUMNS) {
                                        grid[row][col] = true;
                                    }
                                }
                            }
                        });
                        
                        // Find the first available position
                        for (let y = 0; y <= maxY + height; y++) {
                            for (let x = 0; x <= GRID_COLUMNS - width; x++) {
                                let canPlace = true;
                                
                                // Check if this position is available
                                for (let row = y; row < y + height && canPlace; row++) {
                                    if (!grid[row]) grid[row] = new Array(GRID_COLUMNS).fill(false);
                                    for (let col = x; col < x + width && canPlace; col++) {
                                        if (grid[row] && grid[row][col]) {
                                            canPlace = false;
                                        }
                                    }
                                }
                                
                                if (canPlace) {
                                    return { x, y };
                                }
                            }
                        }
                        
                        // Fallback: place at the bottom
                        return { x: 0, y: maxY };
                    };

                    // Determine default size based on panel type
                    const getDefaultSize = (type: string) => {
                        switch (type) {
                            case 'table':
                                return { w: 12, h: 6 }; // Full width for tables
                            case 'chart':
                                return { w: 8, h: 5 }; // Large for time series
                            case 'pie':
                                return { w: 6, h: 4 }; // Medium for pie charts
                            case 'map':
                                return { w: 8, h: 6 }; // Large for maps
                            case 'graph':
                                return { w: 10, h: 6 }; // Large for knowledge graphs
                            default:
                                return { w: 6, h: 4 }; // Default medium size
                        }
                    };

                    const defaultSize = getDefaultSize(panelData.type);
                    const position = findBestPosition(defaultSize.w, defaultSize.h);

                    // Create a completely new panel object to avoid any read-only issues
                    const newPanel: PanelViewConfig = {
                        id: nanoid(),
                        name: panelData.name,
                        description: panelData.description,
                        type: panelData.type,
                        collapsed: false,
                        settings: {},
                        filters: {
                            logic: 'and',
                            rules: [],
                        },
                        gridPos: {
                            x: Math.max(0, Math.min(11, position.x)),
                            y: Math.max(0, position.y),
                            w: Math.max(1, Math.min(12, defaultSize.w)),
                            h: Math.max(1, defaultSize.h),
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
                        
                        // Create a new panel object with the updates to avoid mutations
                        const updatedPanel: PanelViewConfig = {
                            ...currentPanel,
                            ...updates,
                            // Ensure gridPos is properly merged and safe
                            gridPos: updates.gridPos 
                                ? {
                                    x: Math.max(0, Math.min(11, updates.gridPos.x ?? currentPanel.gridPos.x)),
                                    y: Math.max(0, updates.gridPos.y ?? currentPanel.gridPos.y),
                                    w: Math.max(1, Math.min(12, updates.gridPos.w ?? currentPanel.gridPos.w)),
                                    h: Math.max(1, updates.gridPos.h ?? currentPanel.gridPos.h),
                                }
                                : currentPanel.gridPos,
                            // Ensure settings is properly merged
                            settings: updates.settings 
                                ? { ...currentPanel.settings, ...updates.settings }
                                : currentPanel.settings,
                            // Ensure filters is properly merged
                            filters: updates.filters 
                                ? { ...currentPanel.filters, ...updates.filters }
                                : currentPanel.filters,
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
                const config = run.views_config[0] as unknown as DashboardConfig;
                
                // Check if we need to remap schema IDs for imported runs
                // This handles cases where schema IDs change during import/sharing
                const runConfig = run.configuration as any;
                const currentSchemaIds = runConfig?.schema_ids || (run as any)?.schema_ids || (run as any)?.target_schema_ids || [];
                
                if (currentSchemaIds.length > 0) {
                    console.log('[Dashboard] Current run schema IDs:', currentSchemaIds);
                    
                    // Extract existing schema IDs from config for debugging
                    const existingSchemaIds = new Set<number>();
                    config.panels.forEach(panel => {
                        if (panel.settings?.geocodeSource?.schemaId) existingSchemaIds.add(panel.settings.geocodeSource.schemaId);
                        if (panel.settings?.labelSource?.schemaId) existingSchemaIds.add(panel.settings.labelSource.schemaId);
                        if (panel.settings?.selectedSchemaId) existingSchemaIds.add(panel.settings.selectedSchemaId);
                        if (panel.settings?.selectedGraphSchemaId) existingSchemaIds.add(panel.settings.selectedGraphSchemaId);
                    });
                    console.log('[Dashboard] Config referenced schema IDs:', Array.from(existingSchemaIds));
                    
                    // Create a simple remapping based on position (first schema in config maps to first schema in run, etc.)
                    const remappedConfig = { ...config };
                    remappedConfig.panels = config.panels.map(panel => {
                        if (panel.settings) {
                            const updatedSettings = { ...panel.settings };
                            
                            // Remap geocodeSource schema ID
                            if (updatedSettings.geocodeSource && updatedSettings.geocodeSource.schemaId) {
                                const oldSchemaId = updatedSettings.geocodeSource.schemaId;
                                const newSchemaId = currentSchemaIds[0];
                                updatedSettings.geocodeSource.schemaId = newSchemaId;
                                
                                // Clear geocoded cache since schema ID changed - let it regenerate naturally
                                // The cache key depends on actual data which might be different in the new run
                                if (updatedSettings.geocodedPointsCache) {
                                    console.log(`[Dashboard] Clearing geocoded cache due to schema ID change: ${oldSchemaId} -> ${newSchemaId}`);
                                    delete updatedSettings.geocodedPointsCache;
                                }
                            }
                            
                            // Remap labelSource schema ID  
                            if (updatedSettings.labelSource && updatedSettings.labelSource.schemaId) {
                                updatedSettings.labelSource.schemaId = currentSchemaIds[0];
                            }
                            
                            // Remap other schema-specific settings
                            if (updatedSettings.selectedSchemaId) {
                                updatedSettings.selectedSchemaId = currentSchemaIds[0];
                            }
                            
                            if (updatedSettings.selectedGraphSchemaId) {
                                updatedSettings.selectedGraphSchemaId = currentSchemaIds[0];
                            }
                            
                            // Remap selectedSchemaIds array
                            if (updatedSettings.selectedSchemaIds && Array.isArray(updatedSettings.selectedSchemaIds)) {
                                updatedSettings.selectedSchemaIds = currentSchemaIds;
                            }
                            
                            // Remap selectedFieldsPerScheme keys
                            if (updatedSettings.selectedFieldsPerScheme) {
                                const newFieldsPerScheme: Record<number, string[]> = {};
                                const oldKeys = Object.keys(updatedSettings.selectedFieldsPerScheme);
                                if (oldKeys.length > 0 && currentSchemaIds.length > 0) {
                                    // Map the first old schema's fields to the first new schema
                                    const firstOldKey = oldKeys[0];
                                    newFieldsPerScheme[currentSchemaIds[0]] = updatedSettings.selectedFieldsPerScheme[parseInt(firstOldKey)];
                                }
                                updatedSettings.selectedFieldsPerScheme = newFieldsPerScheme;
                            }
                            
                            return { ...panel, settings: updatedSettings };
                        }
                        return panel;
                    });
                    
                    console.log('[Dashboard] Remapped schema IDs in dashboard config for imported run');
                    set({ dashboardConfig: remappedConfig, isDashboardDirty: false });
                } else {
                    set({ dashboardConfig: config, isDashboardDirty: false });
                }
            } else {
                // Initialize default config if none exists
                const defaultConfig: DashboardConfig = {
                    name: `Dashboard for ${run.name}`,
                    description: `Analytics dashboard for annotation run: ${run.name}`,
                    layout: {
                        type: 'grid',
                        columns: 12,
                    },
                    panels: [],
                };
                set({ dashboardConfig: defaultConfig, isDashboardDirty: false });
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

        // NEW: Run-wide settings management
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