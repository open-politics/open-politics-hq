import { create } from 'zustand';
import {
  ShareablesService,
  ShareableLinkCreate,
  ShareableLinkRead,
  ShareableLinkUpdate,
  ShareableLinkStats,
  ResourceType,
  DatasetPackageSummary,
  Body_shareables_export_resource,
  ExportBatchRequest,
  // Assuming the backend response for a single successful import might look like this:
  // We might need to define this more accurately based on actual backend output for single non-batch imports
  // For now, let's assume it has at least 'id' and 'resource_type'
  // Update: The backend returns a more complex object, let's use a generic 'Record<string, any>' for now
  // and let the consumer (storeDataSources) pick what it needs.
  AssetKind,
} from '../client'; // Assuming client is index.ts in src/client
import { OpenAPI } from '../client'; // Added import for OpenAPI.BASE
import { saveAs } from 'file-saver';
import { toast } from 'sonner';
import { ApiError } from '@/client/core/ApiError';

// --- New Frontend-specific types for the Public View ---
export interface AssetPreview {
  id: number;
  title: string;
  kind: AssetKind;
  created_at: string;
  updated_at: string;
  text_content?: string | null;
  blob_path?: string | null;
  source_metadata?: { [key: string]: any } | null;
  children?: AssetPreview[];
  is_container: boolean;
}

export interface BundlePreview {
  id: number;
  name: string;
  description?: string;
  created_at: string;
  updated_at: string;
  assets: AssetPreview[];
}

export interface SharedResourcePreview {
  resource_type: ResourceType;
  name: string;
  description?: string;
  content: AssetPreview | BundlePreview;
}
// ---------------------------------------------------------

// Utility for file download
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

// New types for import results
export interface SingleImportSuccess {
  message: string;
  resource_type: ResourceType; // Ensure this matches the backend key
  imported_resource_id: number;
  imported_resource_name: string;
  target_infospace_id: number;
  // Allow other properties as the backend might return more.
  [key: string]: any;
}

export interface BatchImportSuccessItem { // Renamed from BatchImportResultItem for clarity
  filename: string;
  resource_type: ResourceType; // Ensure this matches the backend key
  imported_resource_id: number;
  imported_resource_name: string;
  status: 'success'; // This item represents a success
}

export interface BatchImportFailedItem {
  filename: string;
  status: 'failed';
  error: string;
}

export interface BatchReport { // Represents the content of the 'batch_summary' key
  total_files_processed: number;
  successful_imports: BatchImportSuccessItem[];
  failed_imports: BatchImportFailedItem[];
}

export interface BatchImportSummary { // This is the top-level response for a batch import
  message: string;
  batch_summary: BatchReport; // Nested structure matching backend
  target_infospace_id: number;
}

interface ShareableState {
  links: ShareableLinkRead[];
  linkStats: ShareableLinkStats | null;
  isLoading: boolean;
  error: string | null;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;

  createLink: (linkData: ShareableLinkCreate, infospaceId: number) => Promise<ShareableLinkRead | null>;
  fetchLinks: (infospaceId: number, resourceType?: ResourceType, resourceId?: number) => Promise<void>;
  fetchLinkById: (linkId: number) => Promise<ShareableLinkRead | null>;
  fetchLinkByToken: (token: string) => Promise<ShareableLinkRead | null>;
  updateLink: (linkId: number, updateData: ShareableLinkUpdate) => Promise<ShareableLinkRead | null>;
  deleteLink: (linkId: number) => Promise<boolean>;
  fetchLinkStats: (infospaceId: number) => Promise<void>;

  accessSharedResource: (token: string) => Promise<unknown | null>;
  viewDatasetPackageSummary: (token: string) => Promise<DatasetPackageSummary | null>;

  exportResource: (resourceType: ResourceType, resourceId: number, infospaceId: number) => Promise<void>;
  exportResourcesBatch: (resourceType: ResourceType, resourceIds: number[], infospaceId: number) => Promise<void>;
  exportMixedBatch: (infospaceId: number, assetIds: number[], bundleIds: number[]) => Promise<void>;
  importResource: (file: File, infospaceId?: number) => Promise<SingleImportSuccess | BatchImportSummary | null>;
  importResourceFromToken: (token: string, infospaceId: number) => Promise<SingleImportSuccess | null>;
  viewSharedResource: (token: string) => Promise<SharedResourcePreview | null>;
}

export const useShareableStore = create<ShareableState>((set, get) => ({
  links: [],
  linkStats: null,
  isLoading: false,
  error: null,
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),

  createLink: async (linkData, infospaceId) => {
    set({ isLoading: true, error: null });
    try {
      const newLink = await ShareablesService.createShareableLink({ infospaceId: infospaceId, requestBody: linkData });
      set((state) => ({ links: [...state.links, newLink], isLoading: false }));
      return newLink;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create link';
      set({ error: message, isLoading: false });
      return null;
    }
  },

  fetchLinks: async (infospaceId, resourceType, resourceId) => {
    set({ isLoading: true, error: null });
    try {
      const paginatedLinks = await ShareablesService.getShareableLinks({ infospaceId, resourceType, resourceId });
      set({ links: paginatedLinks.data as ShareableLinkRead[], isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch links';
      set({ error: message, isLoading: false });
    }
  },

  fetchLinkById: async (linkId) => {
    set({ isLoading: true, error: null });
    try {
      console.warn("fetchLinkById is deprecated. Use fetchLinkByToken if needed. No route exists for fetching by ID.");
      set({ isLoading: false });
      return null;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch link by ID';
      set({ error: message, isLoading: false });
      return null;
    }
  },

  fetchLinkByToken: async (token) => {
    set({ isLoading: true, error: null });
    try {
      const link = await ShareablesService.getShareableLinkByToken({ token });
      set({ isLoading: false });
      return link;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch link by token';
      set({ error: message, isLoading: false });
      return null;
    }
  },

  updateLink: async (linkId, updateData) => {
    set({ isLoading: true, error: null });
    try {
      const updatedLink = await ShareablesService.updateShareableLink({ linkId, requestBody: updateData });
      set((state) => ({
        links: state.links.map((l) => (l.id === linkId ? updatedLink : l)),
        isLoading: false,
      }));
      return updatedLink;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update link';
      set({ error: message, isLoading: false });
      return null;
    }
  },

  deleteLink: async (linkId) => {
    set({ isLoading: true, error: null });
    try {
      await ShareablesService.deleteShareableLink({ linkId });
      set((state) => ({
        links: state.links.filter((l) => l.id !== linkId),
        isLoading: false,
      }));
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete link';
      set({ error: message, isLoading: false });
      return false;
    }
  },

  fetchLinkStats: async (infospaceId: number) => {
    set({ isLoading: true, error: null });
    try {
      const stats = await ShareablesService.getSharingStats({infospaceId});
      set({ linkStats: stats, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch link stats';
      set({ error: message, isLoading: false });
    }
  },

  accessSharedResource: async (token) => {
    set({ isLoading: true, error: null });
    try {
      const resource = await ShareablesService.accessSharedResource({ token });
      set({ isLoading: false });
      return resource;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to access shared resource';
      set({ error: message, isLoading: false });
      return null;
    }
  },

  viewDatasetPackageSummary: async (token) => {
    set({ isLoading: true, error: null });
    try {
      const summary = await ShareablesService.viewDatasetPackageSummary({ token });
      set({ isLoading: false });
      return summary;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to view dataset package summary';
      set({ error: message, isLoading: false });
      return null;
    }
  },

  exportResource: async (resourceType, resourceId, infospaceId) => {
    set({ isLoading: true, error: null });
    const token = localStorage.getItem("access_token");
    if (!token) {
      const error = "Authentication token not found.";
      set({ error, isLoading: false });
      toast.error(error);
      throw new Error(error);
    }

    try {
      const formData = new FormData();
      formData.append('resource_type', resourceType);
      formData.append('resource_id', String(resourceId));

      const response = await fetch(`${OpenAPI.BASE}/api/v1/shareables/${infospaceId}/export`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      });

      if (!response.ok) {
        let errorDetail = `Export failed with status: ${response.status}`;
        try {
          const errorBody = await response.json();
          errorDetail = errorBody.detail || errorDetail;
        } catch (e) {
          errorDetail = `${errorDetail} - ${response.statusText}`;
        }
        throw new Error(errorDetail);
      }
      
      const blob = await response.blob();
      let filename = `${resourceType}_${resourceId}_export`;
      if (blob.type === 'application/json') {
          filename += '.json';
      } else if (blob.type === 'application/zip') {
          filename += '.zip';
      } else {
         // Fallback for generic binary data
         filename += '.zip';
      }
      
      triggerDownload(blob, filename);
      set({ isLoading: false });

    } catch (err) {
      console.error("Export resource error:", err);
      const message = err instanceof Error ? err.message : `Failed to export ${resourceType}`;
      set({ error: message, isLoading: false });
      toast.error(message);
      throw err;
    }
  },

  exportResourcesBatch: async (resourceType, resourceIds, infospaceId) => {
    set({ isLoading: true, error: null });
    try {
      const requestBody: ExportBatchRequest = { resource_type: resourceType, resource_ids: resourceIds };
      const token = localStorage.getItem("access_token");

      if (!token) {
        set({ error: "Authentication token not found.", isLoading: false });
        // Consider calling toast here if you have a toast notification system
        console.error("Export resources batch error: Authentication token not found.");
        return;
      }

      const response = await fetch(`${OpenAPI.BASE}/api/v1/shareables/export-batch/${infospaceId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(requestBody),
      });

      if (response.ok) {
        const blob = await response.blob();
        if (blob.type === 'application/zip' || blob.type === 'application/octet-stream') { // octet-stream can sometimes be returned for zip
          triggerDownload(blob, `batch_export_${resourceType}.zip`);
        } else {
          // If the server returned OK but not a zip, it's an unexpected situation.
          const responseText = await blob.text(); // Try to get text for debugging
          console.error('Batch export failed: Expected a ZIP file, but received type:', blob.type, 'Content:', responseText);
          set({ error: 'Batch export failed: Unexpected response file type.', isLoading: false });
          // Consider a toast notification here
          return;
        }
      } else {
        let errorDetail = `Batch export failed with status: ${response.status}`;
        try {
          const errorBody = await response.json(); // Try to parse error body as JSON
          errorDetail = errorBody.detail || errorDetail;
        } catch (e) {
          // If error body is not JSON or other error, use the status text
          errorDetail = `${errorDetail} - ${response.statusText}`;
        }
        console.error("Export resources batch error:", errorDetail);
        set({ error: errorDetail, isLoading: false });
        // Consider a toast notification here with errorDetail
        return;
      }

      set({ isLoading: false });
    } catch (err) {
      console.error("Export resources batch error (catch block):", err);
      const message = err instanceof Error ? err.message : `Failed to batch export ${resourceType}`;
      set({ error: message, isLoading: false });
      // Consider a toast notification here
    }
  },
  
  exportMixedBatch: async (infospaceId: number, assetIds: number[], bundleIds: number[]) => {
    set({ isLoading: true, error: null });
    const token = localStorage.getItem("access_token");
    if (!token) {
      const error = "Authentication token not found.";
      set({ error, isLoading: false });
      toast.error(error);
      throw new Error(error);
    }
    try {
      const response = await fetch(`${OpenAPI.BASE}/api/v1/shareables/export-mixed-batch/${infospaceId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ asset_ids: assetIds, bundle_ids: bundleIds }),
      });

      if (!response.ok) {
        let errorDetail = `Mixed export failed with status: ${response.status}`;
        try {
          const errorBody = await response.json();
          errorDetail = errorBody.detail || errorDetail;
        } catch (e) {
          errorDetail = `${errorDetail} - ${response.statusText}`;
        }
        throw new Error(errorDetail);
      }

      const blob = await response.blob();
      triggerDownload(blob, `mixed_export_${new Date().toISOString()}.zip`);
      set({ isLoading: false });

    } catch (err) {
      const message = err instanceof Error ? err.message : `Failed to perform mixed export`;
      set({ error: message, isLoading: false });
      toast.error(message);
      throw err;
    }
  },

  importResource: async (file: File, infospaceId?: number): Promise<SingleImportSuccess | BatchImportSummary | null> => {
    set({ isLoading: true, error: null });
    try {
      if (infospaceId === undefined) {
        throw new Error("Target Infospace ID must be provided for importResource.");
      }

      // The ShareablesService.importResource is expected to return the parsed JSON response directly.
      const importedData = await ShareablesService.importResource({
        targetInfospaceId: infospaceId,
        formData: { file: file },
      }) as SingleImportSuccess | BatchImportSummary; // Type assertion based on expected backend responses
      
      set({ isLoading: false });
      // importedData could be a SingleImportSuccess or BatchImportSummary based on backend logic
      // The backend now distinguishes this based on the uploaded file content (single package vs. zip of zips)
      return importedData;

    } catch (err) {
      console.error("Import resource error (raw):", err); // Log the raw error object
      const apiError = err as ApiError;
      let detailedMessage = "Failed to import resource."; // Default message

      // Attempt to get a more specific message from the error body
      if (apiError.body && typeof apiError.body === 'object' && 'detail' in apiError.body) {
          const detail = (apiError.body as any).detail;
          detailedMessage = typeof detail === 'string' ? detail : JSON.stringify(detail);
      } else if (apiError.message) { // Fallback to the generic error message from ApiError
          detailedMessage = apiError.message;
      }
      
      console.error("Parsed error message for import:", detailedMessage);
      console.error("Full error body from ApiError:", apiError.body); // Log the full body for inspection

      set({ error: detailedMessage, isLoading: false }); // Set the more detailed message to store's error state
      toast.error(`Import error: ${detailedMessage}`); // Toast with the detailed message
      
      return null;
    }
  },

  importResourceFromToken: async (token: string, infospaceId: number): Promise<SingleImportSuccess | null> => {
    set({ isLoading: true, error: null });
    const authToken = localStorage.getItem("access_token");
    if (!authToken) {
      const error = "Authentication token not found.";
      set({ error, isLoading: false });
      toast.error(error);
      throw new Error(error);
    }

    try {
      const body = { target_infospace_id: infospaceId };

      const response = await fetch(`${OpenAPI.BASE}/api/v1/shareables/import-from-token/${token}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        let errorDetail = `Import from token failed with status: ${response.status}`;
        try {
          const errorBody = await response.json();
          errorDetail = errorBody.detail || errorDetail;
        } catch (e) {
          errorDetail = `${errorDetail} - ${response.statusText}`;
        }
        throw new Error(errorDetail);
      }

      const result = await response.json() as SingleImportSuccess;
      set({ isLoading: false });
      return result;

    } catch (err) {
      const message = err instanceof Error ? err.message : `Failed to import from token`;
      set({ error: message, isLoading: false });
      toast.error(message);
      throw err;
    }
  },

  viewSharedResource: async (token) => {
    set({ isLoading: true, error: null });
    try {
      const response = await fetch(`${OpenAPI.BASE}/api/v1/shareables/view/${token}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        let errorDetail = `Failed to fetch view with status: ${response.status}`;
        try {
          const errorBody = await response.json();
          errorDetail = errorBody.detail || errorDetail;
        } catch (e) {
          errorDetail = `${errorDetail} - ${response.statusText}`;
        }
        throw new Error(errorDetail);
      }

      const result = await response.json() as SharedResourcePreview;
      set({ isLoading: false });
      return result;

    } catch (err) {
      const message = err instanceof Error ? err.message : `Failed to fetch shared view`;
      set({ error: message, isLoading: false });
      toast.error(message);
      return null;
    }
  },
})); 