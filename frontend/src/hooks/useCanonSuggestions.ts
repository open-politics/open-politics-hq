/**
 * Hook for fetching canon-extension suggestions for a run.
 *
 * Given a run and a target canon, the backend proposes which entries from
 * the run's transient ``graph_config.entity_merges`` would land where:
 *
 * - ``add``: name doesn't exist in canon — would be added.
 * - ``already_present``: name matches an existing entity by alias.
 * - ``conflict``: name resolves but to a different canonical name.
 *
 * No side-effects — pure suggestion endpoint.
 */

import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@/components/ui/use-toast';
import { CanonsService } from '@/client';
import type { CanonSuggestionsResponse } from '@/client';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';

export function useCanonSuggestions(runId: number | null, canonId: number | null) {
  const { activeInfospace } = useInfospaceStore();
  const { toast } = useToast();
  const [suggestions, setSuggestions] = useState<CanonSuggestionsResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!activeInfospace || runId == null || canonId == null) return;
    setLoading(true);
    try {
      const result = await CanonsService.suggestCanonExtensions({
        infospaceId: activeInfospace.id,
        runId,
        canonId,
      });
      setSuggestions(result);
    } catch (err: any) {
      toast({ title: 'Failed to load suggestions', description: err?.message ?? String(err), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [activeInfospace, runId, canonId, toast]);

  useEffect(() => { void refresh(); }, [refresh]);

  return { suggestions, loading, refresh };
}
