/**
 * Hooks for Canon (vocabulary) management.
 *
 * Canon = an infospace-scoped vocabulary of entities. Multiple canons per
 * infospace; the same canon can back multiple knowledge graphs.
 *
 * Backend lives at ``/api/v1/infospaces/{iid}/canons/...``. Hooks here are
 * thin wrappers over the generated SDK that handle infospace scoping,
 * loading state, and toasts.
 */

import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@/components/ui/use-toast';
import { CanonsService } from '@/client';
import type {
  CanonRead,
  CanonCreate,
  CanonUpdate,
  CanonExtendResponse,
  EntityRead,
  DeleteImpact,
  EntityMergeHint,
} from '@/client';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';

type CanonRole = 'general' | 'geo';

export function useCanons(role?: CanonRole) {
  const { activeInfospace } = useInfospaceStore();
  const { toast } = useToast();
  const [canons, setCanons] = useState<CanonRead[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!activeInfospace) return;
    setLoading(true);
    try {
      const result = await CanonsService.listCanons({
        infospaceId: activeInfospace.id,
        role,
      });
      setCanons(result);
    } catch (err: any) {
      toast({ title: 'Failed to load canons', description: err?.message ?? String(err), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [activeInfospace, role, toast]);

  useEffect(() => { void refresh(); }, [refresh]);

  return { canons, loading, refresh };
}

export function useCanon(canonId: number | null) {
  const { activeInfospace } = useInfospaceStore();
  const { toast } = useToast();
  const [canon, setCanon] = useState<CanonRead | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!activeInfospace || canonId == null) return;
    setLoading(true);
    try {
      const result = await CanonsService.getCanon({
        infospaceId: activeInfospace.id,
        canonId,
      });
      setCanon(result);
    } catch (err: any) {
      toast({ title: 'Failed to load canon', description: err?.message ?? String(err), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [activeInfospace, canonId, toast]);

  useEffect(() => { void refresh(); }, [refresh]);

  return { canon, loading, refresh };
}

export function useCanonEntities(canonId: number | null, entityType?: string) {
  const { activeInfospace } = useInfospaceStore();
  const { toast } = useToast();
  const [entities, setEntities] = useState<EntityRead[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!activeInfospace || canonId == null) return;
    setLoading(true);
    try {
      const result = await CanonsService.listCanonEntities({
        infospaceId: activeInfospace.id,
        canonId,
        entityType,
      });
      setEntities(result);
    } catch (err: any) {
      toast({ title: 'Failed to load entities', description: err?.message ?? String(err), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [activeInfospace, canonId, entityType, toast]);

  useEffect(() => { void refresh(); }, [refresh]);

  return { entities, loading, refresh };
}

export function useCreateCanon() {
  const { activeInfospace } = useInfospaceStore();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const create = useCallback(async (body: CanonCreate): Promise<CanonRead | null> => {
    if (!activeInfospace) return null;
    setLoading(true);
    try {
      const created = await CanonsService.createCanon({
        infospaceId: activeInfospace.id,
        requestBody: body,
      });
      toast({ title: 'Canon created', description: created.name });
      return created;
    } catch (err: any) {
      toast({ title: 'Failed to create canon', description: err?.message ?? String(err), variant: 'destructive' });
      return null;
    } finally {
      setLoading(false);
    }
  }, [activeInfospace, toast]);

  return { create, loading };
}

export function useUpdateCanon() {
  const { activeInfospace } = useInfospaceStore();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const update = useCallback(async (canonId: number, body: CanonUpdate): Promise<CanonRead | null> => {
    if (!activeInfospace) return null;
    setLoading(true);
    try {
      return await CanonsService.updateCanon({
        infospaceId: activeInfospace.id,
        canonId,
        requestBody: body,
      });
    } catch (err: any) {
      toast({ title: 'Failed to update canon', description: err?.message ?? String(err), variant: 'destructive' });
      return null;
    } finally {
      setLoading(false);
    }
  }, [activeInfospace, toast]);

  return { update, loading };
}

export function useExtendCanon() {
  const { activeInfospace } = useInfospaceStore();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const extend = useCallback(async (canonId: number, runId: number): Promise<CanonExtendResponse | null> => {
    if (!activeInfospace) return null;
    setLoading(true);
    try {
      const result = await CanonsService.extendCanonFromRun({
        infospaceId: activeInfospace.id,
        canonId,
        requestBody: { run_id: runId },
      });
      toast({
        title: 'Canon extended',
        description: `${result.added} added, ${result.skipped} skipped`,
      });
      return result;
    } catch (err: any) {
      toast({ title: 'Failed to extend canon', description: err?.message ?? String(err), variant: 'destructive' });
      return null;
    } finally {
      setLoading(false);
    }
  }, [activeInfospace, toast]);

  return { extend, loading };
}

export function useMergeInCanon() {
  const { activeInfospace } = useInfospaceStore();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const merge = useCallback(async (
    canonId: number,
    entityIds: number[],
    keepId?: number,
    canonicalName?: string,
  ): Promise<EntityRead | null> => {
    if (!activeInfospace) return null;
    setLoading(true);
    try {
      return await CanonsService.mergeInCanon({
        infospaceId: activeInfospace.id,
        canonId,
        requestBody: {
          entity_ids: entityIds,
          keep_id: keepId,
          canonical_name: canonicalName,
        },
      });
    } catch (err: any) {
      toast({ title: 'Failed to merge entities', description: err?.message ?? String(err), variant: 'destructive' });
      return null;
    } finally {
      setLoading(false);
    }
  }, [activeInfospace, toast]);

  return { merge, loading };
}

export function useDeleteCanon() {
  const { activeInfospace } = useInfospaceStore();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  /**
   * Returns the DeleteImpact preview when ``confirm`` is false, or the same
   * shape with ``confirmed=true`` after destruction. Caller decides based on
   * ``can_proceed`` whether to confirm.
   */
  const previewOrConfirm = useCallback(async (canonId: number, confirm: boolean): Promise<DeleteImpact | null> => {
    if (!activeInfospace) return null;
    setLoading(true);
    try {
      return await CanonsService.deleteCanon({
        infospaceId: activeInfospace.id,
        canonId,
        requestBody: { confirm },
      });
    } catch (err: any) {
      toast({ title: 'Delete canon failed', description: err?.message ?? String(err), variant: 'destructive' });
      return null;
    } finally {
      setLoading(false);
    }
  }, [activeInfospace, toast]);

  return { previewOrConfirm, loading };
}
