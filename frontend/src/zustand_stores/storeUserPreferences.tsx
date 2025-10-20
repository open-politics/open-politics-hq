import { create } from 'zustand';
import { UsersService } from '@/client';
import { toast } from 'sonner';

export interface UserUIPreferences {
  globe_enabled: boolean;
  docs_banner_dismissed: boolean;
  tutorial_completed: boolean;
  tutorial_step: number | null;
  custom_background_url: string | null;
}

const DEFAULT_PREFERENCES: UserUIPreferences = {
  globe_enabled: false,
  docs_banner_dismissed: false,
  tutorial_completed: false,
  tutorial_step: null,
  custom_background_url: null,
};

interface UserPreferencesState {
  preferences: UserUIPreferences;
  isLoading: boolean;
  error: string | null;
  
  // Initialize preferences from user data
  initializePreferences: (userPreferences?: Record<string, any> | null) => void;
  
  // Update a single preference
  updatePreference: <K extends keyof UserUIPreferences>(
    key: K,
    value: UserUIPreferences[K]
  ) => Promise<void>;
  
  // Bulk update multiple preferences
  updatePreferences: (updates: Partial<UserUIPreferences>) => Promise<void>;
  
  // Toggle boolean preference
  togglePreference: (key: keyof UserUIPreferences) => Promise<void>;
  
  // Reset to defaults
  resetPreferences: () => Promise<void>;
  
  // Background image helpers
  uploadBackgroundImage: (file: File) => Promise<void>;
  deleteBackgroundImage: () => Promise<void>;
}

export const useUserPreferencesStore = create<UserPreferencesState>()((set, get) => ({
  preferences: DEFAULT_PREFERENCES,
  isLoading: false,
  error: null,

  initializePreferences: (userPreferences) => {
    if (userPreferences) {
      set({
        preferences: {
          ...DEFAULT_PREFERENCES,
          ...userPreferences,
        },
      });
    } else {
      set({ preferences: DEFAULT_PREFERENCES });
    }
  },

  updatePreference: async (key, value) => {
    const currentPreferences = get().preferences;
    const newPreferences = {
      ...currentPreferences,
      [key]: value,
    };

    // Optimistic update
    set({ preferences: newPreferences, isLoading: true, error: null });

    try {
      await UsersService.updateUserMe({
        requestBody: {
          ui_preferences: newPreferences as Record<string, any>,
        },
      });
      
      set({ isLoading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update preference';
      console.error('Error updating preference:', error);
      
      // Revert on error
      set({ 
        preferences: currentPreferences,
        error: message,
        isLoading: false,
      });
      
      toast.error(message);
    }
  },

  updatePreferences: async (updates) => {
    const currentPreferences = get().preferences;
    const newPreferences = {
      ...currentPreferences,
      ...updates,
    };

    // Optimistic update
    set({ preferences: newPreferences, isLoading: true, error: null });

    try {
      await UsersService.updateUserMe({
        requestBody: {
          ui_preferences: newPreferences as Record<string, any>,
        },
      });
      
      set({ isLoading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update preferences';
      console.error('Error updating preferences:', error);
      
      // Revert on error
      set({ 
        preferences: currentPreferences,
        error: message,
        isLoading: false,
      });
      
      toast.error(message);
    }
  },

  togglePreference: async (key) => {
    const currentValue = get().preferences[key];
    if (typeof currentValue === 'boolean') {
      await get().updatePreference(key, !currentValue as any);
    }
  },

  resetPreferences: async () => {
    const currentPreferences = get().preferences;
    
    // Optimistic update
    set({ preferences: DEFAULT_PREFERENCES, isLoading: true, error: null });

    try {
      await UsersService.updateUserMe({
        requestBody: {
          ui_preferences: DEFAULT_PREFERENCES as Record<string, any>,
        },
      });
      
      set({ isLoading: false });
      toast.success('Preferences reset to defaults');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reset preferences';
      console.error('Error resetting preferences:', error);
      
      // Revert on error
      set({ 
        preferences: currentPreferences,
        error: message,
        isLoading: false,
      });
      
      toast.error(message);
    }
  },

  // Helper to upload background image
  uploadBackgroundImage: async (file: File) => {
    set({ isLoading: true, error: null });

    try {
      const response = await UsersService.uploadBackgroundImage({
        formData: {
          file: file,
        },
      });

      console.log('Upload response:', response);
      console.log('UI preferences from response:', response.ui_preferences);

      if (response.ui_preferences) {
        const newPreferences = {
          ...DEFAULT_PREFERENCES,
          ...response.ui_preferences,
        };
        
        console.log('Setting new preferences:', newPreferences);
        
        set({
          preferences: newPreferences,
          isLoading: false,
        });
      }

      toast.success('Background image uploaded successfully');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to upload background image';
      console.error('Error uploading background:', error);

      set({
        error: message,
        isLoading: false,
      });

      toast.error(message);
      throw error;
    }
  },

  // Helper to delete background image
  deleteBackgroundImage: async () => {
    const currentPreferences = get().preferences;

    // Optimistic update
    set({
      preferences: {
        ...currentPreferences,
        custom_background_url: null,
      },
      isLoading: true,
      error: null,
    });

    try {
      const response = await UsersService.deleteBackgroundImage();

      if (response.ui_preferences) {
        set({
          preferences: {
            ...DEFAULT_PREFERENCES,
            ...response.ui_preferences,
          },
          isLoading: false,
        });
      }

      toast.success('Background image removed');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete background image';
      console.error('Error deleting background:', error);

      // Revert on error
      set({
        preferences: currentPreferences,
        error: message,
        isLoading: false,
      });

      toast.error(message);
      throw error;
    }
  },
}));

