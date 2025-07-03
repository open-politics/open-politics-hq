import { create } from 'zustand';
import {
  BundlesService,
  BundleRead,
  BundleCreate,
  BundleUpdate,
  AssetRead,
} from '@/client';
import { toast } from 'sonner';
import { useInfospaceStore } from './storeInfospace';
import { OpenAPI } from '@/client';

interface BundleState {
  bundles: BundleRead[];
  isLoading: boolean;
  error: string | null;
  fetchBundles: (infospaceId: number) => Promise<void>;
  createBundle: (bundleData: BundleCreate) => Promise<BundleRead | null>;
  updateBundle: (bundleId: number, bundleData: BundleUpdate) => Promise<BundleRead | null>;
  deleteBundle: (bundleId: number) => Promise<boolean>;
  addAssetToBundle: (bundleId: number, assetId: number) => Promise<boolean>;
  removeAssetFromBundle: (bundleId: number, assetId: number) => Promise<boolean>;
  getBundleAssets: (bundleId: number) => Promise<AssetRead[]>;
}

export const useBundleStore = create<BundleState>((set, get) => ({
  bundles: [],
  isLoading: false,
  error: null,

  fetchBundles: async (infospaceId: number) => {
    set({ isLoading: true, error: null });
    try {
      const bundles = await BundlesService.getBundles({ infospaceId });
      set({ bundles, isLoading: false });
    } catch (err: any) {
      const message = err.body?.detail || err.message || 'Failed to fetch bundles';
      toast.error(message);
      set({ error: message, isLoading: false, bundles: [] });
    }
  },

  createBundle: async (bundleData: BundleCreate) => {
    const { activeInfospace } = useInfospaceStore.getState();
    if (!activeInfospace?.id) {
        toast.error("No active infospace to create a bundle in.");
        return null;
    }
    set({ isLoading: true, error: null });
    try {
      const newBundle = await BundlesService.createBundle({ infospaceId: activeInfospace.id, requestBody: bundleData });
      set(state => ({
        bundles: [...state.bundles, newBundle],
        isLoading: false,
      }));
      toast.success(`Bundle "${newBundle.name}" created.`);
      return newBundle;
    } catch (err: any) {
      const message = err.body?.detail || err.message || 'Failed to create bundle';
      toast.error(message);
      set({ error: message, isLoading: false });
      return null;
    }
  },

  updateBundle: async (bundleId: number, bundleData: BundleUpdate) => {
    set({ isLoading: true, error: null });
    try {
      const updatedBundle = await BundlesService.updateBundle({ bundleId, requestBody: bundleData });
      set(state => ({
        bundles: state.bundles.map(b => b.id === bundleId ? updatedBundle : b),
        isLoading: false
      }));
      toast.success(`Bundle "${updatedBundle.name}" updated.`);
      return updatedBundle;
    } catch (err: any) {
      const message = err.body?.detail || err.message || 'Failed to update bundle';
      toast.error(message);
      set({ error: message, isLoading: false });
      return null;
    }
  },

  deleteBundle: async (bundleId: number) => {
    set({ isLoading: true, error: null });
    try {
      await BundlesService.deleteBundle({ bundleId });
      set(state => ({
        bundles: state.bundles.filter(b => b.id !== bundleId),
        isLoading: false
      }));
      toast.success("Bundle deleted.");
      return true;
    } catch (err: any) {
      const message = err.body?.detail || err.message || 'Failed to delete bundle';
      toast.error(message);
      set({ error: message, isLoading: false });
      return false;
    }
  },

  addAssetToBundle: async (bundleId: number, assetId: number) => {
    const { activeInfospace } = useInfospaceStore.getState();
    if (!activeInfospace?.id) {
        toast.error("No active infospace.");
        return false;
    }
    set({ isLoading: true, error: null });
    try {
      const updatedBundle = await BundlesService.addAssetToBundle({ bundleId, assetId });
      // Refresh both bundles and assets to ensure all UI components are updated
      await Promise.allSettled([
        get().fetchBundles(activeInfospace.id),
        // Import and call asset store refresh to ensure asset lists are updated
        import('./storeAssets').then(({ useAssetStore }) => 
          useAssetStore.getState().fetchAssets()
        )
      ]);
      toast.success(`Asset added to bundle "${updatedBundle.name}".`);
      return true;
    } catch (err: any) {
      const message = err.body?.detail || err.message || 'Failed to add asset to bundle';
      toast.error(message);
      set({ error: message, isLoading: false });
      return false;
    }
  },

  removeAssetFromBundle: async(bundleId: number, assetId: number) => {
      const { activeInfospace } = useInfospaceStore.getState();
      if (!activeInfospace?.id) {
          toast.error("No active infospace.");
          return false;
      }
      set({ isLoading: true, error: null });
      try {
        const updatedBundle = await BundlesService.removeAssetFromBundle({ bundleId, assetId });
        // Refresh both bundles and assets to ensure all UI components are updated
        await Promise.allSettled([
          get().fetchBundles(activeInfospace.id),
          // Import and call asset store refresh to ensure asset lists are updated
          import('./storeAssets').then(({ useAssetStore }) => 
            useAssetStore.getState().fetchAssets()
          )
        ]);
        toast.success(`Asset removed from bundle "${updatedBundle.name}".`);
        return true;
      } catch (err: any) {
        const message = err.body?.detail || err.message || 'Failed to remove asset from bundle';
        toast.error(message);
        set({ error: message, isLoading: false });
        return false;
      }
  },

  getBundleAssets: async (bundleId: number): Promise<AssetRead[]> => {
    const { activeInfospace } = useInfospaceStore.getState();
    if (!activeInfospace) {
      const error = 'No active infospace selected.';
      set({ error, isLoading: false });
      toast.error(error);
      throw new Error(error);
    }

    const token = localStorage.getItem("access_token");
    if (!token) {
      const error = "Authentication token not found.";
      set({ error, isLoading: false });
      toast.error(error);
      throw new Error(error);
    }
    
    set({ isLoading: true, error: null });
    try {
      const response = await fetch(`${OpenAPI.BASE}/api/v1/bundles/infospaces/${activeInfospace.id}/bundles/${bundleId}/assets?skip=0&limit=100`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        let errorDetail = `Failed to get bundle assets with status: ${response.status}`;
        try {
          const errorBody = await response.json();
          errorDetail = errorBody.detail || errorDetail;
        } catch (e) {
          errorDetail = `${errorDetail} - ${response.statusText}`;
        }
        throw new Error(errorDetail);
      }

      const assets = await response.json();
      set({ isLoading: false });
      return assets as AssetRead[];

    } catch (err: any) {
      const message = err.message || 'Failed to get bundle assets';
      set({ error: message, isLoading: false });
      toast.error(message);
      throw new Error(message);
    }
  }
})); 