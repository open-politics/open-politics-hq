import { create } from 'zustand';
import { useWorkspaceStore } from '@/zustand_stores/storeWorkspace';
import { DataSourcesService } from '@/client/services';
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
      const response: DataSourcesOut = await DataSourcesService.readDatasources({
        workspaceId: activeWorkspace.id,
        limit: 1000,
        includeCounts: true
      });

      const clientDataSources = response.data;
      
      const adaptedDataSources = clientDataSources.map(adaptDataSourceReadToDataSource);
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
      // Construct the object containing all necessary form fields
      // for the DataSourcesService.createDatasource call.
      const serviceCallPayload: {
          name: string;
          type: ClientDataSourceType;
          origin_details: string; // Keep sending the stringified JSON for non-CSV details
          file?: File;
          skip_rows?: number;
          delimiter?: string;
      } = {
          name: formData.get('name') as string,
          type: formData.get('type') as ClientDataSourceType,
          origin_details: formData.get('origin_details') as string, // Will be "{}" for CSV usually now
      };

      // Conditionally add fields present in the FormData
      if (formData.has('file')) {
        serviceCallPayload.file = formData.get('file') as File;
      }
      if (formData.has('skip_rows')) {
        // Parse to number as expected by the backend Form(...) definition
        serviceCallPayload.skip_rows = parseInt(formData.get('skip_rows') as string, 10);
      }
      if (formData.has('delimiter')) {
        serviceCallPayload.delimiter = formData.get('delimiter') as string;
      }

      console.log("Sending payload to DataSourcesService.createDatasource:", serviceCallPayload);

      // Pass the correctly assembled payload to the service
      // Expect DataSourcesOut as per client definition
      const response: DataSourcesOut = await DataSourcesService.createDatasource({
         workspaceId: activeWorkspace.id,
         formData: serviceCallPayload // Pass the object containing all fields
      });

      // Assuming the API returns the created source as the first item in the data array
      if (!response || !response.data || response.data.length === 0) {
        throw new Error("API did not return the created data source in the expected format.");
      }
      const createdDataSourceRead: ClientDataSourceRead = response.data[0];

      const adaptedDataSource = adaptDataSourceReadToDataSource(createdDataSourceRead);

      set(state => ({
        dataSources: [adaptedDataSource, ...state.dataSources],
        isLoading: false,
      }));

      // Start polling if the source is pending
      if (adaptedDataSource.status === 'pending') {
         get().startPollingDataSourceStatus(adaptedDataSource.id);
      }

      return adaptedDataSource;
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
      await DataSourcesService.deleteDatasource({
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
        const updatedDataSourceRead: ClientDataSourceRead = await DataSourcesService.readDatasource({
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