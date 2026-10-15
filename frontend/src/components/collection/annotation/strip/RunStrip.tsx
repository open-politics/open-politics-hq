'use client';

import React, { useLayoutEffect, useMemo, useRef } from 'react';
import type { AnnotationRunRead, AnnotationSchemaRead } from '@/client';
import { SourceStreams, type SourceStream } from '@/components/collection/assets/SourceStreams';
import { groupAnchorKey, groupSources } from '@/components/collection/intake/sources/SourceList';
import { useScrollEdges } from '@/hooks/useScrollEdges';
import { runBundleIds, useRunBundles, type RunLedger } from '@/lib/annotations/ledger';
import { cn } from '@/lib/utils';
import { useSourceStore } from '@/zustand_stores/storeSources';
import { RunAssetDetailColumn } from './RunAssetDetailColumn';
import { RunAssetsColumn } from './RunAssetsColumn';
import { RunSourcesColumn } from './RunSourcesColumn';

/** Where a column starts along the strip's scroll — wherever it is nested. */
const leftIn = (strip: HTMLElement, el: HTMLElement) =>
  el.getBoundingClientRect().left - strip.getBoundingClientRect().left + strip.scrollLeft;

/** Bring one of the strip's columns into view, from anywhere on the page. */
export function scrollToRunColumn(name: 'sources' | 'assets' | 'detail' | 'run') {
  // After the frame that mounts it, when the ask is also what opens it.
  requestAnimationFrame(() =>
    document
      .querySelector(`[data-panel-strip] [data-run-column="${name}"]`)
      ?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' }),
  );
}

/**
 * The run page as one strip, read left to right the way the material moves:
 * where it comes from (sources, when open), what the run has to read and has
 * read (assets), one asset up close (when picked), the run itself, and what
 * has been made of it (the dashboard's panels, passed in as children after
 * the run column).
 *
 * The page opens on the run: everything left of it is there to scroll back
 * to, and the strip's edge fade says so. Columns left of the run mount only
 * when asked for (sources, detail) or render lazily (assets), so opening a run
 * costs what it did before they existed.
 *
 * Narrow, the strip is a column: the sources stay away (their lines need the
 * columns side by side) and the assets show only when asked for.
 */
export function RunStrip({
  run,
  ledger,
  schemas,
  pinned,
  sourcesOpen,
  onSourcesOpen,
  detailAssetId,
  onDetailAsset,
  narrowAssetsOpen,
  onExtendAssets,
  children,
}: {
  run: AnnotationRunRead;
  ledger: RunLedger;
  schemas: AnnotationSchemaRead[];
  pinned: boolean;
  sourcesOpen: boolean;
  onSourcesOpen: (open: boolean) => void;
  detailAssetId: number | null;
  onDetailAsset: (assetId: number | null) => void;
  narrowAssetsOpen: boolean;
  onExtendAssets?: () => void;
  children: React.ReactNode;
}) {
  const stripRef = useScrollEdges<HTMLDivElement>('x');
  const flowRef = useRef<HTMLDivElement>(null);
  const sourceListRef = useRef<HTMLDivElement>(null);
  const watch = useMemo(() => [sourceListRef], []);

  // A live run's bundles grow; read them again as it moves.
  const bundles = useRunBundles(run, ledger.version);
  const bundleIds = runBundleIds(run);
  // What the source lines aim at: the queue, standing for the run's bundles.
  const anchorId = bundleIds[0] ?? -run.id;

  const sources = useSourceStore((s) => s.sources);
  const streams = useMemo<SourceStream[]>(() => {
    if (!sourcesOpen) return [];
    const feeding = new Set(bundleIds);
    // In list order, so the lines' lanes nest the way the rows do.
    return groupSources(sources)
      .flatMap((section) => section.sources)
      .filter((s) => s.output_bundle_id != null && feeding.has(s.output_bundle_id))
      .map((s) => ({ sourceId: s.id, bundleId: anchorId, group: groupAnchorKey(s.group) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources, sourcesOpen, bundleIds.join(','), anchorId]);

  // The sources open to the left of the assets, so the strip grows behind
  // where you are looking. Before the paint, hold the assets where they were;
  // then glide left to what just opened, the way a new window opens into a
  // scrolling tiler beside the one that asked for it. Closing, land on the
  // assets — what is left of where you were.
  const sourcesWere = useRef(sourcesOpen);
  useLayoutEffect(() => {
    if (sourcesWere.current === sourcesOpen) return;
    sourcesWere.current = sourcesOpen;
    const strip = stripRef.current;
    const assets = strip?.querySelector<HTMLElement>('[data-run-column="assets"]');
    if (!strip || !assets) return;
    if (!sourcesOpen) {
      strip.scrollLeft = leftIn(strip, assets);
      return;
    }
    const sources = strip.querySelector<HTMLElement>('[data-run-column="sources"]');
    if (!sources) return;
    strip.scrollLeft += leftIn(strip, assets) - leftIn(strip, sources);
    requestAnimationFrame(() => strip.scrollTo({ left: leftIn(strip, sources), behavior: 'smooth' }));
  }, [sourcesOpen, stripRef]);

  // Open on the run, before the first paint, so nothing visibly jumps.
  useLayoutEffect(() => {
    const strip = stripRef.current;
    const runColumn = strip?.querySelector<HTMLElement>('[data-run-column="run"]');
    if (strip && runColumn) strip.scrollLeft = leftIn(strip, runColumn);
  }, [run.id, stripRef]);

  return (
    <div
      ref={stripRef}
      data-panel-strip
      className={cn(
        'relative flex min-h-0 flex-1 flex-col',
        '@3xl/page:flex-row @3xl/page:gap-px @3xl/page:overflow-x-auto @3xl/page:overflow-y-hidden @3xl/page:snap-x @3xl/page:snap-proximity',
        // Pinned, the run column covers the strip's left edge once it gets
        // there: panels are sized against the room beside it (`--pinned`)
        // and snap to its edge rather than under it. The edge fade goes,
        // since it would fade the pinned column itself.
        pinned ? '@3xl/page:scroll-pl-72 [--pinned:18rem]' : 'scroll-edges-x',
      )}
    >
      {/* Sources and assets share one box, so the lines between them are
          drawn in one frame of reference and ride along with the strip. */}
      <div
        ref={flowRef}
        className={cn(
          'relative shrink-0 gap-10 @3xl/page:flex',
          narrowAssetsOpen ? 'flex max-h-[70dvh] border-b border-hud-line @3xl/page:max-h-none @3xl/page:border-b-0' : 'hidden',
        )}
      >
        {sourcesOpen && (
          <div className="hidden @3xl/page:contents">
            <RunSourcesColumn ref={sourceListRef} />
          </div>
        )}
        <RunAssetsColumn
          run={run}
          ledger={ledger}
          bundles={bundles}
          anchorId={anchorId}
          selectedAssetId={detailAssetId}
          onSelectAsset={onDetailAsset}
          sourcesOpen={sourcesOpen}
          onExtendAssets={onExtendAssets}
          onToggleSources={() => {
            onSourcesOpen(!sourcesOpen);
          }}
        />
        <SourceStreams containerRef={flowRef} streams={streams} watch={watch} />
      </div>

      {detailAssetId != null && (
        <div className="hidden shrink-0 @3xl/page:flex">
          <RunAssetDetailColumn assetId={detailAssetId} run={run} schemas={schemas} onClose={() => onDetailAsset(null)} />
        </div>
      )}

      {children}
    </div>
  );
}
