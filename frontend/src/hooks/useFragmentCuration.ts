import { useState, useCallback } from 'react';
import { useToast } from "@/components/ui/use-toast";
import { AnalysisServiceService, PromoteFragmentRequest } from '@/client';
import { ApiError } from '@/client/core/ApiError';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';

interface CurationPayload {
  assetId: number;
  fragmentKey: string;
  fragmentValue: any;
}

interface UseFragmentCurationReturn {
  curate: (payloads: CurationPayload[]) => Promise<void>;
  isCurationLoading: boolean;
}

export function useFragmentCuration(): UseFragmentCurationReturn {
  const [isCurationLoading, setIsLoading] = useState(false);
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

    const results = await Promise.allSettled(
      payloads.map(payload => {
        const requestBody: PromoteFragmentRequest = {
          fragment_key: payload.fragmentKey,
          fragment_value: payload.fragmentValue,
        };
        return AnalysisServiceService.promoteFragment({
          infospaceId: activeInfospace.id,
          assetId: payload.assetId,
          requestBody,
        });
      })
    );

    setIsLoading(false);

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
      const firstError = results.find(result => result.status === 'rejected') as PromiseRejectedResult | undefined;
      let errorMessage = 'An unknown error occurred.';
      if (firstError) {
        const error = firstError.reason as ApiError;
        errorMessage = error.body?.detail || error.message;
      }
      toast({
        title: 'Curation Failed',
        description: `${failedCurations} fragment(s) failed to curate. Error: ${errorMessage}`,
        variant: 'destructive',
      });
    }
  }, [activeInfospace, toast]);

  return { curate, isCurationLoading };
}
