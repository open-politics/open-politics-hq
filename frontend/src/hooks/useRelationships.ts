/**
 * Hooks for graph-scoped EntityRelationship management.
 *
 * Relationships are derived from GraphEdge groupby; the materialized overlay
 * (label, notes, tags, properties, is_pinned) is sparse — created lazily on
 * first user PATCH. Tombstone via ``is_active=False`` when last edge dies.
 *
 * Backend lives at ``/api/v1/infospaces/{iid}/graphs/{gid}/relationships/...``.
 * The pair ``(a, b)`` is normalized to canonical order (``a < b``) by the
 * backend; callers can pass it in any order.
 */

import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@/components/ui/use-toast';
import { RelationshipsService } from '@/client';
import type {
  EntityRelationshipRead,
  EntityRelationshipUpdate,
  DeleteImpact,
} from '@/client';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';

interface UseRelationshipsOptions {
  pinnedOnly?: boolean;
  tags?: string[];
}

export function useRelationships(graphId: number | null, options: UseRelationshipsOptions = {}) {
  const { activeInfospace } = useInfospaceStore();
  const { toast } = useToast();
  const [relationships, setRelationships] = useState<EntityRelationshipRead[]>([]);
  const [loading, setLoading] = useState(false);
  const { pinnedOnly, tags } = options;

  const refresh = useCallback(async () => {
    if (!activeInfospace || graphId == null) return;
    setLoading(true);
    try {
      const result = await RelationshipsService.listRelationships({
        infospaceId: activeInfospace.id,
        graphId,
        pinnedOnly,
        tags,
      });
      setRelationships(result);
    } catch (err: any) {
      toast({ title: 'Failed to load relationships', description: err?.message ?? String(err), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [activeInfospace, graphId, pinnedOnly, tags, toast]);

  useEffect(() => { void refresh(); }, [refresh]);

  return { relationships, loading, refresh };
}

export function useUpsertRelationship() {
  const { activeInfospace } = useInfospaceStore();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const upsert = useCallback(async (
    graphId: number,
    a: number,
    b: number,
    body: EntityRelationshipUpdate,
  ): Promise<EntityRelationshipRead | null> => {
    if (!activeInfospace) return null;
    setLoading(true);
    try {
      return await RelationshipsService.upsertRelationship({
        infospaceId: activeInfospace.id,
        graphId,
        a,
        b,
        requestBody: body,
      });
    } catch (err: any) {
      toast({ title: 'Failed to update relationship', description: err?.message ?? String(err), variant: 'destructive' });
      return null;
    } finally {
      setLoading(false);
    }
  }, [activeInfospace, toast]);

  return { upsert, loading };
}

export function useDeleteRelationshipOverlay() {
  const { activeInfospace } = useInfospaceStore();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const previewOrConfirm = useCallback(async (
    graphId: number,
    a: number,
    b: number,
    confirm: boolean,
  ): Promise<DeleteImpact | null> => {
    if (!activeInfospace) return null;
    setLoading(true);
    try {
      return await RelationshipsService.deleteRelationshipOverlay({
        infospaceId: activeInfospace.id,
        graphId,
        a,
        b,
        requestBody: { confirm },
      });
    } catch (err: any) {
      toast({ title: 'Failed to delete relationship overlay', description: err?.message ?? String(err), variant: 'destructive' });
      return null;
    } finally {
      setLoading(false);
    }
  }, [activeInfospace, toast]);

  return { previewOrConfirm, loading };
}
