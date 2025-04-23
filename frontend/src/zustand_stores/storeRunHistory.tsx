import { create } from 'zustand';
// import { ClassificationService } from '@/lib/classification/service'; // Deprecated
import { ClassificationJobsService } from '@/client/services'; // Use new service
import { ClassificationJobRead, ClassificationJobsOut } from '@/client/models'; // Use new model & import ClassificationJobsOut
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
  configuration?: ClassificationJobRead['configuration'];
}

interface RunHistoryState {
  runs: RunHistoryItem[];
  isLoading: boolean;
  error: string | null;
  // Renamed to fetchJobHistory for clarity, but keep original name for compatibility if needed
  fetchRunHistory: (workspaceId: number) => Promise<void>; 
}

export const useRunHistoryStore = create<RunHistoryState>((set) => ({
  runs: [],
  isLoading: false,
  error: null,

  // Renamed function internally for clarity, but exposed as fetchRunHistory
  fetchRunHistory: async (workspaceId: number) => {
    set({ isLoading: true, error: null });
    try {
      // Call the correct service method to fetch jobs - returns ClassificationJobsOut
      const response: ClassificationJobsOut = await ClassificationJobsService.listClassificationJobs({ 
        workspaceId,
        limit: 1000 // Added a limit, adjust as needed
      });
      // Extract the jobs array from the 'data' property of the response object
      const apiJobs: ClassificationJobRead[] = response.data || [];

      // Map ClassificationJobRead to RunHistoryItem
      const runs: RunHistoryItem[] = apiJobs.map((job: ClassificationJobRead) => {
        // Determine the timestamp - prioritize updated_at, fallback to created_at
        const timestampToSort = job.updated_at || job.created_at || new Date(0).toISOString(); 
        
        // Safely derive counts from the configuration object
        const config = job.configuration;
        const docCount = (config && Array.isArray(config.datasource_ids)) ? config.datasource_ids.length : 0;
        const schCount = (config && Array.isArray(config.scheme_ids)) ? config.scheme_ids.length : 0;

        return {
          id: job.id,
          name: job.name || `Job ${job.id}`,
          // Format the most relevant timestamp for display
          timestamp: format(new Date(timestampToSort), 'PPp'), 
          documentCount: docCount,
          schemeCount: schCount,
          description: job.description ?? undefined,
          status: job.status ?? 'unknown',
          createdAt: job.created_at,
          updatedAt: job.updated_at,
          configuration: job.configuration,
        };
      });

      // Sort by timestamp (most recent first)
      runs.sort((a, b) => {
        // Use the original date strings for more reliable sorting
        const dateA = new Date(a.updatedAt || a.createdAt || 0).getTime();
        const dateB = new Date(b.updatedAt || b.createdAt || 0).getTime();
        return dateB - dateA;
      });

      set({ runs, isLoading: false, error: null });
    } catch (error: any) {
      console.error('Error fetching job history:', error);
      // Extract specific error message if available from the API response
      const detail = error.body?.detail || error.message || 'Failed to fetch job history';
      set({ 
        error: detail, 
        isLoading: false, 
        runs: []
      });
    }
  },
})); 