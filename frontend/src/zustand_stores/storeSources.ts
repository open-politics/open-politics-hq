import { create } from 'zustand';
import { SourcesService } from '@/client';
import { SourceRead, SourceCreateRequest } from '@/client';
import { useInfospaceStore } from './storeInfospace';
import { toast } from 'sonner';

interface SourceState {
  sources: SourceRead[];
  isLoading: boolean;
  error: string | null;
  fetchSources: () => Promise<void>;
  createSource: (sourceData: SourceCreateRequest) => Promise<SourceRead | null>;
  updateSource: (sourceId: number, sourceData: any) => Promise<SourceRead | null>;
  deleteSource: (sourceId: number) => Promise<void>;
  triggerSourceProcessing: (sourceId: number) => Promise<void>;
}

export const useSourceStore = create<SourceState>((set, get) => ({
  sources: [],
  isLoading: false,
  error: null,
  fetchSources: async () => {
    const activeInfospace = useInfospaceStore.getState().activeInfospace;
    if (!activeInfospace) {
      set({ sources: [], isLoading: false, error: 'No active infospace selected.' });
      return;
    }

    set({ isLoading: true, error: null });
    try {
      const response = await SourcesService.listSources({ infospaceId: activeInfospace.id });
      const sources = response.data;
      set({ sources, isLoading: false });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
      console.error('Fetch sources error:', err);
      set({ isLoading: false, error: errorMessage });
      toast.error(errorMessage);
    }
  },
  createSource: async (sourceData) => {
    const activeInfospace = useInfospaceStore.getState().activeInfospace;
    if (!activeInfospace) {
      const errorMessage = 'No active infospace selected.';
      set({ error: errorMessage });
      toast.error(errorMessage);
      return null;
    }

    set({ isLoading: true, error: null });
    try {
      const newSource = await SourcesService.createSource({
        infospaceId: activeInfospace.id,
        requestBody: sourceData,
      });
      set(state => ({
        sources: [...state.sources, newSource],
        isLoading: false
      }));
      return newSource;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create source.';
      console.error('Create source error:', err);
      set({ isLoading: false, error: errorMessage });
      toast.error(errorMessage);
      return null;
    }
  },
  updateSource: async (sourceId, sourceData) => {
    const activeInfospace = useInfospaceStore.getState().activeInfospace;
    if (!activeInfospace) {
      const errorMessage = 'No active infospace selected.';
      set({ error: errorMessage });
      toast.error(errorMessage);
      return null;
    }

    set({ isLoading: true, error: null });
    try {
      const updatedSource = await SourcesService.updateSource({
        infospaceId: activeInfospace.id,
        sourceId: sourceId,
        requestBody: sourceData,
      });
      set(state => ({
        sources: state.sources.map(s => s.id === sourceId ? updatedSource : s),
        isLoading: false
      }));
      toast.success('Source updated successfully');
      return updatedSource;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update source.';
      console.error('Update source error:', err);
      set({ isLoading: false, error: errorMessage });
      toast.error(errorMessage);
      return null;
    }
  },
  deleteSource: async (sourceId) => {
    const activeInfospace = useInfospaceStore.getState().activeInfospace;
    if (!activeInfospace) {
      const errorMessage = 'No active infospace selected.';
      set({ error: errorMessage });
      toast.error(errorMessage);
      return;
    }

    set({ isLoading: true, error: null });
    try {
      await SourcesService.deleteSource({
        infospaceId: activeInfospace.id,
        sourceId: sourceId,
      });
      set(state => ({
        sources: state.sources.filter(s => s.id !== sourceId),
        isLoading: false
      }));
      toast.success('Source deleted successfully');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete source.';
      console.error('Delete source error:', err);
      set({ isLoading: false, error: errorMessage });
      toast.error(errorMessage);
    }
  },
  triggerSourceProcessing: async (sourceId) => {
    const activeInfospace = useInfospaceStore.getState().activeInfospace;
    if (!activeInfospace) {
      const errorMessage = 'No active infospace selected.';
      set({ error: errorMessage });
      toast.error(errorMessage);
      return;
    }

    try {
      // Use the generated client service method
      await SourcesService.triggerSourceProcessing({
        infospaceId: activeInfospace.id,
        sourceId: sourceId,
      });
      
      // Refresh sources to get updated status
      await get().fetchSources();
      toast.success('Source processing triggered successfully');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to trigger source processing.';
      console.error('Source processing error:', err);
      set({ error: errorMessage });
      toast.error(errorMessage);
    }
  }
}));
