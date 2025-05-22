import { create } from 'zustand';
import {
  WorkspacesService,
} from '@/client/services';
import { WorkspaceRead, WorkspaceCreate, WorkspaceUpdate, ResourceType, ImportWorkspaceFromTokenRequest } from '@/client/models';
import { useShareableStore } from './storeShareables'; // Import the shareable store

interface WorkspaceState {
  workspaces: WorkspaceRead[];
  activeWorkspace: WorkspaceRead | null;
  error: string | null;
  isLoading: boolean; // Added for loading states during import/export
  fetchWorkspaces: () => Promise<void>;
  createWorkspace: (workspace: WorkspaceCreate) => Promise<WorkspaceRead | null>;
  updateWorkspace: (workspaceId: number, data: WorkspaceUpdate) => Promise<void>;
  deleteWorkspace: (workspaceId: number) => Promise<void>;
  setActiveWorkspace: (workspaceId: number) => void;
  fetchWorkspaceById: (workspaceId: number) => Promise<void>;

  // New actions
  exportWorkspace: (workspaceId: number) => Promise<void>;
  importWorkspace: (file: File, placeholderWorkspaceId: number) => Promise<WorkspaceRead | null>; // placeholderWorkspaceId is for the API path, ignored by backend for WS import
  importWorkspaceFromToken: (token: string, newWorkspaceName?: string) => Promise<WorkspaceRead | null>;
}

export const useWorkspaceStore = create<WorkspaceState>()(
    (set, get) => ({
      workspaces: [],
      activeWorkspace: null,
      error: null,
      isLoading: false, // Initialize isLoading

      fetchWorkspaces: async () => {
        set({ isLoading: true });
        try {
          const response = await WorkspacesService.readWorkspaces();
          const storedId = localStorage.getItem('activeWorkspaceId');
          const active = response.find(w => w.id === Number(storedId)) || response[0] || null;
          
          set(state => ({
            ...state,
            workspaces: response,
            activeWorkspace: active,
            error: null,
            isLoading: false,
          }));

          if (active) {
            localStorage.setItem('activeWorkspaceId', String(active.id));
          } else {
            localStorage.removeItem('activeWorkspaceId');
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "Error fetching workspaces";
          set(state => ({ ...state, error: message, workspaces: [], isLoading: false }));
          console.error(error);
        }
      },

      fetchWorkspaceById: async (workspaceId: number) => {
        set({ isLoading: true });
        try {
          const response = await WorkspacesService.readWorkspaceById({ workspaceId });
          set(state => ({
            ...state,
            activeWorkspace: response,
            error: null,
            isLoading: false,
          }));
          localStorage.setItem('activeWorkspaceId', String(workspaceId));
        } catch (error) {
          const message = error instanceof Error ? error.message : "Error fetching workspace";
          set(state => ({ ...state, error: message, isLoading: false }));
          console.error(error);
        }
      },

      createWorkspace: async (workspace: WorkspaceCreate): Promise<WorkspaceRead | null> => {
        set({ isLoading: true });
        try {
          const newWorkspace = await WorkspacesService.createWorkspace({ requestBody: workspace });
          await get().fetchWorkspaces(); // Refreshes list and sets isLoading to false via fetchWorkspaces
          return newWorkspace;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Error creating workspace";
          set(state => ({ ...state, error: message, isLoading: false }));
          console.error("Error creating workspace:", error);
          return null;
        }
      },

      updateWorkspace: async (workspaceId: number, data: WorkspaceUpdate) => {
        set({ isLoading: true });
        try {
          await WorkspacesService.updateWorkspace({ workspaceId, requestBody: data });
          await get().fetchWorkspaces(); // Refreshes list
          if (get().activeWorkspace?.id === workspaceId) {
            const updatedWorkspace = await WorkspacesService.readWorkspaceById({ workspaceId });
            if (updatedWorkspace) {
              set(state => ({ ...state, activeWorkspace: updatedWorkspace, isLoading: false }));
            }
          } else {
            set({ isLoading: false });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "Error updating workspace";
          set(state => ({ ...state, error: message, isLoading: false }));
          console.error(error);
        }
      },

      deleteWorkspace: async (workspaceId: number) => {
        set({ isLoading: true });
        try {
          await WorkspacesService.deleteWorkspace({ workspaceId });
          // activeWorkspace is handled by fetchWorkspaces if it was the one deleted
          await get().fetchWorkspaces(); // Refreshes list and sets isLoading to false
        } catch (error) {
          const message = error instanceof Error ? error.message : "Error deleting workspace";
          set(state => ({ ...state, error: message, isLoading: false }));
          console.error(error);
        }
      },

      setActiveWorkspace: (workspaceId: number) => {
        const workspace = get().workspaces.find(w => w.id === workspaceId);
        if (workspace) {
          localStorage.setItem('activeWorkspaceId', String(workspaceId));
          set(state => ({ ...state, activeWorkspace: workspace }));
        }
      },

      // New methods
      exportWorkspace: async (workspaceId: number) => {
        set({ isLoading: true, error: null });
        try {
          // Use the generic exportResource from useShareableStore
          await useShareableStore.getState().exportResource('workspace' as ResourceType, workspaceId);
          set({ isLoading: false });
        } catch (err) {
          console.error("Export workspace error:", err);
          const message = err instanceof Error ? err.message : 'Failed to export workspace';
          set({ error: message, isLoading: false });
        }
      },

      importWorkspace: async (file: File, placeholderWorkspaceId: number): Promise<WorkspaceRead | null> => {
        set({ isLoading: true, error: null });
        try {
          // Use the generic importResource from useShareableStore
          // The placeholderWorkspaceId is required by the API client for the path, 
          // but is ignored by the backend when the package type is WORKSPACE.
          const result = await useShareableStore.getState().importResource(file, placeholderWorkspaceId);
          // After import, refresh workspaces and try to set the new one as active.
          await get().fetchWorkspaces(); 

          if (result && typeof result === 'object' && 'imported_resource_id' in result && (result as any).resource_type === 'workspace') {
            const newWorkspaceId = (result as any).imported_resource_id;
            if (newWorkspaceId) {
                const newWs = get().workspaces.find(ws => ws.id === newWorkspaceId);
                if (newWs) {
                    set({ activeWorkspace: newWs, isLoading: false });
                    localStorage.setItem('activeWorkspaceId', String(newWs.id));
                    return newWs;
                } else {
                    // If not found in the refreshed list (should be rare), try a direct fetch.
                    const fetchedNewWs = await WorkspacesService.readWorkspaceById({ workspaceId: newWorkspaceId });
                    set({ activeWorkspace: fetchedNewWs, isLoading: false });
                    localStorage.setItem('activeWorkspaceId', String(fetchedNewWs.id));
                    await get().fetchWorkspaces(); // Ensure list is updated again if direct fetch was needed
                    return fetchedNewWs;
                }
            }
          }
          set({ isLoading: false });
          // If result processing above didn't return, it means conditions weren't met for new active workspace.
          // Return null as the specific new WorkspaceRead object isn't directly available or confirmed.
          return null;
        } catch (err) {
          console.error("Import workspace error:", err);
          const message = err instanceof Error ? err.message : 'Failed to import workspace';
          set({ error: message, isLoading: false });
          return null;
        }
      },

      importWorkspaceFromToken: async (token: string, newWorkspaceName?: string): Promise<WorkspaceRead | null> => {
        set({ isLoading: true, error: null });
        try {
          const requestBody: ImportWorkspaceFromTokenRequest = { share_token: token, new_workspace_name: newWorkspaceName };
          const newWorkspace = await WorkspacesService.importWorkspaceFromTokenEndpoint({ requestBody });
          await get().fetchWorkspaces(); // Refresh list
          if (newWorkspace) {
            set({ activeWorkspace: newWorkspace, isLoading: false }); // Optionally set as active
            localStorage.setItem('activeWorkspaceId', String(newWorkspace.id));
          }
          return newWorkspace;
        } catch (err) {
          console.error("Import workspace from token error:", err);
          const message = err instanceof Error ? err.message : 'Failed to import workspace from token';
          set({ error: message, isLoading: false });
          return null;
        }
      },
    })

  );