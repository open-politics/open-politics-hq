import { create } from 'zustand';
// import { ClassificationService } from '@/lib/classification/service'; // Deprecated
import { AnnotationJobsService, AnnotationsService } from '@/client/services';
import { AnnotationRunRead, AnnotationRunsOut } from '@/client/models';
import { format } from 'date-fns';

export interface RunHistoryItem {
  id: number;
  name: string;
  timestamp: string; // Represents last updated time for sorting/display
  documentCount: number; // Now derived from datasource_ids
  schemeCount: number; // Now derived from scheme_ids
  description?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string; // Keep for sorting if available, fallback to created_at
  configuration?: AnnotationRunRead['configuration'];
}

interface RunHistoryState {
  runs: RunHistoryItem[];
  isLoading: boolean;
  error: string | null;
  // Renamed to fetchJobHistory for clarity, but keep original name for compatibility if needed
  fetchRunHistory: (infospaceId: number) => Promise<void>; 
}

export const useRunHistoryStore = create<RunHistoryState>((set) => ({
  runs: [],
  isLoading: false,
  error: null,

  // Renamed function internally for clarity, but exposed as fetchRunHistory
  fetchRunHistory: async (infospaceId: number) => {
    set({ isLoading: true, error: null });
    try {
      const response: AnnotationRunsOut = await AnnotationJobsService.listRuns({
        infospaceId,
        limit: 1000
      });
      const apiRuns: AnnotationRunRead[] = response.data || [];

      const runs: RunHistoryItem[] = apiRuns.map((run: AnnotationRunRead) => {
        const timestampToSort = run.updated_at || run.created_at || new Date(0).toISOString();
        
        const config = run.configuration as any;
        const targetAssetIds = (run as any)?.target_asset_ids || config?.asset_ids || config?.target_asset_ids || [];
        const targetSchemaIds = (run as any)?.schema_ids || config?.schema_ids || (run as any)?.target_schema_ids || [];

        const docCount = Array.isArray(targetAssetIds) ? targetAssetIds.length : 0;
        const schCount = Array.isArray(targetSchemaIds) ? targetSchemaIds.length : 0;

        return {
          id: run.id,
          name: run.name || `Run ${run.id}`,
          timestamp: format(new Date(timestampToSort), 'PPp'),
          documentCount: docCount,
          schemeCount: schCount,
          description: run.description ?? undefined,
          status: run.status ?? 'unknown',
          createdAt: run.created_at,
          updatedAt: run.updated_at,
          configuration: run.configuration,
        };
      });

      runs.sort((a, b) => {
        const dateA = new Date(a.updatedAt || a.createdAt || 0).getTime();
        const dateB = new Date(b.updatedAt || b.createdAt || 0).getTime();
        return dateB - dateA;
      });

      set({ runs, isLoading: false, error: null });
    } catch (error: any) {
      console.error('Error fetching run history:', error);
      const detail = error.body?.detail || error.message || 'Failed to fetch run history';
      set({
        error: detail,
        isLoading: false,
        runs: []
      });
    }
  },
})); 