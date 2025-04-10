import { create } from 'zustand';
import {
  ClassificationSchemesService,
  DocumentsService,
  ClassificationResultsService,
} from '@/client/services';
import { useWorkspaceStore } from '@/zustand_stores/storeWorkspace';
import { useDocumentStore } from '@/zustand_stores/storeDocuments';
import {
  ClassificationSchemeRead,
  DocumentRead,
  SavedResultSetRead,
  SavedResultSetCreate,
  ClassificationResultRead
} from '@/client/models';

interface SavedResultSetState {
  savedResults: SavedResultSetRead[];
  error: string | null;
  fetchSavedResults: () => Promise<void>;
  saveResultSet: (name: string, runId: number) => Promise<void>;
  loadResultSet: (resultSetId: number) => Promise<void>;
}

export const useSavedResultSetStore = create<SavedResultSetState>((set, get) => ({
  savedResults: [],
  error: null,

  fetchSavedResults: async () => {
    const activeWorkspace = useWorkspaceStore.getState().activeWorkspace;
    if (!activeWorkspace) return;
    try {
      // Assuming there's no direct method to fetch saved result sets, you might need to adjust this part
      // const response = await SavedResultsService.readSavedResultSets({ // Assuming such method exists
      //   workspaceId: activeWorkspace.uid,
      //   skip: 0,
      //   limit: 100,
      // });
      const response: any[] = []; // Placeholder, replace with actual data fetching
      set({ savedResults: response, error: null });
    } catch (error: any) {
      set({ error: "Error fetching saved result sets", savedResults: [] });
      console.error(error);
    }
  },

  saveResultSet: async (name: string, runId: number) => {
    const activeWorkspace = useWorkspaceStore.getState().activeWorkspace;
    if (!activeWorkspace) return;
    
    try {
      const results = await ClassificationResultsService.getResultsByRun({
        workspaceId: activeWorkspace.uid,
        runId,
      });
      
      const documentIds = [...new Set(results.map(r => r.document_id))];
      const schemeIds = [...new Set(results.map(r => r.scheme_id))];
      
      const resultSetData: SavedResultSetCreate = {
        name,
        document_ids: documentIds,
        scheme_ids: schemeIds,
      };

      await ClassificationSchemesService.createSavedResultSet({
        workspaceId: activeWorkspace.uid,
        requestBody: resultSetData
      });
      
      await get().fetchSavedResults();
    } catch (error: any) {
      set({ error: "Error saving result set" });
      console.error(error);
    }
  },

  loadResultSet: async (resultSetId: number) => {
    const activeWorkspace = useWorkspaceStore.getState().activeWorkspace;
    if (!activeWorkspace) return;
    
    try {
      const resultSet = await ClassificationSchemesService.getSavedResultSet({
        workspaceId: activeWorkspace.uid,
        resultSetId,
      });
      
      // Update stores with the loaded data
      useDocumentStore.getState().fetchDocuments();
      // useClassificationSchemeStore.getState().fetchClassificationSchemes(activeWorkspace.uid); // Remove this line
      
      // Set the run ID in the classification results store
      // if (resultSet.results?.[0]?.run_id) { // Remove this block
      //   useClassificationResultStore.getState().setSelectedRunId(resultSet.results[0].run_id);
      // }
    } catch (error: any) {
      set({ error: "Error loading result set" });
      console.error(error);
    }
  },
}));