import { create } from 'zustand';
import { ClassificationSchemeRead } from '@/client/models';
import { ClassificationScheme } from '@/lib/classification/types';

interface ClassificationSettingsState {
  // Map of workspace ID to default scheme ID
  defaultSchemeIds: Record<number, number>;
  
  // Actions
  getDefaultSchemeId: (workspaceId: number, schemes: ClassificationSchemeRead[] | ClassificationScheme[]) => number | null;
  setDefaultSchemeId: (workspaceId: number, schemeId: number) => void;
}

// Helper to load settings from localStorage
const loadSettings = (): Record<number, number> => {
  if (typeof window === 'undefined') return {};
  
  try {
    const stored = localStorage.getItem('classification-settings');
    return stored ? JSON.parse(stored) : {};
  } catch (error) {
    console.error('Error loading classification settings:', error);
    return {};
  }
};

// Helper to save settings to localStorage
const saveSettings = (settings: Record<number, number>) => {
  if (typeof window === 'undefined') return;
  
  try {
    localStorage.setItem('classification-settings', JSON.stringify(settings));
  } catch (error) {
    console.error('Error saving classification settings:', error);
  }
};

export const useClassificationSettingsStore = create<ClassificationSettingsState>((set, get) => ({
  defaultSchemeIds: loadSettings(),
  
  getDefaultSchemeId: (workspaceId, schemes) => {
    const { defaultSchemeIds } = get();
    
    // If we have a saved default scheme ID for this workspace, use it
    if (defaultSchemeIds[workspaceId]) {
      // Verify that the scheme still exists
      const schemeExists = schemes.some(s => s.id === defaultSchemeIds[workspaceId]);
      if (schemeExists) {
        return defaultSchemeIds[workspaceId];
      } else {
        // If scheme doesn't exist, clear the invalid default
        set(state => {
          const newDefaults = {...state.defaultSchemeIds};
          delete newDefaults[workspaceId];
          saveSettings(newDefaults);
          return { defaultSchemeIds: newDefaults };
        });
      }
    }
    
    // Otherwise, return the first scheme ID if available
    return schemes.length > 0 ? schemes[0].id : null;
  },
  
  setDefaultSchemeId: (workspaceId, schemeId) => {
    set(state => {
      const newDefaultSchemeIds = {
        ...state.defaultSchemeIds,
        [workspaceId]: schemeId
      };
      
      // Save to localStorage
      saveSettings(newDefaultSchemeIds);
      
      return { defaultSchemeIds: newDefaultSchemeIds };
    });
  }
})); 