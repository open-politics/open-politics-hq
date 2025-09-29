import { create } from 'zustand';
import { AnnotationSchemaRead } from '@/client';

interface AnnotationSettingsState {
  // Map of infospace ID to default schema ID
  defaultSchemaIds: Record<number, number>;
  
  // Actions
  getDefaultSchemaId: (infospaceId: number, schemas: AnnotationSchemaRead[]) => number | null;
  setDefaultSchemaId: (infospaceId: number, schemaId: number) => void;
}

// Helper to load settings from localStorage
const loadSettings = (): Record<number, number> => {
  if (typeof window === 'undefined') return {};
  
  try {
    const stored = localStorage.getItem('annotation-settings');
    return stored ? JSON.parse(stored) : {};
  } catch (error) {
    console.error('Error loading annotation settings:', error);
    return {};
  }
};

// Helper to save settings to localStorage
const saveSettings = (settings: Record<number, number>) => {
  if (typeof window === 'undefined') return;
  
  try {
    localStorage.setItem('annotation-settings', JSON.stringify(settings));
  } catch (error) {
    console.error('Error saving annotation settings:', error);
  }
};

export const useAnnotationSettingsStore = create<AnnotationSettingsState>((set, get) => ({
  defaultSchemaIds: loadSettings(),
  
  getDefaultSchemaId: (infospaceId, schemas) => {
    if (typeof infospaceId !== 'number' || isNaN(infospaceId)) {
      console.warn('[AnnotationSettingsStore] Invalid infospaceId provided to getDefaultSchemaId:', infospaceId);
      return null;
    }
    
    const { defaultSchemaIds } = get();
    
    // If we have a saved default schema ID for this infospace, use it
    if (defaultSchemaIds[infospaceId]) {
      // Verify that the schema still exists
      const schemaExists = schemas.some(s => s.id === defaultSchemaIds[infospaceId]);
      if (schemaExists) {
        return defaultSchemaIds[infospaceId];
      } else {
        // If schema doesn't exist, clear the invalid default
        set(state => {
          const newDefaults = {...state.defaultSchemaIds};
          delete newDefaults[infospaceId];
          saveSettings(newDefaults);
          return { defaultSchemaIds: newDefaults };
        });
      }
    }
    
    // Otherwise, return the first schema ID if available
    return schemas.length > 0 ? schemas[0].id : null;
  },
  
  setDefaultSchemaId: (infospaceId, schemaId) => {
    if (typeof infospaceId !== 'number' || isNaN(infospaceId)) {
      console.warn('[AnnotationSettingsStore] Invalid infospaceId provided to setDefaultSchemaId:', infospaceId);
      return;
    }
    
    set(state => {
      const newDefaultSchemaIds = {
        ...state.defaultSchemaIds,
        [infospaceId]: schemaId
      };
      
      // Save to localStorage
      saveSettings(newDefaultSchemaIds);
      
      return { defaultSchemaIds: newDefaultSchemaIds };
    });
  }
})); 