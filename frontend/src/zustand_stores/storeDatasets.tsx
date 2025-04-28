import { create } from 'zustand';
import { toast } from 'sonner';
import { useWorkspaceStore } from '@/zustand_stores/storeWorkspace';
import { DatasetsService } from '@/client/services';
import {
    DatasetRead,
    DatasetCreate,
    DatasetUpdate,
    DatasetsOut,
    Message,
} from '@/client/models';

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
    importDataset: (file: File) => Promise<DatasetRead | null>;
    importFromToken: (token: string, options: ImportOptions) => Promise<DatasetRead | null>;
}

interface ExportOptions {
    includeRecordContent?: boolean;
    includeResults?: boolean;
    includeSourceFiles?: boolean;
}

interface ImportOptions {
    includeContent?: boolean;
    includeResults?: boolean;
    conflictStrategy?: 'skip' | 'update' | 'replace';
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
                limit: 200
            });
            
            if (!response || !response.data) {
                throw new Error("Invalid response format from server");
            }
            
            set({ datasets: response.data, isLoading: false });
        } catch (err: any) {
            console.error("Error fetching datasets:", err);
            let errorMsg = "Failed to fetch datasets";
            if (err.body?.detail) {
                errorMsg = typeof err.body.detail === 'string' 
                    ? err.body.detail 
                    : JSON.stringify(err.body.detail);
            }
            set({ error: errorMsg, isLoading: false, datasets: [] });
            toast.error(errorMsg);
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
                datasets: [dataset, ...state.datasets],
                isLoading: false
            }));

            toast.success("Dataset created successfully");
            return dataset;
        } catch (err: any) {
            console.error("Error creating dataset:", err);
            const errorMsg = err.body?.detail || "Failed to create dataset";
            set({ error: errorMsg, isLoading: false });
            toast.error(errorMsg);
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
                datasets: state.datasets.map(ds => ds.id === datasetId ? updated : ds),
                isLoading: false
            }));

            toast.success("Dataset updated successfully");
            return updated;
        } catch (err: any) {
            console.error("Error updating dataset:", err);
            const errorMsg = err.body?.detail || "Failed to update dataset";
            set({ error: errorMsg, isLoading: false });
            toast.error(errorMsg);
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
        } catch (err: any) {
            console.error("Error deleting dataset:", err);
            const errorMsg = err.body?.detail || "Failed to delete dataset";
            set({ error: errorMsg, isLoading: false });
            toast.error(errorMsg);
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
                includeResults: options.includeResults
            });

            // Handle file download from response
            const blob = new Blob([response], { type: 'application/zip' });
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `dataset_${datasetId}_export.zip`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);

            set({ isLoading: false });
            toast.success("Dataset exported successfully");
        } catch (err: any) {
            console.error("Error exporting dataset:", err);
            const errorMsg = err.body?.detail || "Failed to export dataset";
            set({ error: errorMsg, isLoading: false });
            toast.error(errorMsg);
        }
    },

    exportMultipleDatasets: async (datasetIds: number[], options: ExportOptions): Promise<void> => {
        // Implementation will depend on whether backend supports bulk export
        // For now, export one by one
        set({ isLoading: true, error: null });
        try {
            for (const id of datasetIds) {
                await get().exportDataset(id, options);
            }
            toast.success(`Exported ${datasetIds.length} datasets successfully`);
        } catch (err: any) {
            console.error("Error during bulk export:", err);
            const errorMsg = err.body?.detail || "Failed to export some datasets";
            set({ error: errorMsg, isLoading: false });
            toast.error(errorMsg);
        } finally {
            set({ isLoading: false });
        }
    },

    importDataset: async (file: File): Promise<DatasetRead | null> => {
        const { activeWorkspace } = useWorkspaceStore.getState();
        if (!activeWorkspace?.id) {
            toast.error("No active workspace selected");
            return null;
        }

        set({ isLoading: true, error: null });
        try {
            // Create the correct request body format
            const formData: { file: File } = { file };

            const imported = await DatasetsService.importDataset({
                workspaceId: activeWorkspace.id,
                formData,
                conflictStrategy: 'skip'
            });

            set(state => ({
                datasets: [imported, ...state.datasets],
                isLoading: false
            }));

            toast.success("Dataset imported successfully");
            return imported;
        } catch (err: any) {
            console.error("Error importing dataset:", err);
            const errorMsg = err.body?.detail || "Failed to import dataset";
            set({ error: errorMsg, isLoading: false });
            toast.error(errorMsg);
            return null;
        }
    },

    importFromToken: async (token: string, options: ImportOptions): Promise<DatasetRead | null> => {
        const { activeWorkspace } = useWorkspaceStore.getState();
        if (!activeWorkspace?.id) {
            toast.error("No active workspace selected");
            return null;
        }

        set({ isLoading: true, error: null });
        try {
            const imported = await DatasetsService.importDatasetFromToken({
                workspaceId: activeWorkspace.id,
                shareToken: token,
                includeContent: options.includeContent,
                includeResults: options.includeResults,
                conflictStrategy: options.conflictStrategy
            });

            set(state => ({
                datasets: [imported, ...state.datasets],
                isLoading: false
            }));

            toast.success("Dataset imported successfully from token");
            return imported;
        } catch (err: any) {
            console.error("Error importing dataset from token:", err);
            const errorMsg = err.body?.detail || "Failed to import dataset from token";
            set({ error: errorMsg, isLoading: false });
            toast.error(errorMsg);
            return null;
        }
    }
})); 