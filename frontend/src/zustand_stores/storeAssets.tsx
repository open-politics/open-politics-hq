import { create } from 'zustand';
import { AssetsService, FilestorageService, BundlesService } from '@/client';
import { 
  AssetRead,
  AssetKind,
  AssetsOut,
  AssetCreate,
  AssetUpdate,
  ResourceType,
  BundleRead,
} from '@/client';
import { toast } from 'sonner';
import { useInfospaceStore } from './storeInfospace';
import { useShareableStore } from './storeShareables';

// TODO: Update imports when client is regenerated

// Store polling intervals to manage them
const pollingIntervals: Record<number, NodeJS.Timeout> = {};
const POLLING_INTERVAL_MS = 10000; // Poll every 10 seconds

// Helper function to detect asset kind from file
const getKindFromFile = (file: File): AssetKind => {
  const mimeType = file.type.toLowerCase();
  const extension = file.name.split('.').pop()?.toLowerCase();
  
  if (mimeType.includes('pdf') || extension === 'pdf') return 'pdf';
  if (mimeType.includes('csv') || extension === 'csv') return 'csv';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (extension === 'mbox') return 'mbox';
  
  return 'text'; // Default fallback
};

interface AssetState {
  assets: AssetRead[];
  isLoading: boolean;
  error: string | null;
  fetchAssets: () => Promise<void>;
  createAsset: (formData: FormData) => Promise<{ bundle: BundleRead; assets: AssetRead[] } | null>;
  deleteAsset: (assetId: number) => Promise<void>;
  updateAsset: (assetId: number, updateData: AssetUpdate) => Promise<AssetRead | null>;
  getAssetById: (assetId: number) => Promise<AssetRead | null>;
  fetchChildAssets: (parentId: number) => Promise<AssetRead[] | null>;
  reprocessAsset: (assetId: number, options?: { delimiter?: string; skip_rows?: number; encoding?: string }) => Promise<boolean>;

  // Import/Export actions
  exportAsset: (assetId: number) => Promise<void>;
  exportMultipleAssets: (assetIds: number[]) => Promise<void>;
  importAsset: (infospaceId: number, file: File) => Promise<AssetRead | null>;
}

export const useAssetStore = create<AssetState>((set, get) => ({
  assets: [],
  isLoading: false,
  error: null,

  fetchAssets: async () => {
    const { activeInfospace } = useInfospaceStore.getState();
    if (!activeInfospace?.id) {
      console.log('[AssetStore] No active infospace, skipping asset fetch');
      return;
    }

    console.log('[AssetStore] Fetching assets for infospace:', activeInfospace.id);
    set({ isLoading: true, error: null });
    try {
      const response: AssetsOut = await AssetsService.listAssets({
        infospaceId: activeInfospace.id,
        limit: 1000,
      });

      console.log('[AssetStore] Assets fetched successfully:', {
        count: response.data.length,
        assetIds: response.data.map(a => a.id),
        infospaceId: activeInfospace.id
      });

      set({ assets: response.data, isLoading: false });
    } catch (err: any) {
      console.error("[AssetStore] Error fetching assets:", err);
      const errorMsg = err.body?.detail || err.message || "Failed to fetch assets";
      set({ error: errorMsg, isLoading: false, assets: [] });
      toast.error(errorMsg);
    }
  },

  createAsset: async (formData: FormData): Promise<{ bundle: BundleRead; assets: AssetRead[] } | null> => {
    const { activeInfospace } = useInfospaceStore.getState();
    if (!activeInfospace?.id) {
      toast.error("No active infospace selected");
      return null;
    }

    set({ isLoading: true, error: null });
    try {
      const kind = formData.get('kind') as string;
      const title = formData.get('title') as string;
      const files = formData.getAll('files') as File[];

      const createdAssets: AssetRead[] = [];

      if (kind === 'pdf' || kind === 'csv' || kind === 'mbox' || kind === 'image' || kind === 'audio' || kind === 'video') {
        // Handle file uploads - upload each file individually with correct type detection
        for (const file of files) {
          const uploadResponse = await FilestorageService.fileUpload({ 
            formData: { file: file }
          });
          
          // Detect the actual file type for each file
          const actualKind = getKindFromFile(file);
          
          const assetCreate: AssetCreate = {
            title: files.length === 1 ? title : file.name.replace(/\.[^/.]+$/, ""), // Use actual filename without extension
            kind: actualKind, // Use detected file type, not the dominant kind
            blob_path: uploadResponse.object_name,
            source_metadata: { filename: uploadResponse.filename },
          };
          const newAsset = await AssetsService.createAsset({ infospaceId: activeInfospace.id, requestBody: assetCreate });
          createdAssets.push(newAsset);
        }
      } else if (kind === 'web') {
        // Handle URL scraping
        const sourceIdentifier = formData.get('source_identifier') as string;
        const assetCreate: AssetCreate = {
          title: title,
          kind: kind as AssetKind,
          source_identifier: sourceIdentifier,
        };
        const newAsset = await AssetsService.createAsset({ infospaceId: activeInfospace.id, requestBody: assetCreate });
        createdAssets.push(newAsset);
      } else {
        // Handle text content
        const assetCreate: AssetCreate = {
          title: title,
          kind: kind as AssetKind,
          text_content: formData.get('text_content') as string | undefined,
          source_identifier: formData.get('source_identifier') as string | undefined,
        };
        const newAsset = await AssetsService.createAsset({ infospaceId: activeInfospace.id, requestBody: assetCreate });
        createdAssets.push(newAsset);
      }
      
      // Step 2: Create bundle for the upload
      const kindCounts = createdAssets.reduce((acc, asset) => {
        acc[asset.kind] = (acc[asset.kind] || 0) + 1;
        return acc;
      }, {} as Record<AssetKind, number>);
      
      const dominantKind = Object.entries(kindCounts).reduce((a, b) => 
        kindCounts[a[0] as AssetKind] > kindCounts[b[0] as AssetKind] ? a : b
      )[0] as AssetKind;
      
      const bundleName = files.length > 1 ? `${title} (${files.length} files)` : title;
      const bundleDescription = files.length > 1 ? 
        `Mixed upload collection containing ${files.length} files` : 
        `${dominantKind.toUpperCase()} upload`;
      
      const bundleCreate = {
        name: bundleName,
        description: bundleDescription,
        purpose: `upload_mixed`,
      };

      const newBundle = await BundlesService.createBundle({
        infospaceId: activeInfospace.id,
        requestBody: bundleCreate
      });

      // Step 3: Add all created assets to the bundle
      for (const asset of createdAssets) {
        await BundlesService.addAssetToBundle({
          bundleId: newBundle.id,
          assetId: asset.id
        });
      }

      // Update local state
      set(state => ({
        assets: [...createdAssets, ...state.assets],
        isLoading: false,
      }));

      // Refresh bundles to ensure UI shows the new bundle
      try {
        const { useBundleStore } = await import('./storeBundles');
        await useBundleStore.getState().fetchBundles(activeInfospace.id);
      } catch (error) {
        console.warn('Failed to refresh bundles after asset creation:', error);
      }

      const successMessage = createdAssets.length === 1 
        ? `Bundle "${newBundle.name}" created with asset "${createdAssets[0].title}".`
        : `Bundle "${newBundle.name}" created with ${createdAssets.length} assets.`;
      toast.success(successMessage);
      
      return { bundle: newBundle, assets: createdAssets };

    } catch (err: any) {
      console.error("Error creating asset:", err);
      const errorMsg = err.body?.detail || err.message || "Failed to create asset";
      set({ error: errorMsg, isLoading: false });
      toast.error(errorMsg);
      return null;
    }
  },

  deleteAsset: async (assetId: number): Promise<void> => {
    const { activeInfospace } = useInfospaceStore.getState();
    if (!activeInfospace?.id) {
      toast.error("No active infospace selected");
      return;
    }
    
    set({ isLoading: true, error: null });
    try {
      await AssetsService.deleteAsset({
        infospaceId: activeInfospace.id,
        assetId: assetId,
      });
      
      set(state => ({
        assets: state.assets.filter(asset => asset.id !== assetId),
        isLoading: false,
      }));

      toast.success("Asset deleted successfully.");
    } catch (err: any) {
      console.error(`Error deleting asset ${assetId}:`, err);
      const errorMsg = err.body?.detail || err.message || `Failed to delete asset ${assetId}`;
      set({ error: errorMsg, isLoading: false });
      toast.error(errorMsg);
    }
  },

  updateAsset: async (assetId: number, updateData: AssetUpdate): Promise<AssetRead | null> => {
    const { activeInfospace } = useInfospaceStore.getState();
    if (!activeInfospace?.id) {
      toast.error("No active infospace selected");
      return null;
    }
    
    set({ isLoading: true, error: null });
    try {
      const updatedAsset = await AssetsService.updateAsset({
        infospaceId: activeInfospace.id,
        assetId: assetId,
        requestBody: updateData
      });

      set(state => {
        const index = state.assets.findIndex(asset => asset.id === assetId);
        if (index !== -1) {
          const newAssets = [...state.assets];
          newAssets[index] = updatedAsset;
          return { assets: newAssets, isLoading: false };
        }
        return { isLoading: false };
      });

      toast.success("Asset updated successfully.");
      return updatedAsset;
    } catch (err: any) {
      console.error(`Error updating asset ${assetId}:`, err);
      const errorMsg = err.body?.detail || err.message || "Failed to update asset";
      set({ error: errorMsg, isLoading: false });
      toast.error(errorMsg);
      return null;
    }
  },

  getAssetById: async (assetId: number): Promise<AssetRead | null> => {
    const { activeInfospace } = useInfospaceStore.getState();
    if (!activeInfospace?.id) {
      toast.error("No active infospace selected");
      return null;
    }

    try {
      return await AssetsService.getAsset({
        infospaceId: activeInfospace.id,
        assetId: assetId,
      });
    } catch (err: any) {
      console.error(`Error fetching asset ${assetId}:`, err);
      const errorMsg = err.body?.detail || err.message || `Failed to fetch asset ${assetId}`;
      toast.error(errorMsg);
      return null;
    }
  },

  fetchChildAssets: async (parentId: number): Promise<AssetRead[] | null> => {
    const { activeInfospace } = useInfospaceStore.getState();
    if (!activeInfospace?.id) {
      toast.error("No active infospace selected");
      return null;
    }
    console.log(`[AssetStore] Fetching child assets for parent ${parentId} in infospace ${activeInfospace.id}`);
    try {
      // Fetch all children, so we use a high limit.
      const response = await AssetsService.listAssets({
        infospaceId: activeInfospace.id,
        parentAssetId: parentId,
        limit: 2000, 
      });
      console.log(`[AssetStore] API response for parent ${parentId}:`, response);
      console.log(`[AssetStore] Number of child assets returned: ${response.data?.length || 0}`);
      
      if (response.data && response.data.length > 0) {
        console.log(`[AssetStore] Child assets details:`, response.data.map(asset => ({
          id: asset.id,
          title: asset.title,
          kind: asset.kind,
          parent_asset_id: asset.parent_asset_id
        })));
      }
      
      return response.data || [];
    } catch (err: any) {
      console.error(`Error fetching child assets for parent ${parentId}:`, err);
      set({ error: err.message || "Failed to fetch child assets" });
      toast.error(`Failed to fetch child assets: ${err.message || "Unknown error"}`);
      return null;
    }
  },

  reprocessAsset: async (assetId: number, options?: { delimiter?: string; skip_rows?: number; encoding?: string }): Promise<boolean> => {
    const { activeInfospace } = useInfospaceStore.getState();
    if (!activeInfospace?.id) {
      toast.error("No active infospace selected");
      return false;
    }

    // First try: reprocess with /reprocess endpoint
    // For CSV assets first try: we use /materialize-csv endpoint
    // Via the sdk

    const asset = await AssetsService.getAsset({
      infospaceId: activeInfospace.id,
      assetId: assetId,
    });

    if (asset.kind.toLowerCase() === 'csv') {
      const response = await AssetsService.materializeCsvFromRows({
        infospaceId: activeInfospace.id,
        assetId: assetId,
      });
      return true;
    }

    set({ isLoading: true, error: null });
    try {
      // Build query parameters
      const queryParams = new URLSearchParams();
      if (options?.delimiter) queryParams.append('delimiter', options.delimiter);
      if (options?.skip_rows !== undefined) queryParams.append('skip_rows', options.skip_rows.toString());
      if (options?.encoding) queryParams.append('encoding', options.encoding);
      
      const queryString = queryParams.toString();
      const url = `/api/v1/assets/infospaces/${activeInfospace.id}/assets/${assetId}/reprocess${queryString ? '?' + queryString : ''}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();

      set(state => ({
        assets: state.assets.map(asset =>
          asset.id === assetId ? { ...asset, reprocessed: true } : asset
        ),
        isLoading: false
      }));
      
      toast.success(result.message || "Asset reprocessing initiated.");
      return true;

    } catch (err: any) {
      console.error("Error reprocessing asset:", err);
      const errorMsg = err.message || "Failed to reprocess asset";
      set({ error: errorMsg, isLoading: false });
      toast.error(errorMsg);
      return false;
    }
  },

  // Import/Export functionality
  exportAsset: async (assetId: number) => {
    const { activeInfospace } = useInfospaceStore.getState();
    if (!activeInfospace?.id) {
      toast.error("No active infospace selected for export");
      return;
    }

    set({ isLoading: true, error: null });
    try {
      await useShareableStore.getState().exportResource('asset' as ResourceType, assetId, activeInfospace.id);
      set({ isLoading: false });
      toast.success("Asset export initiated.");
    } catch (err) {
      console.error("Export asset error:", err);
      const message = err instanceof Error ? err.message : 'Failed to export asset';
      set({ error: message, isLoading: false });
      toast.error(message);
    }
  },

  exportMultipleAssets: async (assetIds: number[]) => {
    const { activeInfospace } = useInfospaceStore.getState();
    if (!activeInfospace?.id) {
      toast.error("No active infospace selected for batch export");
      return;
    }

    if (!assetIds.length) {
      toast.info("No assets selected for export");
      return;
    }

    set({ isLoading: true, error: null });
    try {
      await useShareableStore.getState().exportResourcesBatch('asset' as ResourceType, assetIds, activeInfospace.id);
      set({ isLoading: false });
      toast.success("Batch asset export initiated.");
    } catch (err) {
      console.error("Batch export assets error:", err);
      const message = err instanceof Error ? err.message : 'Failed to batch export assets';
      set({ error: message, isLoading: false });
      toast.error(message);
    }
  },

  importAsset: async (infospaceId: number, file: File): Promise<AssetRead | null> => {
    set({ isLoading: true, error: null });
    try {
      const result = await useShareableStore.getState().importResource(file, infospaceId);
      
      if (!result) {
        throw new Error("Import operation returned no result");
      }

      // Handle successful import
      if ('imported_resource_id' in result && result.resource_type === 'asset') {
        const importedAsset = await AssetsService.getAsset({
          infospaceId: infospaceId,
          assetId: result.imported_resource_id
        });

        if (importedAsset) {
          set(state => ({
            assets: [importedAsset, ...state.assets],
            isLoading: false
          }));
          toast.success(`Asset "${importedAsset.title}" imported successfully.`);
          return importedAsset;
        }
      }

      set({ isLoading: false });
      return null;
    } catch (err) {
      console.error("Import asset error:", err);
      const message = err instanceof Error ? err.message : 'Failed to import asset';
      set({ error: message, isLoading: false });
      toast.error(message);
      return null;
    }
  },
})); 