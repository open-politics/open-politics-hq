import { create } from 'zustand';
// Commented out unused services
// import {
//   ClassificationSchemesService,
//   ClassificationResultsService,
// } from '@/client';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
// Commented out unused models
// import {
//   ClassificationSchemeRead,
//   ClassificationResultRead
// } from '@/client';

// Define placeholder types if SavedResultSet is removed from client
type SavedResultSetRead = any; 
type SavedResultSetCreate = any;

interface SavedResultSetState {
  savedResults: SavedResultSetRead[];
  error: string | null;
  fetchSavedResults: () => Promise<void>;
  saveResultSet: (name: string, jobId: number) => Promise<void>; // Updated runId to jobId
  loadResultSet: (resultSetId: number) => Promise<void>;
}

export const useSavedResultSetStore = create<SavedResultSetState>((set, get) => ({
  savedResults: [],
  error: null,

  fetchSavedResults: async () => {
    console.warn("DEPRECATED: fetchSavedResults is likely obsolete. Consider using Job history/export.");
    // const activeInfospace = useInfospaceStore.getState().activeInfospace;
    // if (!activeInfospace) return;
    // try {
    //   // Assuming there's no direct method to fetch saved result sets
    //   const response: any[] = []; // Placeholder
    //   set({ savedResults: response, error: null });
    // } catch (error: any) {
    //   set({ error: "Error fetching saved result sets", savedResults: [] });
    //   console.error(error);
    // }
    set({ savedResults: [], error: 'Functionality deprecated.' });
  },

  saveResultSet: async (name: string, jobId: number) => { // Updated runId to jobId
    console.warn("DEPRECATED: saveResultSet is likely obsolete. Consider using Job export features.");
    // const activeInfospace = useInfospaceStore.getState().activeInfospace;
    // if (!activeInfospace) return;
    //
    // try {
    //   /*
    //   // This needs to use jobId and likely fetch results via listClassificationResults or getJobResults
    //   const results = await ClassificationResultsService.getJobResults({ // Needs correct service method
    //     InfospaceId: activeInfospace.id, // Use id
    //     jobId, // Use jobId
    //   });
    //
    //   // This logic assumes results have datarecord_id
    //   const datarecordIds = [...new Set(results.map(r => r.datarecord_id))];
    //   const schemeIds = [...new Set(results.map(r => r.scheme_id))];
    //
    //   const resultSetData: SavedResultSetCreate = {
    //     name,
    //     datarecord_ids: datarecordIds,
    //     scheme_ids: schemeIds,
    //     // Add job_id reference?
    //     job_id: jobId
    //   };
    //
    //   // This service/method likely doesn't exist - need a new mechanism
    //   // await SomeNewService.createSavedResultSet({ ... });
    //
    //   // await get().fetchSavedResults(); // This fetch is also likely deprecated
    //   */
    // } catch (error: any) {
    //   set({ error: "Error saving result set" });
    //   console.error(error);
    // }
     set({ error: 'Functionality deprecated.' });
  },

  loadResultSet: async (resultSetId: number) => {
     console.warn("DEPRECATED: loadResultSet is likely obsolete. Consider loading from Job history/import.");
    // const activeInfospace = useInfospaceStore.getState().activeInfospace;
    // if (!activeInfospace) return;
    //
    // try {
    //   /*
    //   // This service/method likely doesn't exist
    //   const resultSet = await SomeNewService.getSavedResultSet({ ... });
    //
    //   // Update stores with the loaded data - Needs update for new stores
    //   // useDataSourceStore.getState().fetchDataSources();
    //   // useClassificationJobsStore.getState().fetchClassificationJobs(activeInfospace.id);
    //   // useClassificationSchemeStore? Or handled by useClassificationSystem hook?
    //
    //   // Set the active job based on the loaded set?
    //   // if (resultSet.job_id) {
    //   //   useClassificationSystem.getState().setActiveJob(resultSet.job_id); // Example
    //   // }
    //   */
    // } catch (error: any) {
    //   set({ error: "Error loading result set" });
    //   console.error(error);
    // }
     set({ error: 'Functionality deprecated.' });
  },
}));