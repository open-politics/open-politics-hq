import { create } from 'zustand';
import { useWorkspaceStore } from '@/zustand_stores/storeWorkspace';
import { DatasourcesService } from '@/client/services';
import { DataSourceRead as ClientDataSourceRead, DataSourceType as ClientDataSourceType, DataSourcesOut, DataSourceStatus as ClientDataSourceStatus } from '@/client/models';
import { DataSource, DataSourceType, DataSourceStatus } from '@/lib/classification/types';
import { adaptDataSourceReadToDataSource } from '@/lib/classification/adapters';

// TODO: Update imports when client is regenerated

// Store polling intervals to manage them
const pollingIntervals: Record<number, NodeJS.Timeout> = {};
const POLLING_INTERVAL_MS = 10000; // Poll every 10 seconds

interface DataSourceState {
  dataSources: DataSource[];
  isLoading: boolean;
  error: string | null;
  fetchDataSources: () => Promise<void>;
  createDataSource: (formData: FormData) => Promise<DataSource | null>;
  deleteDataSource: (dataSourceId: number) => Promise<void>;
  // Add function to poll/update status
  startPollingDataSourceStatus: (dataSourceId: number) => void;
  stopPollingDataSourceStatus: (dataSourceId: number) => void;
  stopAllPolling: () => void;
}

export const useDataSourceStore = create<DataSourceState>((set, get) => ({
  dataSources: [],
  isLoading: false,
  error: null,

  fetchDataSources: async () => {
    const { activeWorkspace } = useWorkspaceStore.getState();
    if (!activeWorkspace?.id) return;

    set({ isLoading: true, error: null });
    try {
      const response: DataSourcesOut = await DatasourcesService.listDatasources({
        workspaceId: activeWorkspace.id,
        limit: 1000,
        includeCounts: true
      });

      const clientDataSources = response.data;
      
      const adaptedDataSources = clientDataSources.map(adaptDataSourceReadToDataSource);
      // Ensure polling starts for all pending sources from the response
      adaptedDataSources.forEach(ds => {
          if (ds.status === 'pending') {
             get().startPollingDataSourceStatus(ds.id);
          }
      });
      set({ dataSources: adaptedDataSources, isLoading: false });
    } catch (err: any) {
      console.error("Error fetching data sources:", err);
      set({ error: "Failed to fetch data sources", isLoading: false, dataSources: [] });
    }
  },

  createDataSource: async (formData: FormData): Promise<DataSource | null> => {
    const { activeWorkspace } = useWorkspaceStore.getState();
    if (!activeWorkspace?.id) {
      set({ error: "No active workspace selected" });
      return null;
    }

    set({ isLoading: true, error: null });
    try {
      // --- CORRECTED: Structure the payload correctly for the service ---
      // The service expects an object with workspaceId and a formData key
      // containing the actual form fields.
      // Define the payload structure inline based on the service expectation
      const servicePayload = {
         workspaceId: activeWorkspace.id,
         formData: { // Nest form fields under 'formData'
           // Required fields:
           name: formData.get('name') as string,
           type: formData.get('type') as ClientDataSourceType,
           origin_details: formData.get('origin_details') as string,
           // Optional fields:
           // Use getAll('files') as the backend expects a list for 'files'
           files: formData.getAll('files') as File[],
           skip_rows: formData.has('skip_rows') ? parseInt(formData.get('skip_rows') as string, 10) : undefined,
           delimiter: formData.has('delimiter') ? formData.get('delimiter') as string : undefined,
         }
      };
      console.log("Sending payload to DataSourcesService.createDatasource:", servicePayload);
      const response: DataSourcesOut = await DatasourcesService.createDatasource(servicePayload);
      // --- End Correction ---


      // Assuming the API returns the created source(s) in the data array
      if (!response || !response.data || response.data.length === 0) {
        throw new Error("API did not return the created data source(s) in the expected format.");
      }

      // Adapt all returned sources (for bulk PDF)
      const createdAdaptedSources = response.data.map(adaptDataSourceReadToDataSource);

      set(state => ({
        // Prepend all new sources to the list
        dataSources: [...createdAdaptedSources, ...state.dataSources],
        isLoading: false,
      }));

      // Start polling for all newly created pending sources
      createdAdaptedSources.forEach(adaptedDataSource => {
        if (adaptedDataSource.status === 'pending') {
            get().startPollingDataSourceStatus(adaptedDataSource.id);
        }
      });


      // Return the first created source (or null if none)
      return createdAdaptedSources.length > 0 ? createdAdaptedSources[0] : null;
    } catch (err: any) {
      console.error("Error creating data source:", err);
      let errorMsg = "Failed to create data source";
      if (err.body?.detail) {
        errorMsg = typeof err.body.detail === 'string'
          ? `Failed: ${err.body.detail}`
          : `Failed: ${JSON.stringify(err.body.detail)}`;
      } else if (err.message) {
         errorMsg = `Failed: ${err.message}`;
      }
      set({ error: errorMsg, isLoading: false });
      return null;
    }
  },

  deleteDataSource: async (dataSourceId: number): Promise<void> => {
    const { activeWorkspace } = useWorkspaceStore.getState();
    if (!activeWorkspace?.id) {
      set({ error: "No active workspace selected" });
      return;
    }
    
    set({ isLoading: true, error: null });
    try {
      await DatasourcesService.deleteDatasource({
        workspaceId: activeWorkspace.id,
        datasourceId: dataSourceId,
      });
      
      set(state => ({
        dataSources: state.dataSources.filter(ds => ds.id !== dataSourceId),
        isLoading: false,
      }));
    } catch (err: any) {
      console.error(`Error deleting data source ${dataSourceId}:`, err);
      set({ error: `Failed to delete data source ${dataSourceId}`, isLoading: false });
    }
  },

  startPollingDataSourceStatus: (dataSourceId: number) => {
    const { dataSources } = get();
    const dataSource = dataSources.find(ds => ds.id === dataSourceId);

    // Don't poll if not pending/processing or already polling
    if (!dataSource || (dataSource.status !== 'pending' && dataSource.status !== 'processing') || pollingIntervals[dataSourceId]) {
      return;
    }

    console.log(`Starting polling for DataSource ${dataSourceId}`);

    const poll = async () => {
      const { activeWorkspace } = useWorkspaceStore.getState();
      if (!activeWorkspace?.id) {
        console.warn(`Cannot poll DataSource ${dataSourceId}, no active workspace.`);
        get().stopPollingDataSourceStatus(dataSourceId); // Stop polling if workspace lost
        return;
      }

      try {
        const updatedDataSourceRead: ClientDataSourceRead = await DatasourcesService.getDatasource({
          workspaceId: activeWorkspace.id,
          datasourceId: dataSourceId,
        });
        const adaptedStatus = adaptDataSourceReadToDataSource(updatedDataSourceRead).status;

        // Update store if status changed
        set((state: DataSourceState): Partial<DataSourceState> => {
          const index = state.dataSources.findIndex(ds => ds.id === dataSourceId);
          let updated = false;
          if (index !== -1) {
            const currentStatus = state.dataSources[index].status;
            if (currentStatus !== adaptedStatus) {
              console.log(`DataSource ${dataSourceId} status changed from ${currentStatus} to ${adaptedStatus}`);
              state.dataSources[index].status = adaptedStatus; // Immer handles this mutation
              updated = true;
              // Stop polling if it reached a terminal state
              if (adaptedStatus === 'complete' || adaptedStatus === 'failed') {
                get().stopPollingDataSourceStatus(dataSourceId);
              }
            }
          } else {
             console.warn(`DataSource ${dataSourceId} not found in store during poll update.`);
             get().stopPollingDataSourceStatus(dataSourceId); // Stop polling if not found
          }
          // Only return the updated portion if something changed
          return updated ? { dataSources: state.dataSources } : {}; // Return partial state
        });

      } catch (error) {
        console.error(`Error polling status for DataSource ${dataSourceId}:`, error);
        // Optionally stop polling on error or implement retry logic
        // get().stopPollingDataSourceStatus(dataSourceId);
      }
    };

    // Initial immediate check
    poll();
    // Set interval
    pollingIntervals[dataSourceId] = setInterval(poll, POLLING_INTERVAL_MS);
  },

  stopPollingDataSourceStatus: (dataSourceId: number) => {
    if (pollingIntervals[dataSourceId]) {
      console.log(`Stopping polling for DataSource ${dataSourceId}`);
      clearInterval(pollingIntervals[dataSourceId]);
      delete pollingIntervals[dataSourceId];
    }
  },

  stopAllPolling: () => {
     console.log('Stopping all data source polling.');
     Object.keys(pollingIntervals).forEach(idStr => {
       const id = parseInt(idStr);
       if (!isNaN(id)) {
         get().stopPollingDataSourceStatus(id);
       }
     });
  },

})); 