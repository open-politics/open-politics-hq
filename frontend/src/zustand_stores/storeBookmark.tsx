import { create } from 'zustand';
import { useWorkspaceStore } from '@/zustand_stores/storeWorkspace';
// import { useDocumentStore } from '@/zustand_stores/storeDocuments'; // Replaced with DataSource store
import { useDataSourceStore } from '@/zustand_stores/storeDataSources'; // Import DataSource store
import { CoreContentModel } from '@/lib/content';
import { DataSourceType } from '@/client/models'; // Import DataSourceType
import { toast } from '@/components/ui/use-toast';


// --- Redefine State for DataSource-based Bookmarking --- //
// We no longer store bookmarks locally. The existence of a corresponding DataSource
// indicates a bookmark. We track pending operations.

type BookmarkState = {
  // bookmarks: CoreContentModel[]; // Removed local bookmark list
  pendingOperations: { [identifier: string]: 'add' | 'remove' }; // Track pending ops by URL or another unique ID
  // Redefine addBookmark to create a DataSource
  addBookmark: (item: CoreContentModel, workspaceId: number) => Promise<void>;
  // Redefine removeBookmark to delete a DataSource
  removeBookmark: (identifier: string, workspaceId: number) => Promise<void>; // Needs identifier (e.g., URL) and workspaceId
  // getBookmarks: () => CoreContentModel[]; // Removed - bookmarks are now DataSources
  isOperationPending: (identifier: string) => 'add' | 'remove' | false;
};

// Helper to find DataSource by URL (or other identifier) - might need refinement
// This might be inefficient if there are many DataSources.
// Consider adding a backend endpoint to find DataSource by origin URL.
const findDataSourceByIdentifier = (identifier: string, dataSources: any[]): number | null => {
  const found = dataSources.find(ds => {
    // Check origin_details for URL or text content match
    if (ds.type === "url_list" || ds.type === "text_block") {
      // Assuming the identifier is the URL for URL_LIST
      if (ds.type === "url_list" && Array.isArray(ds.origin_details?.urls) && ds.origin_details.urls.includes(identifier)) {
        return true;
      }
      // Assuming the identifier is the text content hash or similar for TEXT_BLOCK
      // This part needs a reliable way to identify the text block source.
      // For now, let's focus on URL based identification.
      // if (ds.type === DataSourceType.TEXT_BLOCK && ds.origin_details?.original_hash === identifier) return true;
    }
    // Add logic for other types if needed
    return false;
  });
  return found ? found.id : null;
};

export const useBookMarkStore = create<BookmarkState>((set, get) => ({
  // bookmarks: [], // Removed
  pendingOperations: {},

  addBookmark: async (item, workspaceId) => {
    const identifier = item.url; // Use URL as the primary identifier for now
    if (!identifier) {
      console.error('Cannot add bookmark: Missing URL identifier.');
      toast({ title: "Error", description: "Cannot bookmark item without a URL.", variant: "destructive" });
      return;
    }

    set((state) => ({ pendingOperations: { ...state.pendingOperations, [identifier]: 'add' } }));

    try {
      const { createDataSource } = useDataSourceStore.getState();

      // Determine DataSource Type and prepare origin_details
      let dataSourceType: DataSourceType;
      let originDetails: Record<string, any> = {};

      if (item.url) {
        dataSourceType = "url_list";
        originDetails = { urls: [item.url] };
      } else if (item.text_content) {
        // If no URL but text content exists, treat as TEXT_BLOCK
        dataSourceType = "text_block";
        originDetails = { text_content: item.text_content };
        // TODO: Consider adding a hash or other unique identifier for text blocks
      } else {
        throw new Error('Cannot determine DataSource type: Requires URL or text_content.');
      }

      // Prepare FormData for createDataSource
      // Note: The API expects FormData fields, not a single formData object
      const formData = new FormData();
      formData.append('name', item.title || `Imported Item - ${new Date().toISOString()}`);
      formData.append('type', dataSourceType);
      formData.append('origin_details', JSON.stringify(originDetails));
      // No file is uploaded in this case

      // We need the workspaceId for the API call, but createDataSource in the store
      // currently reads it from useWorkspaceStore.getState(). We might need to adjust
      // createDataSource or ensure the active workspace is correctly set.
      // Assuming createDataSource handles the workspace context internally for now.
      const newDataSource = await createDataSource(formData);

      if (newDataSource) {
        console.log('Bookmark added as DataSource:', newDataSource);
        toast({ title: "Item Imported", description: `"${item.title || identifier}" imported successfully.`, variant: "default" });
      } else {
        // createDataSource should throw or return null on failure
        throw new Error('Failed to create DataSource for bookmark.');
      }

    } catch (error) {
      console.error('Error adding bookmark as DataSource:', error);
      toast({ title: "Import Failed", description: error instanceof Error ? error.message : "Could not import item.", variant: "destructive" });
      // Rethrow or handle as needed
    } finally {
      set((state) => {
        const newPending = { ...state.pendingOperations };
        delete newPending[identifier];
        return { pendingOperations: newPending };
      });
    }
  },

  removeBookmark: async (identifier, workspaceId) => {
    if (!identifier) {
      console.error('Cannot remove bookmark: Missing identifier.');
      return;
    }

    set((state) => ({ pendingOperations: { ...state.pendingOperations, [identifier]: 'remove' } }));

    try {
      // Get DataSources for the current workspace to find the one to delete
      // This relies on useDataSourceStore having the current list
      const { dataSources, deleteDataSource } = useDataSourceStore.getState();
      const { activeWorkspace } = useWorkspaceStore.getState();

      // Ensure we are operating within the correct workspace context
      if (!activeWorkspace || activeWorkspace.id !== workspaceId) {
        throw new Error('Workspace context mismatch or missing active workspace.');
      }

      const dataSourceIdToDelete = findDataSourceByIdentifier(identifier, dataSources);

      if (!dataSourceIdToDelete) {
        // If not found locally, maybe it exists but wasn't fetched?
        // For now, assume local state is sufficient or deletion fails gracefully.
        console.warn(`DataSource for identifier "${identifier}" not found in local state.`);
        toast({ title: "Not Found", description: "Could not find the imported item to remove.", variant: "default" });
         // Still remove from pending ops
         set((state) => {
           const newPending = { ...state.pendingOperations };
           delete newPending[identifier];
           return { pendingOperations: newPending };
         });
        return; 
      }

      // Call deleteDataSource from the store
      await deleteDataSource(dataSourceIdToDelete);

      console.log(`DataSource ${dataSourceIdToDelete} deleted for bookmark identifier ${identifier}`);
      toast({ title: "Item Removed", description: `Item removed successfully.`, variant: "default" });

    } catch (error) {
      console.error(`Error removing bookmark (DataSource) for identifier ${identifier}:`, error);
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