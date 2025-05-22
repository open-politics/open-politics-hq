import { create } from 'zustand';
import { toast } from 'sonner';
import { useWorkspaceStore } from '@/zustand_stores/storeWorkspace';
import { DatasetsService } from '@/client/services';
import {
    DatasetRead,
    DatasetCreate,
    DatasetUpdate,
    DatasetsOut,
    ResourceType,
    // Message, // Message is not used directly here, can be removed if not needed for other parts
} from '@/client/models';
import { useShareableStore } from './storeShareables';

// Utility for file download (can be moved to a shared utils file later)
const triggerDownload = (blob: Blob, filename: string) => {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  };

interface DatasetState {
    datasets: DatasetRead[];
    isLoading: boolean;
    error: string | null;
    // Core Dataset Operations
    fetchDatasets: () => Promise<void>;
    createDataset: (datasetData: DatasetCreate) => Promise<DatasetRead | null>;
    updateDataset: (datasetId: number, updateData: DatasetUpdate) => Promise<DatasetRead | null>;
    deleteDataset: (datasetId: number) => Promise<void>;
    // Export Operations
    exportDataset: (datasetId: number, options: ExportOptions) => Promise<void>;
    exportMultipleDatasets: (datasetIds: number[], options: ExportOptions) => Promise<void>;
    // Import Operations
    importDataset: (file: File, conflictStrategy?: 'skip' | 'update' | 'replace') => Promise<DatasetRead | null>;
    importFromToken: (token: string, options?: ImportOptions) => Promise<DatasetRead | null>;
}

export interface ExportOptions { // Exported for use in components
    includeRecordContent?: boolean;
    includeResults?: boolean;
    includeSourceFiles?: boolean;
}

export interface ImportOptions { // Exported for use in components
    includeContent?: boolean; // Corresponds to includeRecordContent on backend for dataset export
    includeResults?: boolean;
    conflictStrategy?: 'skip' | 'update' | 'replace'; // This is for importDataset
    workspaceId?: number; // Added for importFromToken to specify target workspace
    // For importDatasetFromToken, the backend API has include_content, include_results, conflict_strategy.
    // The client has includeContent, includeResults, conflictStrategy for importDatasetFromToken as well.
}

export const useDatasetStore = create<DatasetState>((set, get) => ({
    datasets: [],
    isLoading: false,
    error: null,

    fetchDatasets: async () => {
        const { activeWorkspace } = useWorkspaceStore.getState();
        if (!activeWorkspace?.id) {
            set({ error: "No active workspace selected", isLoading: false });
            return;
        }

        set({ isLoading: true, error: null });
        try {
            const response: DatasetsOut = await DatasetsService.listDatasets({
                workspaceId: activeWorkspace.id,
                skip: 0,
                limit: 1000 // Increased limit, consider pagination for UI
            });
            
            if (!response || !response.data) {
                throw new Error("Invalid response format from server");
            }
            
            set({ datasets: response.data, isLoading: false });
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : "Failed to fetch datasets";
            if ((err as any).body?.detail) {
                const detail = (err as any).body.detail;
                set({ error: typeof detail === 'string' ? detail : JSON.stringify(detail), isLoading: false, datasets: [] });
            } else {
                set({ error: errorMsg, isLoading: false, datasets: [] });
            }
            toast.error(errorMsg);
            console.error("Error fetching datasets:", err);
        }
    },

    createDataset: async (datasetData: DatasetCreate): Promise<DatasetRead | null> => {
        const { activeWorkspace } = useWorkspaceStore.getState();
        if (!activeWorkspace?.id) {
            toast.error("No active workspace selected");
            return null;
        }

        set({ isLoading: true, error: null });
        try {
            const dataset = await DatasetsService.createDataset({
                workspaceId: activeWorkspace.id,
                requestBody: datasetData
            });

            set(state => ({
                datasets: [dataset, ...state.datasets].sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()), // Keep sorted by date
                isLoading: false
            }));

            toast.success(`Dataset "${dataset.name}" created successfully`);
            return dataset;
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : "Failed to create dataset";
            const detail = (err as any).body?.detail;
            const finalMsg = detail ? (typeof detail === 'string' ? detail : JSON.stringify(detail)) : errorMsg;
            set({ error: finalMsg, isLoading: false });
            toast.error(finalMsg);
            console.error("Error creating dataset:", err);
            return null;
        }
    },

    updateDataset: async (datasetId: number, updateData: DatasetUpdate): Promise<DatasetRead | null> => {
        const { activeWorkspace } = useWorkspaceStore.getState();
        if (!activeWorkspace?.id) {
            toast.error("No active workspace selected");
            return null;
        }

        set({ isLoading: true, error: null });
        try {
            const updated = await DatasetsService.updateDataset({
                workspaceId: activeWorkspace.id,
                datasetId: datasetId,
                requestBody: updateData
            });

            set(state => ({
                datasets: state.datasets.map(ds => ds.id === datasetId ? updated : ds).sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
                isLoading: false
            }));

            toast.success(`Dataset "${updated.name}" updated successfully`);
            return updated;
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : "Failed to update dataset";
            const detail = (err as any).body?.detail;
            const finalMsg = detail ? (typeof detail === 'string' ? detail : JSON.stringify(detail)) : errorMsg;
            set({ error: finalMsg, isLoading: false });
            toast.error(finalMsg);
            console.error("Error updating dataset:", err);
            return null;
        }
    },

    deleteDataset: async (datasetId: number): Promise<void> => {
        const { activeWorkspace } = useWorkspaceStore.getState();
        if (!activeWorkspace?.id) {
            toast.error("No active workspace selected");
            return;
        }

        set({ isLoading: true, error: null });
        try {
            await DatasetsService.deleteDataset({
                workspaceId: activeWorkspace.id,
                datasetId: datasetId
            });

            set(state => ({
                datasets: state.datasets.filter(ds => ds.id !== datasetId),
                isLoading: false
            }));

            toast.success("Dataset deleted successfully");
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : "Failed to delete dataset";
            const detail = (err as any).body?.detail;
            const finalMsg = detail ? (typeof detail === 'string' ? detail : JSON.stringify(detail)) : errorMsg;
            set({ error: finalMsg, isLoading: false });
            toast.error(finalMsg);
            console.error("Error deleting dataset:", err);
        }
    },

    exportDataset: async (datasetId: number, options: ExportOptions): Promise<void> => {
        const { activeWorkspace } = useWorkspaceStore.getState();
        if (!activeWorkspace?.id) {
            toast.error("No active workspace selected");
            return;
        }

        set({ isLoading: true, error: null });
        try {
            const response = await DatasetsService.exportDataset({
                workspaceId: activeWorkspace.id,
                datasetId: datasetId,
                includeContent: options.includeRecordContent,
                includeResults: options.includeResults,
                includeSourceFiles: options.includeSourceFiles
            });

            if (response instanceof Blob) {
                triggerDownload(response, `dataset_${datasetId}_export.zip`);
            } else {
                // This case should ideally not happen if the server respects OpenAPI `produces: application/zip` or similar
                // and the client is generated correctly to expect a Blob.
                console.error("Export dataset response is not a Blob:", response);
                toast.error("Export failed: Unexpected response format.");
                throw new Error("Export response was not a Blob as expected.");
            }
            
            set({ isLoading: false });
            toast.success("Dataset export initiated.");
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : "Failed to export dataset";
            const detail = (err as any).body?.detail;
            const finalMsg = detail ? (typeof detail === 'string' ? detail : JSON.stringify(detail)) : errorMsg;
            set({ error: finalMsg, isLoading: false });
            toast.error(finalMsg);
            console.error("Error exporting dataset:", err);
        }
    },

    exportMultipleDatasets: async (datasetIds: number[], options: ExportOptions): Promise<void> => {
        const { activeWorkspace } = useWorkspaceStore.getState();
        if (!activeWorkspace?.id) {
            toast.error("No active workspace selected");
            return;
        }
        if (!datasetIds || datasetIds.length === 0) {
            toast.info("No datasets selected for export.");
            return;
        }

        set({ isLoading: true, error: null });
        try {
            // The DatasetsService does not have a batch export. 
            // We will use the ShareableStore for this.
            // This assumes useShareableStore can batch export datasets.
            // The ShareableService backend supports batch export by resource type.
            const { exportResourcesBatch } = useShareableStore.getState();
            await exportResourcesBatch('dataset' as ResourceType, datasetIds);
            // Note: The `options` (includeRecordContent etc.) are not directly passed to exportResourcesBatch
            // as the generic batch exporter in ShareableService might use default export settings for each resource type.
            // If fine-grained control per item in a batch is needed, the backend ShareableService.export_resources_batch
            // would need to accept such options, or we loop and call individual exports here (less efficient).

            set({ isLoading: false });
            toast.success("Batch dataset export initiated.");
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : "Failed to batch export datasets";
            const detail = (err as any).body?.detail;
            const finalMsg = detail ? (typeof detail === 'string' ? detail : JSON.stringify(detail)) : errorMsg;
            set({ error: finalMsg, isLoading: false });
            toast.error(finalMsg);
            console.error("Error batch exporting datasets:", err);
        }
    },

    importDataset: async (file: File, conflictStrategy: 'skip' | 'update' | 'replace' = 'skip'): Promise<DatasetRead | null> => {
        const { activeWorkspace } = useWorkspaceStore.getState();
        if (!activeWorkspace?.id) {
            toast.error("No active workspace selected for import.");
            return null;
        }
        set({ isLoading: true, error: null });
        try {
            const importedDataset = await DatasetsService.importDataset({
                workspaceId: activeWorkspace.id,
                formData: { file },
                conflictStrategy: conflictStrategy,
            });
            
            set(state => ({
                datasets: [importedDataset, ...state.datasets].sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
                isLoading: false
            }));
            toast.success(`Dataset "${importedDataset.name}" imported successfully.`);
            return importedDataset;
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : "Failed to import dataset";
            const detail = (err as any).body?.detail;
            const finalMsg = detail ? (typeof detail === 'string' ? detail : JSON.stringify(detail)) : errorMsg;
            set({ error: finalMsg, isLoading: false });
            toast.error(finalMsg);
            console.error("Error importing dataset:", err);
            return null;
        }
    },

    importFromToken: async (token: string, options?: ImportOptions): Promise<DatasetRead | null> => {
        const targetWorkspaceId = options?.workspaceId || useWorkspaceStore.getState().activeWorkspace?.id;

        if (!targetWorkspaceId) {
            toast.error("Target workspace ID must be specified for importing dataset from token.");
            set({ isLoading: false, error: "Target workspace ID missing for token import" });
            return null;
        }

        set({ isLoading: true, error: null });
        try {
            const dataset = await DatasetsService.importDatasetFromToken({
                workspaceId: targetWorkspaceId, // Use the determined workspaceId
                shareToken: token,
                includeContent: options?.includeContent,
                includeResults: options?.includeResults,
                conflictStrategy: options?.conflictStrategy
            });

            const currentActiveWorkspaceId = useWorkspaceStore.getState().activeWorkspace?.id;
            if (dataset.workspace_id === currentActiveWorkspaceId) {
                set(state => ({
                    datasets: [dataset, ...state.datasets].sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
                    isLoading: false
                }));
                toast.success(`Dataset "${dataset.name}" imported successfully into the current workspace.`);
            } else {
                set({ isLoading: false }); // Still imported, but not to current active workspace visible list
                toast.success(`Dataset "${dataset.name}" imported into workspace ID ${dataset.workspace_id}. Switch to that workspace to view it.`);
            }
            return dataset;
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : "Failed to import dataset from token";
            const detail = (err as any).body?.detail;
            const finalMsg = detail ? (typeof detail === 'string' ? detail : JSON.stringify(detail)) : errorMsg;
            set({ error: finalMsg, isLoading: false });
            toast.error(finalMsg);
            console.error("Error importing dataset from token:", err);
            return null;
        }
    }
})); 