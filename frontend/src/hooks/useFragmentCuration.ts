import { useState, useCallback } from 'react';
import { useToast } from "@/components/ui/use-toast";
import { AnalysisServiceService, PromoteFragmentRequest, DeleteFragmentData } from '@/client';
import { ApiError } from '@/client/core/ApiError';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';

interface CurationPayload {
  assetId: number;
  fragmentKey: string;
  fragmentValue: any;
  sourceRunId?: number; // Original annotation run ID for proper source tracking
}

interface DeleteFragmentPayload {
  assetId: number;
  fragmentKey: string;
}

interface UseFragmentCurationReturn {
  curate: (payloads: CurationPayload[]) => Promise<void>;
  deleteFragment: (payload: DeleteFragmentPayload) => Promise<boolean>;
  isCurationLoading: boolean;
  curationProgress: { current: number; total: number } | null;
}

export function useFragmentCuration(): UseFragmentCurationReturn {
  const [isCurationLoading, setIsLoading] = useState(false);
  const [curationProgress, setCurationProgress] = useState<{ current: number; total: number } | null>(null);
  const { toast } = useToast();
  const { activeInfospace } = useInfospaceStore();

  const curate = useCallback(async (payloads: CurationPayload[]) => {
    if (!activeInfospace) {
      toast({
        title: 'Error',
        description: 'No active infospace selected.',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    setCurationProgress({ current: 0, total: payloads.length });

    // FIXED: Process sequentially to avoid race condition when updating asset.fragments
    // Multiple parallel requests would read the same initial state and overwrite each other
    const results: Array<{ status: 'fulfilled' | 'rejected'; value?: any; reason?: any }> = [];
    
    for (let i = 0; i < payloads.length; i++) {
      const payload = payloads[i];
      try {
        const requestBody: any = { // Using any temporarily until client types are regenerated
          fragment_key: payload.fragmentKey,
          fragment_value: payload.fragmentValue,
          source_run_id: payload.sourceRunId, // Pass original run ID
        };
        const result = await AnalysisServiceService.promoteFragment({
          infospaceId: activeInfospace.id,
          assetId: payload.assetId,
          requestBody,
        });
        results.push({ status: 'fulfilled', value: result });
        setCurationProgress({ current: i + 1, total: payloads.length });
      } catch (error) {
        results.push({ status: 'rejected', reason: error });
        setCurationProgress({ current: i + 1, total: payloads.length });
      }
    }

    setIsLoading(false);
    setCurationProgress(null);

    const successfulCurations = results.filter(result => result.status === 'fulfilled').length;
    const failedCurations = results.length - successfulCurations;

    if (successfulCurations > 0) {
      toast({
        title: 'Curation Successful',
        description: `Successfully curated ${successfulCurations} fragment(s).`,
        variant: 'default',
      });
    }

    if (failedCurations > 0) {
      const firstError = results.find(result => result.status === 'rejected');
      let errorMessage = 'An unknown error occurred.';
      if (firstError && firstError.reason) {
        const error = firstError.reason as any;
        errorMessage = error.body?.detail || error.message || String(error);
      }
      toast({
        title: 'Curation Failed',
        description: `${failedCurations} fragment(s) failed to curate. Error: ${errorMessage}`,
        variant: 'destructive',
      });
    }
  }, [activeInfospace, toast]);

  const deleteFragment = useCallback(async (payload: DeleteFragmentPayload): Promise<boolean> => {
    if (!activeInfospace) {
      toast({
        title: 'Error',
        description: 'No active infospace selected.',
        variant: 'destructive',
      });
      return false;
    }

    try {
      const result = await AnalysisServiceService.deleteFragment({
        infospaceId: activeInfospace.id,
        assetId: payload.assetId,
        fragmentKey: payload.fragmentKey,
      });

      if (!result.success) {
        throw new Error(result.message || 'Failed to delete fragment');
      }
      return true;
    } catch (error) {
      return false;
    }
  }, [activeInfospace]);

  return { curate, deleteFragment, isCurationLoading, curationProgress };
}
