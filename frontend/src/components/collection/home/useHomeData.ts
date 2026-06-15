'use client';

import { useEffect, useMemo, useState } from 'react';
import { AnnotationSchemasService, KnowledgeGraphsService } from '@/client';
import type { AnnotationSchemaRead, AnnotationRunRead, KnowledgeGraphRead } from '@/client';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { useAnnotationRunStore } from '@/zustand_stores/useAnnotationRunStore';
import { usePackageStore, type PackageRead } from '@/zustand_stores/storePackages';
import { useBundleStore } from '@/zustand_stores/storeBundles';
import type { BundleRead } from '@/client';
import { useFeedAssets } from '@/components/collection/assets/Feed/useFeedAssets';
import type { AssetFeedItem } from '@/components/collection/assets/Feed/types';

/**
 * Single data source for the HQ home surface. The page calls this once and
 * passes slices down, so the dashboard fans out exactly one fetch per concern
 * (assets feed, schemas, runs, graphs, packages) rather than each module
 * re-fetching. Runs + packages reuse their shared zustand stores; schemas +
 * graphs are read straight from the generated client.
 */
export interface HomeData {
  infospaceId: number | null;
  embeddingsOn: boolean;
  assets: { items: AssetFeedItem[]; total: number | null; isLoading: boolean; favoriteBundles: BundleRead[] };
  schemas: { items: AnnotationSchemaRead[]; total: number; isLoading: boolean };
  analysis: { favorites: AnnotationRunRead[]; total: number; isLoading: boolean };
  graphs: { items: KnowledgeGraphRead[]; isLoading: boolean };
  packages: { items: PackageRead[]; isLoading: boolean };
}

const byNewest = <T extends { created_at: string }>(rows: T[]) =>
  [...rows].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

export function useHomeData(): HomeData {
  const { activeInfospace } = useInfospaceStore();
  const infospaceId = activeInfospace?.id ?? null;
  const embeddingsOn = Boolean((activeInfospace?.enrichment_config as any)?.embedding?.model_name);

  // Assets — recent feed + total count
  const feed = useFeedAssets({ infospaceId: infospaceId ?? 0, limit: 6, sortBy: 'created_at', sortOrder: 'desc' });

  // Favorited bundles (tag-based) — surfaced first in the Assets card.
  const bundles = useBundleStore((s) => s.bundles);
  const fetchBundles = useBundleStore((s) => s.fetchBundles);
  useEffect(() => { if (infospaceId) fetchBundles(infospaceId); }, [infospaceId, fetchBundles]);
  const favoriteBundles = useMemo(() => bundles.filter((b) => b.tags?.includes('favorite')), [bundles]);

  // Runs — favorites from the shared store
  const runs = useAnnotationRunStore((s) => s.runs);
  const fetchRuns = useAnnotationRunStore((s) => s.fetchRuns);
  const runsLoading = useAnnotationRunStore((s) => s.isLoading);
  useEffect(() => { if (infospaceId) fetchRuns(infospaceId); }, [infospaceId, fetchRuns]);
  const favorites = useMemo(
    () => runs
      .filter((r) => r.is_favorite)
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()),
    [runs],
  );

  // Packages — shared store (reads active infospace internally)
  const packages = usePackageStore((s) => s.packages);
  const fetchPackages = usePackageStore((s) => s.fetchPackages);
  const packagesLoading = usePackageStore((s) => s.isLoading);
  useEffect(() => { if (infospaceId) fetchPackages(); }, [infospaceId, fetchPackages]);

  // Schemas — direct client read
  const [schemas, setSchemas] = useState<AnnotationSchemaRead[]>([]);
  const [schemasLoading, setSchemasLoading] = useState(false);
  useEffect(() => {
    if (!infospaceId) { setSchemas([]); return; }
    let cancelled = false;
    setSchemasLoading(true);
    AnnotationSchemasService.listAnnotationSchemas({ infospaceId, limit: 200 })
      .then((res) => { if (!cancelled) setSchemas(res.data ?? []); })
      .catch(() => { if (!cancelled) setSchemas([]); })
      .finally(() => { if (!cancelled) setSchemasLoading(false); });
    return () => { cancelled = true; };
  }, [infospaceId]);

  // Graphs — direct client read
  const [graphs, setGraphs] = useState<KnowledgeGraphRead[]>([]);
  const [graphsLoading, setGraphsLoading] = useState(false);
  useEffect(() => {
    if (!infospaceId) { setGraphs([]); return; }
    let cancelled = false;
    setGraphsLoading(true);
    KnowledgeGraphsService.listKnowledgeGraphs({ infospaceId })
      .then((res) => { if (!cancelled) setGraphs(res ?? []); })
      .catch(() => { if (!cancelled) setGraphs([]); })
      .finally(() => { if (!cancelled) setGraphsLoading(false); });
    return () => { cancelled = true; };
  }, [infospaceId]);

  const schemasByNewest = useMemo(() => byNewest(schemas), [schemas]);
  const graphsByNewest = useMemo(() => byNewest(graphs), [graphs]);

  return {
    infospaceId,
    embeddingsOn,
    assets: { items: feed.items, total: feed.totalCount, isLoading: feed.isLoading, favoriteBundles },
    schemas: { items: schemasByNewest, total: schemas.length, isLoading: schemasLoading },
    analysis: { favorites, total: runs.length, isLoading: runsLoading },
    graphs: { items: graphsByNewest, isLoading: graphsLoading },
    packages: { items: packages, isLoading: packagesLoading },
  };
}
