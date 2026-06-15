import { create } from 'zustand';

/**
 * The one summonable right dock. Any call site — toolbar, tree, chat, results
 * table — opens content here; a single <DockHost/> (AssetManager's third column on
 * desktop, the layout's sheet on mobile) renders it. No routes.
 *
 * This collapses what used to be three overlapping systems: the layout's
 * `AssetDetailProvider` panel, the `useSurfaceStore` popover/overlay, and
 * AssetManager's private detail pane. Detail, discover, source editing, and the
 * article composer are now just dock content keys. `useAssetDetail()` adapts onto
 * this store when no annotation-overlay provider is in scope.
 *
 * A `stack` records the drill path (feed → bundle → asset → …) so `back()` walks
 * back up one level; emptying it returns to the host's home view (the feed).
 */

export type DockKey =
  | 'assetDetail'
  | 'bundleDetail'
  | 'discover'
  | 'sourceForm'
  | 'composer';

interface DockEntry {
  key: DockKey;
  init: any;
}

interface DockState {
  entry: DockEntry | null;
  /** Drill history below the current entry — back up one level at a time. */
  stack: DockEntry[];
  /** Row order registered by a results surface so asset detail can navigate ↑↓. */
  navIds: number[];
  /**
   * Count of components hosting the dock *inline* (e.g. AssetManager's third
   * column). When > 0 the layout's app-wide dock stands down so the same content
   * isn't rendered twice. Pages without an inline host (home, chat) use the layout.
   */
  inlineHostCount: number;

  /** Push the current entry onto the stack and show a new one. */
  open: (entry: DockEntry) => void;
  /** Pop one level; when the stack is empty, clear (host falls back to its home). */
  back: () => void;
  close: () => void;
  acquireInlineHost: () => void;
  releaseInlineHost: () => void;

  // Detail vocabulary — names match the old AssetDetail context so the adapter is 1:1.
  // `fromBundleId` is the bundle we opened the asset *from* (tree parent, feed
  // node membership, containing bundle) — used to build the breadcrumb path.
  openAsset: (assetId: number, fromBundleId?: number) => void;
  openBundle: (bundleId: number) => void;

  // Intake / authoring. (Sources *list* is a left rail, not dock content; only the
  // source editor and the article composer dock.)
  openDiscover: (opts?: { method?: 'search' | 'feed'; query?: string }) => void;
  openSourceForm: (opts?: { init?: any }) => void;
  openComposer: (opts?: { assetId?: number; mode?: 'create' | 'edit' }) => void;

  // Row navigation for asset detail (lateral — does not grow the drill stack).
  setNavAssetIds: (ids: number[]) => void;
  navigateAdjacent: (direction: 'prev' | 'next') => void;
}

export const useDock = create<DockState>((set, get) => ({
  entry: null,
  stack: [],
  navIds: [],
  inlineHostCount: 0,

  open: (entry) => set((s) => ({ entry, stack: s.entry ? [...s.stack, s.entry] : s.stack })),
  back: () =>
    set((s) => {
      if (s.stack.length === 0) return { entry: null, stack: [] };
      const stack = s.stack.slice();
      const prev = stack.pop()!;
      return { entry: prev, stack };
    }),
  close: () => set({ entry: null, stack: [] }),
  acquireInlineHost: () => set((s) => ({ inlineHostCount: s.inlineHostCount + 1 })),
  releaseInlineHost: () => set((s) => ({ inlineHostCount: Math.max(0, s.inlineHostCount - 1) })),

  openAsset: (assetId, fromBundleId) => get().open({ key: 'assetDetail', init: { assetId, fromBundleId } }),
  openBundle: (bundleId) => get().open({ key: 'bundleDetail', init: { bundleId } }),

  openDiscover: (opts = {}) =>
    get().open({ key: 'discover', init: { method: opts.method ?? 'search', query: opts.query } }),
  openSourceForm: (opts = {}) => get().open({ key: 'sourceForm', init: opts.init }),
  openComposer: (opts = {}) =>
    get().open({ key: 'composer', init: { assetId: opts.assetId, mode: opts.mode ?? (opts.assetId ? 'edit' : 'create') } }),

  setNavAssetIds: (ids) => set({ navIds: ids }),
  navigateAdjacent: (direction) => {
    const { entry, navIds } = get();
    if (!entry || entry.key !== 'assetDetail' || !navIds.length) return;
    const idx = navIds.indexOf(entry.init.assetId);
    if (idx < 0) return;
    const target = direction === 'prev' ? idx - 1 : idx + 1;
    if (target < 0 || target >= navIds.length) return;
    // Lateral nav within a result set keeps the same opened-from context.
    set({ entry: { key: 'assetDetail', init: { assetId: navIds[target], fromBundleId: entry.init.fromBundleId } } });
  },
}));
