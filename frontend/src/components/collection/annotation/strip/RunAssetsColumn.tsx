'use client';

import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { FolderCheck, Inbox, Plus } from 'lucide-react';
import { RunsService, type AnnotationRunRead, type BundleRead, type RunLedgerAsset } from '@/client';
import { getAssetIconComponent } from '@/components/collection/assets/assetKindConfig';
import { HUD_LABEL, HUD_NUM } from '@/components/ui/chrome';
import type { RunLedger } from '@/lib/annotations/ledger';
import { since } from '@/lib/since';
import { cn } from '@/lib/utils';

/** Rows a pane shows: enough to watch it move, few enough to read at once. */
const WINDOW = 10;
/** How many more each "more" adds, up to what one ask may return. */
const MORE = 40;
const MOST = 500;

const fmt = (n: number) => n.toLocaleString();

type State = 'queued' | 'annotated';

/**
 * Where an asset stands, carried by its own icon: quiet while it waits, green
 * once read, rose when reading it failed. The row stays one glyph wide, and
 * the state is read in the same glance as the kind.
 */
const TONE: Record<RunLedgerAsset['status'], string> = {
  queued: 'text-hud-dimmer',
  success: 'text-emerald-600 dark:text-emerald-400',
  failed: 'text-rose-600 dark:text-rose-400',
};

/**
 * A live window onto one state of the run's assets: the first rows of the
 * queue (in the order they will be read) or of what has been read (newest
 * first), asked again whenever the run's counts move. Rows that leave fold
 * away and rows that arrive slide in, so the pane is seen to move — the
 * queue draining at the top, the read filling in at the top.
 */
function usePane(run: AnnotationRunRead, state: State, version: string | number, size: number) {
  const [items, setItems] = useState<RunLedgerAsset[] | null>(null);
  const [total, setTotal] = useState(0);

  // A new run starts from nothing, not from the last run's rows.
  useEffect(() => setItems(null), [run.id]);

  useEffect(() => {
    let current = true;
    RunsService.listRunAssets({ infospaceId: run.infospace_id, runId: run.id, state, skip: 0, limit: size })
      .then((page) => {
        if (!current) return;
        setItems(page.items);
        setTotal(page.total);
      })
      .catch(() => current && setItems((prev) => prev ?? []));
    return () => {
      current = false;
    };
  }, [run.infospace_id, run.id, state, version, size]);

  return { items, total };
}

/** A row of a pane. Its ref is the presence animation's, which needs to
 *  measure a row as it leaves. Past the first window rows do not animate their
 *  moves — at a few hundred, measuring every one on each refresh costs more
 *  than the motion is worth. */
const AssetRow = React.forwardRef<HTMLLIElement, {
  asset: RunLedgerAsset; selected: boolean; onSelect: () => void; animate: boolean;
}>(function AssetRow({ asset, selected, onSelect, animate }, ref) {
  const Icon = getAssetIconComponent(asset.kind);
  const label = asset.status === 'queued' ? 'Queued' : asset.status === 'failed' ? 'Failed' : 'Annotated';
  return (
    <motion.li
      ref={ref}
      layout={animate ? 'position' : false}
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
    >
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'flex w-full min-w-0 items-center gap-2.5 rounded-md px-2 py-1 text-left outline-none transition-colors hover:bg-hud-sunken focus-visible:bg-hud-sunken',
          selected && 'bg-hud-sunken',
        )}
      >
        <Icon aria-label={label} className={cn('h-3.5 w-3.5 shrink-0 stroke-[1.5]', TONE[asset.status])} />
        <span className={cn('min-w-0 flex-1 truncate text-[13px]', asset.status === 'queued' ? 'text-hud-dim' : 'text-hud-fg')}>
          {asset.title || `Asset ${asset.id}`}
        </span>
        {/* When it got where it is: arrived, or was read. */}
        {asset.at && (
          <span className={cn(HUD_NUM, 'shrink-0 text-hud-dimmer')} title={new Date(asset.at).toLocaleString()}>
            {since(asset.at)}
          </span>
        )}
      </button>
    </motion.li>
  );
});

/**
 * One half of the column: a heading with the one figure only it can give,
 * then the live window, then a way to see further.
 */
function Pane({
  icon: Icon,
  name,
  figure,
  figureTitle,
  items,
  total,
  size,
  onMore,
  empty,
  selectedAssetId,
  onSelectAsset,
  port,
}: {
  icon: React.ComponentType<{ className?: string }>;
  name: string;
  figure: React.ReactNode;
  figureTitle: string;
  items: RunLedgerAsset[] | null;
  total: number;
  size: number;
  onMore: () => void;
  empty: string;
  selectedAssetId: number | null;
  onSelectAsset: (id: number) => void;
  /** A point on the column's edge, level with the heading, for lines to arrive at. */
  port?: React.ReactNode;
}) {
  const rest = size >= 500 ? 0 : total - Math.min(total, size);
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="relative flex h-9 shrink-0 items-center gap-2 px-4">
        {port}
        <Icon className="h-4 w-4 shrink-0 stroke-[1.5] text-hud-dim" />
        <span className="text-[13px] font-medium text-hud-fg">{name}</span>
        <span className={cn(HUD_NUM, 'ml-auto text-hud-dimmer')} title={figureTitle}>{figure}</span>
      </div>
      <div className="scroll-edges min-h-0 flex-1 overflow-y-auto pb-2 pl-7 pr-2">
        {items == null ? null : items.length === 0 ? (
          <p className="px-2 py-1 text-xs text-hud-dimmer">{empty}</p>
        ) : (
          <ul className="space-y-px">
            {/* Leaving rows stop holding their place at once, so the
                window rotates without a stutter. */}
            <AnimatePresence initial={false} mode="popLayout">
              {items.map((a, k) => (
                <AssetRow key={a.id} asset={a} animate={k < WINDOW} selected={a.id === selectedAssetId} onSelect={() => onSelectAsset(a.id)} />
              ))}
            </AnimatePresence>
          </ul>
        )}
        {rest > 0 && (
          <button
            type="button"
            onClick={onMore}
            className={cn(HUD_LABEL, 'mt-1 rounded px-2 py-1 text-hud-dimmer transition-colors hover:text-hud-fg')}
          >
            {fmt(rest)} more
          </button>
        )}
      </div>
    </section>
  );
}

/**
 * The middle of the flow: what the run reads. Its title is the bundle the
 * material lands in; below it, the queue of what the run has yet to read on
 * the top half, and what it has read on the bottom half — both in view at
 * once, both moving as the run works. The source lines come in at the queue,
 * through a port on the column's edge, so they never cross a row; a spine
 * down the left carries the queue into the read.
 *
 * Numbers live where they are not said already: the run column states how
 * many are done, of how many, and how many failed. This column adds what
 * only it can — how many are still waiting, and how recent each one is.
 */
export function RunAssetsColumn({
  run,
  ledger,
  bundles,
  anchorId,
  selectedAssetId,
  onSelectAsset,
  sourcesOpen,
  onToggleSources,
  onExtendAssets,
}: {
  run: AnnotationRunRead;
  ledger: RunLedger;
  bundles: BundleRead[];
  /** The id the source lines aim at; carried by the queue's port. */
  anchorId: number;
  selectedAssetId: number | null;
  onSelectAsset: (assetId: number) => void;
  sourcesOpen: boolean;
  onToggleSources: () => void;
  /** Add assets to the run, where the run takes them (one-offs only). */
  onExtendAssets?: () => void;
}) {
  const { summary, version } = ledger;
  const working = run.status === 'running' || run.status === 'pending';
  // A finished one-off never reads what is left; it is not waiting for it.
  const queueName = working || run.live ? 'Queue' : 'Not annotated';
  const title = bundles.length ? bundles.map((b) => b.name).join(', ') : 'Assets';
  // A run handed its assets one by one has no queue of its own to show.
  const hasQueue = summary?.in_scope != null;

  const [queueSize, setQueueSize] = useState(WINDOW);
  const [readSize, setReadSize] = useState(WINDOW);
  useEffect(() => {
    setQueueSize(WINDOW);
    setReadSize(WINDOW);
  }, [run.id]);
  // Each pane asks again only when its own count moves.
  const queueStamp = summary ? `${summary.queued}` : version;
  const readStamp = summary ? `${summary.annotated + summary.failed}:${summary.last_annotated_at ?? ''}` : version;
  const queue = usePane(run, 'queued', queueStamp, queueSize);
  const read = usePane(run, 'annotated', readStamp, readSize);


  return (
    <section
      aria-label="Run assets"
      data-run-column="assets"
      className="flex h-full w-full shrink-0 snap-start flex-col bg-background @3xl/page:w-96 @3xl/page:border-r @3xl/page:border-hud-line [content-visibility:auto]"
    >
      {/* Set like the run column's top — an eyebrow, then the title — so the
          columns read level across the strip. The title is where the
          material lands; the way to where it comes from sits on the side it
          comes from. */}
      <header className="shrink-0 space-y-1 px-4 pb-2 pt-4">
        <div className="-mx-1 flex h-[22px] items-center gap-1">
          <button
            type="button"
            onClick={onToggleSources}
            aria-pressed={sourcesOpen}
            title={sourcesOpen ? 'Hide the sources' : 'Show the sources flowing in'}
            className={cn(
              HUD_LABEL,
              'hidden items-center gap-1 rounded px-1 py-0.5 transition-colors hover:text-hud-fg @3xl/page:flex',
              sourcesOpen ? 'text-hud-fg' : 'text-hud-dimmer',
            )}
          >
            Sources
          </button>
          <span className={cn(HUD_LABEL, 'px-1 text-hud-dimmer @3xl/page:hidden')}>Reads</span>
          {onExtendAssets && (
            <button
              type="button"
              onClick={onExtendAssets}
              title="Add assets to this run"
              aria-label="Add assets to this run"
              className="ml-auto rounded p-1 text-hud-dimmer transition-colors hover:text-hud-fg"
            >
              <Plus className="h-3 w-3 stroke-[1.5]" />
            </button>
          )}
        </div>
        <h2 className="truncate text-[15px] font-semibold leading-snug tracking-tight text-hud-fg" title={title}>
          {title}
        </h2>
      </header>

      {/* The two halves, joined by the spine: from the queue's icon down to
          the read's, along the gutter the rows are indented past. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {hasQueue && (
          <span aria-hidden className="pointer-events-none absolute bottom-[calc(50%_-_0.625rem)] left-6 top-7 w-px bg-hud-line" />
        )}
        {hasQueue && (
          <Pane
            icon={Inbox}
            name={queueName}
            figure={summary ? fmt(summary.queued) : ''}
            figureTitle="Still to read"
            items={queue.items}
            total={queue.total}
            size={queueSize}
            onMore={() => setQueueSize((n) => Math.min(MOST, n + MORE))}
            empty={working ? 'Nothing waiting.' : 'Everything in scope has been read.'}
            selectedAssetId={selectedAssetId}
            onSelectAsset={onSelectAsset}
            port={<span aria-hidden data-bundle-id={anchorId} className="pointer-events-none absolute left-0 top-1/2 h-0 w-0" />}
          />
        )}
        <Pane
          icon={FolderCheck}
          name="Annotated"
          // How fresh the reading is — the one thing the run column does not say.
          figure={summary?.last_annotated_at ? since(summary.last_annotated_at) : ''}
          figureTitle="Latest annotation"
          items={read.items}
          total={read.total}
          size={readSize}
          onMore={() => setReadSize((n) => Math.min(MOST, n + MORE))}
          empty="Nothing read yet."
          selectedAssetId={selectedAssetId}
          onSelectAsset={onSelectAsset}
        />
      </div>
    </section>
  );
}
