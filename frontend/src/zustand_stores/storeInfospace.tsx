import { create } from 'zustand';
import {
  InfospacesService,
} from '@/client';
import { InfospaceRead, InfospaceCreate, InfospaceUpdate, ResourceType } from '@/client';
import { useShareableStore } from './storeShareables'; // Import the shareable store

interface InfospaceState {
  infospaces: InfospaceRead[];
  activeInfospace: InfospaceRead | null;
  error: string | null;
  isLoading: boolean; // Added for loading states during import/export
  fetchInfospaces: () => Promise<void>;
  createInfospace: (infospace: InfospaceCreate) => Promise<InfospaceRead | null>;
  updateInfospace: (infospaceId: number, data: InfospaceUpdate) => Promise<void>;
  deleteInfospace: (infospaceId: number) => Promise<void>;
  setActiveInfospace: (infospaceId: number) => void;
  fetchInfospaceById: (infospaceId: number) => Promise<void>;

  // New actions
  exportInfospace: (infospaceId: number) => Promise<void>;
  importInfospace: (file: File, placeholderInfospaceId: number) => Promise<InfospaceRead | null>; // placeholderInfospaceId is for the API path, ignored by backend for WS import
  importInfospaceFromToken: (token: string, name: string) => Promise<InfospaceRead | null>;
}

export const useInfospaceStore = create<InfospaceState>()(
    (set, get) => ({
      infospaces: [],
      activeInfospace: null,
      error: null,
      isLoading: false, // Initialize isLoading

      fetchInfospaces: async () => {
        set({ isLoading: true });
        try {
          const response = await InfospacesService.listInfospaces({}); // Use InfospacesService
          const storedId = localStorage.getItem('activeInfospaceId'); // Assuming key remains 'activeInfospaceId' for now
          const active = response.data.find(w => w.id === Number(storedId)) || response.data[0] || null;
          
          set(state => ({
            ...state,
            infospaces: response.data,
            activeInfospace: active,
            error: null,
            isLoading: false,
          }));

          if (active) {
            localStorage.setItem('activeInfospaceId', String(active.id));
          } else {
            localStorage.removeItem('activeInfospaceId');
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "Error fetching infospaces";
          set(state => ({ ...state, error: message, infospaces: [], isLoading: false }));
          console.error(error);
        }
      },

      fetchInfospaceById: async (infospaceId: number) => {
        set({ isLoading: true });
        try {
          const response = await InfospacesService.getInfospace({ infospaceId }); // Use InfospacesService
          set(state => ({
            ...state,
            activeInfospace: response,
            error: null,
            isLoading: false,
          }));
          localStorage.setItem('activeInfospaceId', String(infospaceId));
        } catch (error) {
          const message = error instanceof Error ? error.message : "Error fetching infospace";
          set(state => ({ ...state, error: message, isLoading: false }));
          console.error(error);
        }
      },

      createInfospace: async (infospace: InfospaceCreate): Promise<InfospaceRead | null> => {
        set({ isLoading: true });
        try {
          const newInfospace = await InfospacesService.createInfospace({ requestBody: infospace }); // Use InfospacesService
          await get().fetchInfospaces(); // Refreshes list and sets isLoading to false via fetchInfospaces
          return newInfospace;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Error creating infospace";
          set(state => ({ ...state, error: message, isLoading: false }));
          console.error("Error creating infospace:", error);
          return null;
        }
      },

      updateInfospace: async (infospaceId: number, data: InfospaceUpdate) => {
        set({ isLoading: true });
        try {
          await InfospacesService.updateInfospace({ infospaceId, requestBody: data }); // Use InfospacesService
          await get().fetchInfospaces(); // Refreshes list
          if (get().activeInfospace?.id === infospaceId) {
            const updatedInfospace = await InfospacesService.getInfospace({ infospaceId }); // Use InfospacesService
            if (updatedInfospace) {
              set(state => ({ ...state, activeInfospace: updatedInfospace, isLoading: false }));
            }
          } else {
            set({ isLoading: false });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "Error updating infospace";
          set(state => ({ ...state, error: message, isLoading: false }));
          console.error(error);
        }
      },

      deleteInfospace: async (infospaceId: number) => {
        set({ isLoading: true });
        try {
          await InfospacesService.deleteInfospace({ infospaceId }); // Use InfospacesService
          // activeInfospace is handled by fetchInfospaces if it was the one deleted
          await get().fetchInfospaces(); // Refreshes list and sets isLoading to false
        } catch (error) {
          const message = error instanceof Error ? error.message : "Error deleting infospace";
          set(state => ({ ...state, error: message, isLoading: false }));
          console.error(error);
        }
      },

      setActiveInfospace: (infospaceId: number) => {
        const infospace = get().infospaces.find(w => w.id === infospaceId);
        if (infospace) {
          localStorage.setItem('activeInfospaceId', String(infospaceId));
          set(state => ({ ...state, activeInfospace: infospace }));
        }
      },

      // New methods
      exportInfospace: async (infospaceId: number) => {
        set({ isLoading: true, error: null });
        try {
          // Use the generic exportResource from useShareableStore
          await useShareableStore.getState().exportResource('infospace' as ResourceType, infospaceId, infospaceId);
          set({ isLoading: false });
        } catch (err) {
          console.error("Export infospace error:", err);
          const message = err instanceof Error ? err.message : 'Failed to export infospace';
          set({ error: message, isLoading: false });
        }
      },

      importInfospace: async (file: File, placeholderInfospaceId: number): Promise<InfospaceRead | null> => {
        set({ isLoading: true, error: null });
        try {
          // Use the generic importResource from useShareableStore
          // The placeholderInfospaceId is required by the API client for the path, 
          // but is ignored by the backend when the package type is INFOSPACE.
          const result = await useShareableStore.getState().importResource(file, placeholderInfospaceId);
          // After import, refresh infospaces and try to set the new one as active.
          await get().fetchInfospaces(); 

          if (result && typeof result === 'object' && 'imported_resource_id' in result && (result as any).resource_type === 'infospace') {
            const newInfospaceId = (result as any).imported_resource_id;
            if (newInfospaceId) {
                const newWs = get().infospaces.find(ws => ws.id === newInfospaceId);
                if (newWs) {
                    set({ activeInfospace: newWs, isLoading: false });
                    localStorage.setItem('activeInfospaceId', String(newWs.id));
                    return newWs;
                } else {
                    // If not found in the refreshed list (should be rare), try a direct fetch.
                    const fetchedNewWs = await InfospacesService.getInfospace({ infospaceId: newInfospaceId }); // Use InfospacesService
                    set({ activeInfospace: fetchedNewWs, isLoading: false });
                    localStorage.setItem('activeInfospaceId', String(fetchedNewWs.id));
                    await get().fetchInfospaces(); // Ensure list is updated again if direct fetch was needed
                    return fetchedNewWs;
                }
            }
          }
          set({ isLoading: false });
          // If result processing above didn't return, it means conditions weren't met for new active infospace.
          // Return null as the specific new InfospaceRead object isn't directly available or confirmed.
          return null;
        } catch (err) {
          console.error("Import infospace error:", err);
          const message = err instanceof Error ? err.message : 'Failed to import infospace';
          set({ error: message, isLoading: false });
          return null;
        }
      },

      importInfospaceFromToken: async (token: string, name: string): Promise<InfospaceRead | null> => {
        set({ isLoading: true, error: null });
        try {
          const result = await useShareableStore.getState().importResourceFromToken(token, name as unknown as number);
          if (result && result.resource_type === 'infospace' && result.imported_resource_id) {
            await get().fetchInfospaces();
            const newInfospace = get().infospaces.find(ws => ws.id === result.imported_resource_id);
            if (newInfospace) {
              set({ activeInfospace: newInfospace, isLoading: false });
              localStorage.setItem('activeInfospaceId', String(newInfospace.id));
              return newInfospace;
            }
          }
          // If we reach here, something went wrong or the imported resource was not an infospace
          set({ isLoading: false });
          return null;
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to import infospace from token';
          set({ error: message, isLoading: false });
          return null;
        }
      },
    })

  );