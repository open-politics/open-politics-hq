import { create } from 'zustand';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
// import { useDocumentStore } from '@/zustand_stores/storeDocuments'; // Replaced with DataSource store
import { useAssetStore } from '@/zustand_stores/storeAssets'; // Import Asset store
import { CoreContentModel } from '@/lib/content';
import { AssetKind } from '@/client/models';
import { toast } from '@/components/ui/use-toast';


// --- Redefine State for DataSource-based Bookmarking --- //
// We no longer store bookmarks locally. The existence of a corresponding Asset/DataSource
// indicates a bookmark. We track pending operations.

type BookmarkState = {
  // bookmarks: CoreContentModel[]; // Removed local bookmark list
  pendingOperations: { [identifier: string]: 'add' | 'remove' }; // Track pending ops by URL or another unique ID
  // Redefine addBookmark to create a DataSource
  addBookmark: (item: CoreContentModel, InfospaceId: number) => Promise<void>;
  // Redefine removeBookmark to delete a DataSource
  removeBookmark: (identifier: string, InfospaceId: number) => Promise<void>; // Needs identifier (e.g., URL) and InfospaceId
  // getBookmarks: () => CoreContentModel[]; // Removed - bookmarks are now DataSources
  isOperationPending: (identifier: string) => 'add' | 'remove' | false;
};

// Helper to find Asset by URL (or other identifier)
const findAssetByIdentifier = (identifier: string, assets: any[]): number | null => {
  const found = assets.find(asset => {
    // Check for URL match in source_identifier or source_metadata
    if (asset.source_identifier === identifier) {
      return true;
    }
    if (asset.source_metadata?.url === identifier) {
      return true;
    }
    // Add more robust checks if necessary
    return false;
  });
  return found ? found.id : null;
};

export const useBookMarkStore = create<BookmarkState>((set, get) => ({
  // bookmarks: [], // Removed
  pendingOperations: {},

  addBookmark: async (item, InfospaceId) => {
    const identifier = item.url; // Use URL as the primary identifier
    if (!identifier) {
      console.error('Cannot add bookmark: Missing URL identifier.');
      toast({ title: "Error", description: "Cannot bookmark item without a URL.", variant: "destructive" });
      return;
    }

    set((state) => ({ pendingOperations: { ...state.pendingOperations, [identifier]: 'add' } }));

    try {
      const { createAsset } = useAssetStore.getState();

      // We are creating an asset of kind 'web' when bookmarking a URL
      const formData = new FormData();
      formData.append('title', item.title || `Bookmarked: ${identifier}`);
      formData.append('kind', 'web');
      formData.append('source_identifier', identifier);

      const result = await createAsset(formData);

      if (result?.assets && result.assets.length > 0) {
        console.log('Bookmark added as Asset:', result.assets[0]);
        toast({ title: "Item Imported", description: `"${item.title || identifier}" imported successfully.`, variant: "default" });
      } else {
        throw new Error('Failed to create Asset for bookmark.');
      }

    } catch (error) {
      console.error('Error adding bookmark as Asset:', error);
      toast({ title: "Import Failed", description: error instanceof Error ? error.message : "Could not import item.", variant: "destructive" });
    } finally {
      set((state) => {
        const newPending = { ...state.pendingOperations };
        delete newPending[identifier];
        return { pendingOperations: newPending };
      });
    }
  },

  removeBookmark: async (identifier, InfospaceId) => {
    if (!identifier) {
      console.error('Cannot remove bookmark: Missing identifier.');
      return;
    }

    set((state) => ({ pendingOperations: { ...state.pendingOperations, [identifier]: 'remove' } }));

    try {
      const { assets, deleteAsset, fetchAssets } = useAssetStore.getState();
      const { activeInfospace } = useInfospaceStore.getState();

      if (!activeInfospace || activeInfospace.id !== InfospaceId) {
        throw new Error('Infospace context mismatch or missing active Infospace.');
      }
      
      // Ensure assets are loaded before trying to find one
      if (assets.length === 0) {
        await fetchAssets();
      }

      const assetIdToDelete = findAssetByIdentifier(identifier, useAssetStore.getState().assets);

      if (!assetIdToDelete) {
        console.warn(`Asset for identifier "${identifier}" not found in local state.`);
        toast({ title: "Not Found", description: "Could not find the imported item to remove.", variant: "default" });
      } else {
        await deleteAsset(assetIdToDelete);
        console.log(`Asset ${assetIdToDelete} deleted for bookmark identifier ${identifier}`);
        toast({ title: "Item Removed", description: `Item removed successfully.`, variant: "default" });
      }

    } catch (error) {
      console.error(`Error removing bookmark (Asset) for identifier ${identifier}:`, error);
       toast({ title: "Removal Failed", description: error instanceof Error ? error.message : "Could not remove item.", variant: "destructive" });
    } finally {
      set((state) => {
        const newPending = { ...state.pendingOperations };
        delete newPending[identifier];
        return { pendingOperations: newPending };
      });
    }
  },

  // getBookmarks: () => get().bookmarks, // Removed

  isOperationPending: (identifier) => {
    return get().pendingOperations[identifier] || false;
  },
}));