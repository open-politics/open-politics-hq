import { create } from 'zustand';
import { AnnotationJobsService } from '@/client';
import { AnnotationRunRead } from '@/client';
import { connectSSE } from '@/lib/sse';
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
  annotationCount?: number;
}

interface RunHistoryState {
  runs: RunHistoryItem[];
  totalCount: number | null;
  isCounting: boolean;
  isLoading: boolean;
  error: string | null;
  fetchRunHistory: (infospaceId: number) => Promise<void>;
}

function mapRun(run: AnnotationRunRead): RunHistoryItem {
  const timestampToSort = run.updated_at || run.created_at || new Date(0).toISOString();
  const config = run.configuration as any;
  const targetAssetIds = (run as any)?.target_asset_ids || config?.asset_ids || config?.target_asset_ids || [];
  const targetSchemaIds = (run as any)?.schema_ids || config?.schema_ids || (run as any)?.target_schema_ids || [];

  return {
    id: run.id,
    name: run.name || `Run ${run.id}`,
    timestamp: format(new Date(timestampToSort), 'PPp'),
    documentCount: Array.isArray(targetAssetIds) ? targetAssetIds.length : 0,
    schemeCount: Array.isArray(targetSchemaIds) ? targetSchemaIds.length : 0,
    description: run.description ?? undefined,
    status: run.status ?? 'unknown',
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    configuration: run.configuration,
    annotationCount: run.annotation_count ?? undefined,
  };
}

function sortRuns(runs: RunHistoryItem[]): RunHistoryItem[] {
  return [...runs].sort((a, b) => {
    const dateA = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const dateB = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return dateB - dateA;
  });
}

export const useRunHistoryStore = create<RunHistoryState>((set) => ({
  runs: [],
  totalCount: null,
  isCounting: false,
  isLoading: false,
  error: null,

  fetchRunHistory: async (infospaceId: number) => {
    set({ isLoading: true, error: null, isCounting: true });

    const url = `/api/v1/infospaces/${infospaceId}/runs?limit=1000`;
    const controller = new AbortController();

    try {
      await connectSSE({
        url,
        method: 'GET',
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === 'error') {
            try {
              const err = JSON.parse(event.data);
              set({ error: err.detail ?? 'Failed to fetch run history', isLoading: false, isCounting: false });
            } catch {
              set({ error: 'Failed to fetch run history', isLoading: false, isCounting: false });
            }
            return;
          }

          let phase: any;
          try {
            phase = JSON.parse(event.data);
          } catch {
            return;
          }

          if (event.type === 'runs') {
            const runs = sortRuns((phase.data || []).map(mapRun));
            set({ runs, isLoading: false, isCounting: phase.count === -1 });
          }

          if (event.type === 'count') {
            set({ totalCount: phase.count, isCounting: false });
          }
        },
        onError: (err) => {
          set({ error: err.message, isLoading: false, isCounting: false });
        },
      });
    } catch {
      // SSE failed — fall back to generated client
      try {
        const response = await AnnotationJobsService.listRuns({
          infospaceId,
          limit: 1000,
        });
        const runs = sortRuns((response.data || []).map(mapRun));
        set({ runs, totalCount: response.count, isLoading: false, isCounting: false, error: null });
      } catch (error: any) {
        const detail = error.body?.detail || error.message || 'Failed to fetch run history';
        set({ error: detail, isLoading: false, isCounting: false, runs: [] });
      }
    }
  },
}));
