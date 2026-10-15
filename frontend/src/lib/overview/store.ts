/**
 * The overview's client cache — one entry per (run, reading), kept across
 * panel mounts so reopening a panel paints at once while the stream catches
 * up behind it.
 *
 * An entry is whatever the stream last said, stage by stage. Each event
 * replaces its slot whole: the server sends full readings, never patches, so
 * there is nothing to merge and nothing to get wrong. A small LRU bounds it.
 */
import { create } from 'zustand';
import type { OverviewBuckets, OverviewEntities, OverviewFrame, OverviewPlan } from './types';

export type OverviewStatus = 'connecting' | 'loading' | 'ready' | 'live' | 'error';

export interface OverviewEntry {
  frame: OverviewFrame | null;
  plan: OverviewPlan | null;
  buckets: OverviewBuckets | null;
  entities: OverviewEntities | null;
  status: OverviewStatus;
  error: string | null;
  /** Milliseconds the server took for the initial load; null until `ready`. */
  loadMs: number | null;
}

export const EMPTY_ENTRY: OverviewEntry = {
  frame: null, plan: null, buckets: null, entities: null,
  status: 'connecting', error: null, loadMs: null,
};

const MAX_ENTRIES = 8;

interface OverviewStore {
  entries: Record<string, OverviewEntry>;
  order: string[];
  patch: (key: string, update: Partial<OverviewEntry>) => void;
}

export const useOverviewStore = create<OverviewStore>((set) => ({
  entries: {},
  order: [],
  patch: (key, update) => set((state) => {
    const entries = { ...state.entries, [key]: { ...(state.entries[key] ?? EMPTY_ENTRY), ...update } };
    const order = [key, ...state.order.filter((k) => k !== key)];
    for (const stale of order.slice(MAX_ENTRIES)) delete entries[stale];
    return { entries, order: order.slice(0, MAX_ENTRIES) };
  }),
}));
