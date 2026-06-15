'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { useBundleStore } from '@/zustand_stores/storeBundles';
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';

export interface BundleCrumb {
  id: number;
  name: string;
}

/**
 * Walk a bundle's parent chain (via the already-loaded bundle store) into a
 * root→bundle path of {id, name}, cycle-guarded. Empty for null/0/unknown ids.
 * The path is derived from `parent_bundle_id`, so it's the same wherever the
 * bundle is shown — no navigation context needed for bundles.
 */
export function useBundlePath(bundleId: number | null | undefined): BundleCrumb[] {
  const bundles = useBundleStore((s) => s.bundles);
  const fetchBundles = useBundleStore((s) => s.fetchBundles);
  const activeInfospaceId = useInfospaceStore((s) => s.activeInfospace?.id);

  // Some hosts (the asset manager) drive the tree from storeTree and never
  // populate the bundle store — so a path would come back empty even though we
  // have the id. Load the hierarchy on demand when a path is requested.
  React.useEffect(() => {
    if (bundleId && bundles.length === 0 && activeInfospaceId) {
      fetchBundles(activeInfospaceId);
    }
  }, [bundleId, bundles.length, activeInfospaceId, fetchBundles]);

  return React.useMemo(() => {
    if (!bundleId) return [];
    const byId = new Map(bundles.map((b) => [b.id, b]));
    const chain: BundleCrumb[] = [];
    const seen = new Set<number>();
    let cur = byId.get(bundleId);
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      chain.unshift({ id: cur.id, name: cur.name });
      const pid = cur.parent_bundle_id;
      cur = pid && pid !== 0 ? byId.get(pid) : undefined;
    }
    return chain;
  }, [bundleId, bundles]);
}

/**
 * File-path-style breadcrumb for the detail views: `bundleA / bundleB / ▸ Title`.
 * Bundle segments are clickable (open that bundle); the leaf is the current
 * item — a small icon then its title, or an edit input when renaming.
 */
export function DetailBreadcrumb({
  segments,
  onSegmentClick,
  leafIcon,
  leafLabel,
  leafInput,
  className,
}: {
  /** Clickable ancestor bundle crumbs (root→parent), excluding the leaf. */
  segments: BundleCrumb[];
  onSegmentClick?: (bundleId: number) => void;
  /** Small icon shown directly before the leaf title (kind icon / folder). */
  leafIcon?: React.ReactNode;
  leafLabel: string;
  /** When editing, render this in place of the leaf label (e.g. an <input>). */
  leafInput?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 items-center gap-1 overflow-hidden text-[13px]', className)}>
      {segments.map((s) => (
        <React.Fragment key={s.id}>
          {/* Path segments keep their width (shrink-0) so the bundle path stays
              readable; the asset/bundle title (leaf) is what yields space. */}
          <button
            type="button"
            onClick={() => onSegmentClick?.(s.id)}
            className="max-w-[12rem] shrink-0 truncate text-muted-foreground transition-colors hover:text-foreground hover:underline"
            title={s.name}
          >
            {s.name}
          </button>
          <span className="shrink-0 text-muted-foreground/40">/</span>
        </React.Fragment>
      ))}
      {leafIcon}
      {leafInput ?? (
        <span className="min-w-0 truncate font-medium text-foreground" title={leafLabel}>
          {leafLabel || 'Untitled'}
        </span>
      )}
    </div>
  );
}
