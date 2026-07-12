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
  CanonEntryRead,
  CanonProposalRead,
  BulkProposalResponse,
  PromoteResponse,
  DeleteImpact,
  EntityMergeHint,
} from '@/client';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';

export function useCanons() {
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
      });
      setCanons(result);
    } catch (err: any) {
      toast({ title: 'Failed to load canons', description: err?.message ?? String(err), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [activeInfospace, toast]);

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
  const [entities, setEntities] = useState<CanonEntryRead[]>([]);
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
  ): Promise<CanonEntryRead | null> => {
    if (!activeInfospace) return null;
    setLoading(true);
    try {
      return await CanonsService.mergeInCanon({
        infospaceId: activeInfospace.id,
        canonId,
        requestBody: {
          entry_ids: entityIds,
          keep_id: keepId,
          canonical: canonicalName,
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

export function useExportCanon() {
  const { activeInfospace } = useInfospaceStore();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  /** Fetch the portable wire-format dict for a canon (caller triggers download). */
  const exportCanon = useCallback(async (canonId: number): Promise<Record<string, any> | null> => {
    if (!activeInfospace) return null;
    setLoading(true);
    try {
      const result = await CanonsService.exportCanon({
        infospaceId: activeInfospace.id,
        canonId,
      });
      return result as Record<string, any>;
    } catch (err: any) {
      toast({ title: 'Export failed', description: err?.message ?? String(err), variant: 'destructive' });
      return null;
    } finally {
      setLoading(false);
    }
  }, [activeInfospace, toast]);

  return { exportCanon, loading };
}

export function useImportCanon() {
  const { activeInfospace } = useInfospaceStore();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  /** Materialize a serialized canon (create-or-merge by external_id). */
  const importCanon = useCallback(async (
    payload: Record<string, any>,
    intoCanonId?: number,
  ): Promise<CanonRead | null> => {
    if (!activeInfospace) return null;
    setLoading(true);
    try {
      const result = await CanonsService.importCanon({
        infospaceId: activeInfospace.id,
        intoCanonId: intoCanonId ?? null,
        requestBody: payload,
      });
      toast({ title: 'Canon imported', description: result.name });
      return result;
    } catch (err: any) {
      toast({ title: 'Import failed', description: err?.message ?? String(err), variant: 'destructive' });
      return null;
    } finally {
      setLoading(false);
    }
  }, [activeInfospace, toast]);

  return { importCanon, loading };
}

/** Backfill embeddings for a canon's entries (fuzzy-resolution acceleration).
 * No-op server-side without a configured embedding provider. */
export function useEmbedCanon() {
  const { activeInfospace } = useInfospaceStore();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const embed = useCallback(async (canonId: number): Promise<boolean> => {
    if (!activeInfospace) return false;
    setLoading(true);
    try {
      await CanonsService.embedCanonAction({ infospaceId: activeInfospace.id, canonId });
      toast({ title: 'Embedding backfill started', description: 'Entries are being embedded for fuzzy resolution.' });
      return true;
    } catch (err: any) {
      toast({ title: 'Failed to start embedding', description: err?.message ?? String(err), variant: 'destructive' });
      return false;
    } finally {
      setLoading(false);
    }
  }, [activeInfospace, toast]);

  return { embed, loading };
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

/**
 * Pending (or otherwise filtered) CanonProposals for a canon — the staged
 * mentions that "resolve into canon" mode parks for human review. Optionally
 * scoped to a single run.
 */
export function useCanonProposals(
  canonId: number | null,
  opts?: { status?: string; runId?: number },
) {
  const { activeInfospace } = useInfospaceStore();
  const { toast } = useToast();
  const [proposals, setProposals] = useState<CanonProposalRead[]>([]);
  const [loading, setLoading] = useState(false);
  const status = opts?.status ?? 'pending';
  const runId = opts?.runId;

  const refresh = useCallback(async () => {
    if (!activeInfospace || canonId == null) return;
    setLoading(true);
    try {
      const result = await CanonsService.listCanonProposals({
        infospaceId: activeInfospace.id,
        canonId,
        status,
        runId,
      });
      setProposals(result);
    } catch (err: any) {
      toast({ title: 'Failed to load proposals', description: err?.message ?? String(err), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [activeInfospace, canonId, status, runId, toast]);

  useEffect(() => { void refresh(); }, [refresh]);

  return { proposals, loading, refresh };
}

export function useAcceptProposal() {
  const { activeInfospace } = useInfospaceStore();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  /** Settle a proposal — merge its surface into an existing entry, or (no id) create a new one. */
  const accept = useCallback(async (
    canonId: number,
    proposalId: number,
    mergeIntoEntryId?: number,
  ): Promise<CanonProposalRead | null> => {
    if (!activeInfospace) return null;
    setLoading(true);
    try {
      const result = await CanonsService.acceptCanonProposal({
        infospaceId: activeInfospace.id,
        canonId,
        proposalId,
        requestBody: { merge_into_entry_id: mergeIntoEntryId },
      });
      toast({ title: mergeIntoEntryId != null ? 'Merged into entry' : 'Entry created' });
      return result;
    } catch (err: any) {
      toast({ title: 'Failed to accept proposal', description: err?.message ?? String(err), variant: 'destructive' });
      return null;
    } finally {
      setLoading(false);
    }
  }, [activeInfospace, toast]);

  return { accept, loading };
}

export function useDismissProposal() {
  const { activeInfospace } = useInfospaceStore();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const dismiss = useCallback(async (canonId: number, proposalId: number): Promise<CanonProposalRead | null> => {
    if (!activeInfospace) return null;
    setLoading(true);
    try {
      return await CanonsService.dismissCanonProposal({
        infospaceId: activeInfospace.id,
        canonId,
        proposalId,
      });
    } catch (err: any) {
      toast({ title: 'Failed to dismiss proposal', description: err?.message ?? String(err), variant: 'destructive' });
      return null;
    } finally {
      setLoading(false);
    }
  }, [activeInfospace, toast]);

  return { dismiss, loading };
}

/** Triage many proposals in one call — accept (create-new or merge) and/or dismiss.
 * Affected runs are re-curated once each (async), so this is the live-flood path. */
export function useBulkTriageProposals() {
  const { activeInfospace } = useInfospaceStore();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const bulk = useCallback(async (
    canonId: number,
    body: { accept?: { proposal_id: number; merge_into_entry_id?: number }[]; dismiss?: number[] },
  ): Promise<BulkProposalResponse | null> => {
    if (!activeInfospace) return null;
    setLoading(true);
    try {
      const result = await CanonsService.bulkTriageProposals({
        infospaceId: activeInfospace.id,
        canonId,
        requestBody: { accept: body.accept ?? [], dismiss: body.dismiss ?? [] },
      });
      const parts: string[] = [];
      if (result.accepted) parts.push(`${result.accepted} accepted`);
      if (result.dismissed) parts.push(`${result.dismissed} dismissed`);
      toast({
        title: parts.join(', ') || 'Nothing to do',
        description: result.runs_recurated ? `Re-curating ${result.runs_recurated} run(s)…` : undefined,
      });
      return result;
    } catch (err: any) {
      toast({ title: 'Bulk triage failed', description: err?.message ?? String(err), variant: 'destructive' });
      return null;
    } finally {
      setLoading(false);
    }
  }, [activeInfospace, toast]);

  return { bulk, loading };
}

/** Promote a run's authored folds into its (or an explicit) canon. */
export function usePromoteRun() {
  const { activeInfospace } = useInfospaceStore();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const promote = useCallback(async (runId: number, canonId?: number): Promise<PromoteResponse | null> => {
    if (!activeInfospace) return null;
    setLoading(true);
    try {
      const result = await CanonsService.promoteRunToCanon({
        infospaceId: activeInfospace.id,
        runId,
        requestBody: { canon_id: canonId },
      });
      toast({
        title: 'Promoted to canon',
        description: `${result.created ?? 0} created, ${result.merged ?? 0} merged, ${result.extended ?? 0} extended`,
      });
      return result;
    } catch (err: any) {
      toast({ title: 'Failed to promote', description: err?.message ?? String(err), variant: 'destructive' });
      return null;
    } finally {
      setLoading(false);
    }
  }, [activeInfospace, toast]);

  return { promote, loading };
}

/** Toggle a run's "resolve into canon" mode. Returns true on success. */
export function useSetResolveIntoCanon() {
  const { activeInfospace } = useInfospaceStore();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const setMode = useCallback(async (runId: number, enabled: boolean): Promise<boolean> => {
    if (!activeInfospace) return false;
    setLoading(true);
    try {
      await CanonsService.setResolveIntoCanon({
        infospaceId: activeInfospace.id,
        runId,
        requestBody: { enabled },
      });
      return true;
    } catch (err: any) {
      toast({ title: 'Failed to update resolve mode', description: err?.message ?? String(err), variant: 'destructive' });
      return false;
    } finally {
      setLoading(false);
    }
  }, [activeInfospace, toast]);

  return { setMode, loading };
}
