import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { produce } from 'immer';
import { VariableSplittingConfig } from '@/components/collection/annotation/VariableSplittingControls';

// Runner-wide settings that should be consistent across all panels
export interface RunnerWideSettings {
  // Default time interval preferences
  defaultTimeInterval: 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';
  
  // Color scheme and theme preferences
  colorScheme: 'default' | 'colorblind' | 'dark' | 'light';
  
  // Global variable splitting configuration (shared across all panels)
  globalVariableSplitting: VariableSplittingConfig | null;
  
  // Value aliases for ambiguity resolution (should be consistent across all visualizations)
  valueAliases: Record<string, string>;
  
  // Geocoding cache (shared across all map panels)
  geocodingCache: Record<string, {
    coordinates: { latitude: number; longitude: number };
    cached_at: string;
  }>;
  
  // Default schema preferences per infospace
  defaultSchemaIds: Record<number, number>;
  
  // UI preferences
  showAdvancedControls: boolean;
  autoSaveDashboard: boolean;
  
  // Data source preferences
  defaultAggregateSourcesMode: boolean;
}

// Panel-specific settings that are unique to each panel type
export interface PanelSpecificSettings {
  // Individual field visibility toggles (panel-specific)
  visibleFields: Record<string, boolean>;
  
  // Panel-specific variable splitting overrides
  variableSplittingOverrides: {
    visibleSplits?: Set<string>;
    maxSplits?: number;
  };
  
  // Panel-specific data source selections
  selectedSourceIds: number[];
  
  // Panel-specific chart configurations
  chartConfig: {
    showStatistics?: boolean;
    maxSlices?: number; // For pie charts
    selectedSchemaIds?: number[];
  };
  
  // Panel-specific map settings
  mapConfig: {
    geocodeSource?: { schemaId: number; fieldKey: string };
    labelSource?: { schemaId: number; fieldKey: string };
    showLabels?: boolean;
  };
  
  // Panel-specific table settings
  tableConfig: {
    selectedFieldsPerScheme?: Record<number, string[]>;
    columnVisibility?: Record<string, boolean>;
    sorting?: Array<{ id: string; desc: boolean }>;
    pagination?: {
      pageIndex: number;
      pageSize: number;
    };
  };
  
  // Panel-specific graph settings
  graphConfig: {
    selectedGraphSchemaId?: number;
  };
}

// Combined settings interface for a specific annotation run
export interface AnnotationRunSettings {
  runId: number;
  runnerWideSettings: RunnerWideSettings;
  panelSpecificSettings: Record<string, PanelSpecificSettings>; // Keyed by panel ID
}

interface AnnotationRunSettingsState {
  // Current active run settings
  currentRunSettings: AnnotationRunSettings | null;
  
  // Actions for runner-wide settings
  setCurrentRun: (runId: number) => void;
  updateRunnerWideSettings: (updates: Partial<RunnerWideSettings>) => void;
  
  // Actions for panel-specific settings
  updatePanelSettings: (panelId: string, updates: Partial<PanelSpecificSettings>) => void;
  removePanelSettings: (panelId: string) => void;
  
  // Convenience getters
  getRunnerWideSettings: () => RunnerWideSettings;
  getPanelSettings: (panelId: string) => PanelSpecificSettings;
  
  // Utility methods
  resetToDefaults: () => void;
  importSettings: (settings: AnnotationRunSettings) => void;
  exportSettings: () => AnnotationRunSettings | null;
}

// Default runner-wide settings
const getDefaultRunnerWideSettings = (): RunnerWideSettings => ({
  defaultTimeInterval: 'day',
  colorScheme: 'default',
  globalVariableSplitting: null,
  valueAliases: {},
  geocodingCache: {},
  defaultSchemaIds: {},
  showAdvancedControls: true,
  autoSaveDashboard: true,
  defaultAggregateSourcesMode: true,
});

// Default panel-specific settings
const getDefaultPanelSettings = (): PanelSpecificSettings => ({
  visibleFields: {},
  variableSplittingOverrides: {},
  selectedSourceIds: [],
  chartConfig: {},
  mapConfig: {},
  tableConfig: {},
  graphConfig: {},
});

export const useAnnotationRunSettingsStore = create<AnnotationRunSettingsState>()(
  persist(
    (set, get) => ({
      currentRunSettings: null,
      
      setCurrentRun: (runId: number) => {
        set(produce((state: AnnotationRunSettingsState) => {
          // If settings for this run don't exist, create them
          if (!state.currentRunSettings || state.currentRunSettings.runId !== runId) {
            state.currentRunSettings = {
              runId,
              runnerWideSettings: getDefaultRunnerWideSettings(),
              panelSpecificSettings: {},
            };
          }
        }));
      },
      
      updateRunnerWideSettings: (updates: Partial<RunnerWideSettings>) => {
        set(produce((state: AnnotationRunSettingsState) => {
          if (state.currentRunSettings) {
            Object.assign(state.currentRunSettings.runnerWideSettings, updates);
          }
        }));
      },
      
      updatePanelSettings: (panelId: string, updates: Partial<PanelSpecificSettings>) => {
        set(produce((state: AnnotationRunSettingsState) => {
          if (state.currentRunSettings) {
            if (!state.currentRunSettings.panelSpecificSettings[panelId]) {
              state.currentRunSettings.panelSpecificSettings[panelId] = getDefaultPanelSettings();
            }
            Object.assign(state.currentRunSettings.panelSpecificSettings[panelId], updates);
          }
        }));
      },
      
      removePanelSettings: (panelId: string) => {
        set(produce((state: AnnotationRunSettingsState) => {
          if (state.currentRunSettings) {
            delete state.currentRunSettings.panelSpecificSettings[panelId];
          }
        }));
      },
      
      getRunnerWideSettings: () => {
        const { currentRunSettings } = get();
        return currentRunSettings?.runnerWideSettings || getDefaultRunnerWideSettings();
      },
      
      getPanelSettings: (panelId: string) => {
        const { currentRunSettings } = get();
        return currentRunSettings?.panelSpecificSettings[panelId] || getDefaultPanelSettings();
      },
      
      resetToDefaults: () => {
        set(produce((state: AnnotationRunSettingsState) => {
          if (state.currentRunSettings) {
            state.currentRunSettings.runnerWideSettings = getDefaultRunnerWideSettings();
            state.currentRunSettings.panelSpecificSettings = {};
          }
        }));
      },
      
      importSettings: (settings: AnnotationRunSettings) => {
        set({ currentRunSettings: settings });
      },
      
      exportSettings: () => {
        const { currentRunSettings } = get();
        return currentRunSettings ? { ...currentRunSettings } : null;
      },
    }),
    {
      name: 'annotation-run-settings-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        currentRunSettings: state.currentRunSettings,
      }),
    }
  )
);

// Utility hooks for easier access to specific settings
export const useRunnerWideSettings = () => {
  const store = useAnnotationRunSettingsStore();
  return {
    settings: store.getRunnerWideSettings(),
    updateSettings: store.updateRunnerWideSettings,
  };
};

export const usePanelSettings = (panelId: string) => {
  const store = useAnnotationRunSettingsStore();
  return {
    settings: store.getPanelSettings(panelId),
    updateSettings: (updates: Partial<PanelSpecificSettings>) => 
      store.updatePanelSettings(panelId, updates),
  };
}; 