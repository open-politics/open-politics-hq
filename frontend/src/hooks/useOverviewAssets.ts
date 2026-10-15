'use client';

/**
 * useOverviewAssets — the assets behind one overview count, paged.
 *
 * A place or an entity, opened under the reading it was clicked in: the same
 * bindings, aliases, `within` narrowing, counted sections and time brush. The
 * server cuts the list from the very streams that made the count
 * (`annotation/overview.py::assets_for`), so a marker that says 443 opens 443.
 * Paging and memory are `useAssetPages`'.
 */
import {
  OverviewService, type MergeMap, type OverviewAssetsRequest,
} from '@/client';
import type { BindingPick } from '@/lib/overview/types';
import { useAssetPages } from './useAssetPages';

export interface OverviewFocus {
  kind: 'place' | 'entity';
  /** The identity the overview shipped — `entry:<id>` or `name:<key>`. */
  id: string;
  name: string;
}

export interface OverviewAssetsParams {
  infospaceId: number;
  runId: number;
  focus: OverviewFocus | null;
  bindings?: Record<string, BindingPick>;
  mergeMaps?: MergeMap[];
  within?: string | null;
  /** Section keys counted, dated by row — or null for every stream, dated by asset. */
  sections: string[] | null;
  window: { start: string; end: string; grain: string } | null;
}

export function useOverviewAssets({
  infospaceId, runId, focus, bindings, mergeMaps, within, sections, window,
}: OverviewAssetsParams) {
  const request: OverviewAssetsRequest | null = focus && {
    bindings: bindings ?? {},
    merge_maps: mergeMaps ?? [],
    within: within ?? null,
    place: focus.kind === 'place' ? focus.id : null,
    entity: focus.kind === 'entity' ? focus.id : null,
    sections,
    window,
  };
  const key = request ? `overview:${infospaceId}:${runId}:${JSON.stringify(request)}` : null;
  return useAssetPages(key, (offset, limit) => OverviewService.overviewAssets({
    infospaceId, runId, requestBody: { ...request!, offset, limit },
  }));
}
