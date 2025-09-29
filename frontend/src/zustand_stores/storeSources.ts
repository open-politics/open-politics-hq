import { create } from 'zustand';
import { SourcesService } from '@/client/services';
import { SourceRead, SourceCreateRequest } from '@/client/models';
import { useInfospaceStore } from './storeInfospace';

interface SourceState {
  sources: SourceRead[];
  isLoading: boolean;
  error: string | null;
  fetchSources: () => Promise<void>;
  createSource: (sourceData: SourceCreateRequest) => Promise<SourceRead | null>;
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
      const error = err instanceof Error ? err.message : 'An unknown error occurred.';
      set({ isLoading: false, error });
    }
  },
  createSource: async (sourceData) => {
    const activeInfospace = useInfospaceStore.getState().activeInfospace;
    if (!activeInfospace) {
      set({ error: 'No active infospace selected.' });
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
      const error = err instanceof Error ? err.message : 'Failed to create source.';
      set({ isLoading: false, error });
      return null;
    }
  }
}));
