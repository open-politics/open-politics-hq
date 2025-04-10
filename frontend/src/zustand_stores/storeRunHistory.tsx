import { create } from 'zustand';
import { ClassificationService } from '@/lib/classification/service';
import { ClassificationRunRead } from '@/client/models';
import { format } from 'date-fns';

export interface RunHistoryItem {
  id: number;
  name: string;
  timestamp: string;
  documentCount: number;
  schemeCount: number;
  description?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface RunHistoryState {
  runs: RunHistoryItem[];
  isLoading: boolean;
  error: string | null;
  fetchRunHistory: (workspaceId: number) => Promise<void>;
}

export const useRunHistoryStore = create<RunHistoryState>((set) => ({
  runs: [],
  isLoading: false,
  error: null,

  fetchRunHistory: async (workspaceId: number) => {
    set({ isLoading: true, error: null });
    try {
      const apiRuns: ClassificationRunRead[] = await ClassificationService.getRunsAPI(workspaceId);

      const runs: RunHistoryItem[] = apiRuns.map(run => ({
        id: run.id,
        name: run.name || `Run ${run.id}`,
        timestamp: run.updated_at ? format(new Date(run.updated_at), 'PPp') : 'N/A',
        documentCount: run.document_count ?? 0,
        schemeCount: run.scheme_count ?? 0,
        description: run.description ?? undefined,
        status: run.status ?? 'unknown',
        createdAt: run.created_at,
        updatedAt: run.updated_at,
      }));

      runs.sort((a, b) => {
        const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return dateB - dateA;
      });

      set({ runs, isLoading: false });
    } catch (error: any) {
      console.error('Error fetching run history:', error);
      set({ 
        error: error.message || 'Failed to fetch run history', 
        isLoading: false 
      });
    }
  },
})); 