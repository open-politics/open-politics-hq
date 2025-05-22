import { create } from 'zustand';
import { useWorkspaceStore } from '@/zustand_stores/storeWorkspace';
import { DatasourcesService } from '@/client/services';
import { 
    DataSourceRead as ClientDataSourceRead,
    DataSourceType as ClientDataSourceType,
    DataSourcesOut,
    DataSourceStatus as ClientDataSourceStatus,
    DataSourceUpdate,
    Message,
    DataRecordRead as ClientDataRecordRead,
    DataRecordUpdate as ClientDataRecordUpdate,
    ResourceType,
} from '@/client/models';
import { DatarecordsService } from '@/client/services';
import { DataSource, DataSourceType, DataSourceStatus, DataRecord } from '@/lib/classification/types';
import { adaptDataSourceReadToDataSource, adaptDataRecordReadToDataRecord } from '@/lib/classification/adapters';
import { toast } from 'sonner';
import { useShareableStore, BatchImportSummary, SingleImportSuccess, BatchReport, BatchImportSuccessItem, BatchImportFailedItem } from './storeShareables';

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
  updateDataSource: (dataSourceId: number, updateData: DataSourceUpdate) => Promise<DataSource | null>;
  refetchDataSource: (dataSourceId: number) => Promise<boolean>;
  startPollingDataSourceStatus: (dataSourceId: number) => void;
  stopPollingDataSourceStatus: (dataSourceId: number) => void;
  stopAllPolling: () => void;
  addUrlToDataSource: (dataSourceId: number, url: string) => Promise<boolean>;
  updateDataSourceUrls: (dataSourceId: number, newUrls: string[]) => Promise<boolean>;
  getDataSourceUrls: (dataSourceId: number) => Promise<string[]>;
  selectedDataSourceRecords: DataRecord[];
  isLoadingRecords: boolean;
  fetchDataRecordsForSource: (dataSourceId: number) => Promise<void>;
  clearSelectedDataSourceRecords: () => void;
  updateDataRecord: (recordId: number, updateData: ClientDataRecordUpdate) => Promise<DataRecord | null>;

  // New actions for import/export
  exportDataSource: (dataSourceId: number) => Promise<void>;
  exportMultipleDataSources: (dataSourceIds: number[]) => Promise<void>;
  importDataSource: (workspaceId: number, file: File) => Promise<DataSource | null>;
}

export const useDataSourceStore = create<DataSourceState>((set, get) => ({
  dataSources: [],
  isLoading: false,
  error: null,
  selectedDataSourceRecords: [],
  isLoadingRecords: false,

  fetchDataSources: async () => {
    const { activeWorkspace } = useWorkspaceStore.getState();
    if (!activeWorkspace?.id) return;

    set({ isLoading: true, error: null });
    try {
      const response: DataSourcesOut = await DatasourcesService.listDatasources({
        workspaceId: activeWorkspace.id,
        limit: 1000,
      });

      const clientDataSources = response.data;
      
      const adaptedDataSources = clientDataSources.map(adaptDataSourceReadToDataSource);
      // Ensure polling starts for all pending sources from the response
      adaptedDataSources.forEach(ds => {
          if (ds.status === 'pending' || ds.status === 'processing') {
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
        if (adaptedDataSource.status === 'pending' || adaptedDataSource.status === 'processing') {
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
      toast.error(errorMsg);
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

  updateDataSource: async (dataSourceId: number, updateData: DataSourceUpdate): Promise<DataSource | null> => {
      const { activeWorkspace } = useWorkspaceStore.getState();
      if (!activeWorkspace?.id) {
        set({ error: "No active workspace selected for update" });
        return null;
      }
      
      set({ isLoading: true, error: null });
      try {
          console.log(`Updating DataSource ${dataSourceId} with data:`, updateData);
          const updatedClientSource: ClientDataSourceRead = await DatasourcesService.updateDatasource({
              workspaceId: activeWorkspace.id,
              datasourceId: dataSourceId,
              requestBody: updateData
          });

          const updatedAdaptedSource = adaptDataSourceReadToDataSource(updatedClientSource);

          set(state => {
              const index = state.dataSources.findIndex(ds => ds.id === dataSourceId);
              if (index !== -1) {
                  const newDataSources = [...state.dataSources];
                  newDataSources[index] = updatedAdaptedSource;
                  return { dataSources: newDataSources, isLoading: false };
              } else {
                  console.warn(`DataSource ${dataSourceId} not found in store during update.`);
                  return { isLoading: false }; 
              }
          });
          toast.success("DataSource updated successfully!");
          return updatedAdaptedSource;
      } catch (err: any) {
          console.error(`Error updating data source ${dataSourceId}:`, err);
          let errorMsg = "Failed to update data source";
          if (err.body?.detail) {
            errorMsg = typeof err.body.detail === 'string'
              ? `Update Failed: ${err.body.detail}`
              : `Update Failed: ${JSON.stringify(err.body.detail)}`;
          } else if (err.message) {
            errorMsg = `Update Failed: ${err.message}`;
          }
          set({ error: errorMsg, isLoading: false });
          toast.error(errorMsg);
          return null;
      }
  },

  refetchDataSource: async (dataSourceId: number): Promise<boolean> => {
      const { activeWorkspace } = useWorkspaceStore.getState();
      if (!activeWorkspace?.id) {
        set({ error: "No active workspace selected for refetch" });
        return false;
      }

      set({ isLoading: true, error: null });
      try {
          const response: Message = await DatasourcesService.refetchDatasource({
              workspaceId: activeWorkspace.id,
              datasourceId: dataSourceId
          });
          set({ isLoading: false });
          toast.info(response.message || "Refetch task queued successfully.");
          
          return true;
      } catch (err: any) {
          console.error(`Error triggering refetch for data source ${dataSourceId}:`, err);
          let errorMsg = "Failed to trigger refetch";
          if (err.body?.detail) {
            errorMsg = typeof err.body.detail === 'string'
              ? `Refetch Failed: ${err.body.detail}`
              : `Refetch Failed: ${JSON.stringify(err.body.detail)}`;
          } else if (err.message) {
            errorMsg = `Refetch Failed: ${err.message}`;
          }
          set({ error: errorMsg, isLoading: false });
          toast.error(errorMsg);
          return false;
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
          if (index !== -1) {
            // --- CORRECTED: Update the entire record --- 
            const currentDataSource = state.dataSources[index];
            const adaptedDataSource = adaptDataSourceReadToDataSource(updatedDataSourceRead);
            
            // Check if the entire object is different (or specific key fields like status, count)
            // For simplicity, we can check status and count, or rely on object reference change
            if (currentDataSource.status !== adaptedDataSource.status || currentDataSource.data_record_count !== adaptedDataSource.data_record_count) {
                 console.log(`DataSource ${dataSourceId} updated. Status: ${adaptedDataSource.status}, Count: ${adaptedDataSource.data_record_count}`);
                 // Replace the old object with the new adapted one by creating a new array
                 const newDataSources = state.dataSources.map(ds =>
                    ds.id === dataSourceId ? adaptedDataSource : ds
                 );

                 // Stop polling if it reached a terminal state
                 if (adaptedDataSource.status === 'complete' || adaptedDataSource.status === 'failed') {
                     get().stopPollingDataSourceStatus(dataSourceId);
                 }
                 return { dataSources: newDataSources }; // Return the new array for state update
            }
            // --- END CORRECTION ---
          } else {
             console.warn(`DataSource ${dataSourceId} not found in store during poll update.`);
             get().stopPollingDataSourceStatus(dataSourceId); // Stop polling if not found
          }
          // Only return the updated portion if something changed
          return {}; // Return empty object if no changes to trigger update
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

  // --- ADDED: URL List Management Functions ---
  addUrlToDataSource: async (dataSourceId: number, url: string): Promise<boolean> => {
    const { activeWorkspace } = useWorkspaceStore.getState();
    if (!activeWorkspace?.id) {
      toast.error("No active workspace selected to add URL");
      return false;
    }

    set({ isLoading: true, error: null });
    try {
      // Use the DatarecordsService (assuming client regeneration created it)
      // Check your generated client for the correct service and method names
      // It might be under DatarecordsService or similar.
      // The route was POST /workspaces/{workspace_id}/datarecords/by_datasource/{datasource_id}/records

      
      await DatarecordsService.appendRecord({ 
        workspaceId: activeWorkspace.id,
        datasourceId: dataSourceId,
        requestBody: { // Ensure requestBody structure matches the Pydantic model AppendRecordInput
            content: url,
            content_type: 'url',
            // event_timestamp: undefined // or provide if needed
        }
      });

      set({ isLoading: false });
      toast.success(`URL added successfully: ${url}`);
      // Optionally: Instead of full refetch, update the specific DS in the store 
      // by fetching its updated state (including origin_details and count)
      // For simplicity, let's trigger a full refresh for now.
      get().fetchDataSources(); 
      return true;
    } catch (err: any) {
      console.error(`Error adding URL ${url} to data source ${dataSourceId}:`, err);
      let errorMsg = "Failed to add URL";
      if (err.body?.detail) {
        errorMsg = `Add URL Failed: ${typeof err.body.detail === 'string' ? err.body.detail : JSON.stringify(err.body.detail)}`;
      } else if (err.message) {
        errorMsg = `Add URL Failed: ${err.message}`;
      }
      set({ error: errorMsg, isLoading: false });
      toast.error(errorMsg);
      return false;
    }
  },

  updateDataSourceUrls: async (dataSourceId: number, newUrls: string[]): Promise<boolean> => {
    const { activeWorkspace } = useWorkspaceStore.getState();
    if (!activeWorkspace?.id) {
      toast.error("No active workspace selected to update URLs");
      return false;
    }

    set({ isLoading: true, error: null });
    try {
      // Use DatasourcesService.updateDatasourceUrls
      // The route was PUT /workspaces/{workspace_id}/datasources/{datasource_id}/urls
      await DatasourcesService.updateDatasourceUrls({ 
          workspaceId: activeWorkspace.id,
          datasourceId: dataSourceId,
          requestBody: { // Body takes an object with the parameter name as key
              urls_input: newUrls
          }
      });

      set({ isLoading: false });
      toast.success(`DataSource URL list updated successfully.`);
      // Refetch to update the state
      get().fetchDataSources(); 
      return true;
    } catch (err: any) {
      console.error(`Error updating URLs for data source ${dataSourceId}:`, err);
      let errorMsg = "Failed to update URL list";
       if (err.body?.detail) {
        errorMsg = `Update URLs Failed: ${typeof err.body.detail === 'string' ? err.body.detail : JSON.stringify(err.body.detail)}`;
      } else if (err.message) {
        errorMsg = `Update URLs Failed: ${err.message}`;
      }
      set({ error: errorMsg, isLoading: false });
      toast.error(errorMsg);
      return false;
    }
  },
  
  getDataSourceUrls: async (dataSourceId: number): Promise<string[]> => {
    const { activeWorkspace } = useWorkspaceStore.getState();
    if (!activeWorkspace?.id) {
      toast.error("No active workspace selected to get URLs");
      return [];
    }

    // No loading state set here as it's just fetching data for display
    try {
      // Use DatasourcesService.getDatasourceUrls
      // The route was GET /workspaces/{workspace_id}/datasources/{datasource_id}/urls
      const urls = await DatasourcesService.getDatasourceUrls({ 
          workspaceId: activeWorkspace.id,
          datasourceId: dataSourceId
      });
      return urls;
    } catch (err: any) {
      console.error(`Error fetching URLs for data source ${dataSourceId}:`, err);
      let errorMsg = "Failed to fetch URL list";
       if (err.body?.detail) {
        errorMsg = `Fetch URLs Failed: ${typeof err.body.detail === 'string' ? err.body.detail : JSON.stringify(err.body.detail)}`;
      } else if (err.message) {
        errorMsg = `Fetch URLs Failed: ${err.message}`;
      }
      // Don't set store error state, just toast and return empty
      toast.error(errorMsg);
      return [];
    }
  },
  // --- END ADDED --- 

  // --- ADDED: Functions to fetch and manage DataRecords --- 
  fetchDataRecordsForSource: async (dataSourceId: number) => {
    const { activeWorkspace } = useWorkspaceStore.getState();
    if (!activeWorkspace?.id) {
      set({ error: "No active workspace selected to fetch records", selectedDataSourceRecords: [], isLoadingRecords: false });
      return;
    }

    set({ isLoadingRecords: true, error: null });
    try {
      // Use the DatarecordsService to list records
      const response: ClientDataRecordRead[] = await DatarecordsService.listDatarecords({
        workspaceId: activeWorkspace.id,
        datasourceId: dataSourceId,
        limit: 2000, // TODO: Consider pagination if needed
      });

      console.log('[storeDataSources] Raw API Response for records:', response);

      const adaptedRecords: DataRecord[] = response.map(adaptDataRecordReadToDataRecord);

      console.log('[storeDataSources] Adapted Records:', adaptedRecords);

      set({ selectedDataSourceRecords: adaptedRecords, isLoadingRecords: false });

    } catch (err: any) {
      console.error(`Error fetching data records for source ${dataSourceId}:`, err);
      let errorMsg = "Failed to fetch data records";
      if (err.body?.detail) {
        errorMsg = `Fetch Records Failed: ${typeof err.body.detail === 'string' ? err.body.detail : JSON.stringify(err.body.detail)}`;
      } else if (err.message) {
        errorMsg = `Fetch Records Failed: ${err.message}`;
      }
      set({ error: errorMsg, isLoadingRecords: false, selectedDataSourceRecords: [] });
      toast.error(errorMsg);
    }
  },

  clearSelectedDataSourceRecords: () => {
    set({ selectedDataSourceRecords: [], isLoadingRecords: false });
  },

  // --- ADDED: updateDataRecord --- 
  updateDataRecord: async (recordId: number, updateData: ClientDataRecordUpdate): Promise<DataRecord | null> => {
    const { activeWorkspace } = useWorkspaceStore.getState();
    const { selectedDataSourceRecords } = get();
    if (!activeWorkspace?.id) {
      toast.error("No active workspace selected to update record");
      return null;
    }

    // No isLoading state change for this specific update, maybe add one later if needed
    set({ error: null }); 
    try {
      // Call the new DatarecordsService method
      const updatedClientRecord: ClientDataRecordRead = await DatarecordsService.updateDatarecord({
        workspaceId: activeWorkspace.id,
        datarecordId: recordId,
        requestBody: updateData
      });

      const updatedAdaptedRecord = adaptDataRecordReadToDataRecord(updatedClientRecord);

      // Update the record within the selectedDataSourceRecords array
      set(state => {
        const index = state.selectedDataSourceRecords.findIndex(r => r.id === recordId);
        if (index !== -1) {
          const newRecords = [...state.selectedDataSourceRecords];
          newRecords[index] = updatedAdaptedRecord;
          return { selectedDataSourceRecords: newRecords };
        }
        return {}; // Return empty object if record not found in current selection
      });

      toast.success("Data Record updated successfully!");
      return updatedAdaptedRecord;

    } catch (err: any) {
      console.error(`Error updating data record ${recordId}:`, err);
      let errorMsg = "Failed to update data record";
      if (err.body?.detail) {
        errorMsg = `Update Record Failed: ${typeof err.body.detail === 'string' ? err.body.detail : JSON.stringify(err.body.detail)}`;
      } else if (err.message) {
        errorMsg = `Update Record Failed: ${err.message}`;
      }
      set({ error: errorMsg }); // Set error in store
      toast.error(errorMsg);
      return null;
    }
  },
  // --- END ADDED ---

  // --- IMPORT/EXPORT ACTIONS --- 
  exportDataSource: async (dataSourceId: number) => {
    const { activeWorkspace } = useWorkspaceStore.getState();
    if (!activeWorkspace?.id) {
      toast.error("No active workspace selected for export.");
      return;
    }
    set({ isLoading: true, error: null });
    try {
      await useShareableStore.getState().exportResource('data_source' as ResourceType, dataSourceId);
      set({ isLoading: false });
      toast.success("DataSource export initiated.");
    } catch (err) {
      console.error("Export DataSource error:", err);
      const message = err instanceof Error ? err.message : 'Failed to export DataSource';
      set({ error: message, isLoading: false });
      toast.error(message);
    }
  },

  exportMultipleDataSources: async (dataSourceIds: number[]) => {
    const { activeWorkspace } = useWorkspaceStore.getState();
    if (!activeWorkspace?.id) {
      toast.error("No active workspace selected for batch export.");
      return;
    }
    if (!dataSourceIds || dataSourceIds.length === 0) {
      toast.info("No DataSources selected for export.");
      return;
    }
    set({ isLoading: true, error: null });
    try {
      await useShareableStore.getState().exportResourcesBatch('data_source' as ResourceType, dataSourceIds);
      set({ isLoading: false });
      toast.success("Batch DataSource export initiated.");
    } catch (err) {
      console.error("Batch export DataSources error:", err);
      const message = err instanceof Error ? err.message : 'Failed to batch export DataSources';
      set({ error: message, isLoading: false });
      toast.error(message);
    }
  },

  importDataSource: async (workspaceId: number, file: File): Promise<DataSource | null> => {
    set({ isLoading: true, error: null });
    let firstSuccessfullyImportedDataSource: DataSource | null = null;

    try {
      const result = await useShareableStore.getState().importResource(file, workspaceId);

      if (!result) {
        throw new Error("Import operation returned no result.");
      }

      // Check if it's a batch import result by looking for the nested 'batch_summary' key
      if ('batch_summary' in result && result.batch_summary) {
        const batchResult = result as BatchImportSummary; // Type assertion
        toast.info(batchResult.message || "Batch import processing started.");
        let successfulDSCount = 0;

        // Iterate over successful_imports from the nested batch_summary
        for (const item of batchResult.batch_summary.successful_imports) {
          // Check resource_type directly (it's an enum member, not a string to be converted by valueOf)
          if (item.resource_type === 'data_source' && item.imported_resource_id) {
            try {
              const newDsClient = await DatasourcesService.getDatasource({ workspaceId, datasourceId: item.imported_resource_id });
              const newDsAdapted = adaptDataSourceReadToDataSource(newDsClient);
              set(state => ({
                dataSources: [newDsAdapted, ...state.dataSources],
                // isLoading: false, // Keep true if processing more, but this simplifies for now
              }));
              toast.success(`DataSource '${item.imported_resource_name || newDsAdapted.name}' imported successfully from batch.`);
              get().startPollingDataSourceStatus(newDsAdapted.id);
              if (!firstSuccessfullyImportedDataSource) {
                firstSuccessfullyImportedDataSource = newDsAdapted;
              }
              successfulDSCount++;
            } catch (fetchErr) {
              console.error(`Error fetching details for imported DataSource ID ${item.imported_resource_id} from batch:`, fetchErr);
              toast.error(`Failed to fetch details for imported DataSource '${item.imported_resource_name || 'Unknown'}' from batch.`);
            }
          }
        }

        // Iterate over failed_imports from the nested batch_summary
        for (const item of batchResult.batch_summary.failed_imports) {
          toast.error(`Failed to import '${item.filename}' from batch: ${item.error}`);
        }
        
        if (successfulDSCount === 0 && batchResult.batch_summary.failed_imports.length > 0){
            // No successes but some failures
             throw new Error("All items in the batch failed to import as DataSources.")
        } else if (successfulDSCount === 0 && batchResult.batch_summary.successful_imports.length === 0) {
            // No successes and no failures probably means no data sources were in the batch
            // or none of the successful items were DataSources.
            throw new Error("No DataSources found or successfully imported from the batch.")
        }
        // If at least one DS was successful, we return the first one (or null if loop didn't run for DS)
        set({ isLoading: false }); // Ensure loading is false at the end of batch processing
        return firstSuccessfullyImportedDataSource;

      } else if ('resource_type' in result && result.resource_type === 'data_source') {
        // Handle single import success
        const singleResult = result as SingleImportSuccess; // Type assertion
        const importedId = singleResult.imported_resource_id || singleResult.id; 
        const importedName = singleResult.imported_resource_name || singleResult.name || "Imported DataSource";

        if (importedId) {
          const newDsClient = await DatasourcesService.getDatasource({ workspaceId, datasourceId: importedId as number});
          const newDsAdapted = adaptDataSourceReadToDataSource(newDsClient);
          set(state => ({
            dataSources: [newDsAdapted, ...state.dataSources],
            isLoading: false,
          }));
          toast.success(`DataSource '${newDsAdapted.name}' imported successfully.`);
          get().startPollingDataSourceStatus(newDsAdapted.id);
          return newDsAdapted;
        } else {
          throw new Error("Single import success response did not contain a valid DataSource ID.");
        }
      } else {
        // If result is not null, but not a recognized batch or single DS success
        console.warn("Unrecognized import result structure:", result);
        throw new Error("Imported resource was not a valid DataSource or ID missing.");
      }

    } catch (err) {
      console.error("Import DataSource error:", err);
      const message = err instanceof Error ? err.message : 'Failed to import DataSource';
      set({ error: message, isLoading: false });
      toast.error(message);
      return null;
    }
  },

})); 