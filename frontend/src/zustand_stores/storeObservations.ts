import { create } from 'zustand'

/**
 * Active "observe" watchers — live resource subscriptions the chat opened via an
 * `observe` UI directive (e.g. "watch this run fill"). Rendered as floating
 * watchers by <ActiveObservations/>. Mirrors the storeActiveJobs + banners
 * pattern. Tool-result observes render inline via the renderer instead.
 */
export interface Observation {
  id: string
  topic: string
  resourceId: string | number
  label?: string
}

interface ObservationsState {
  observations: Observation[]
  add: (o: Omit<Observation, 'id'>) => void
  remove: (id: string) => void
  clear: () => void
}

let counter = 0

export const useObservations = create<ObservationsState>((set) => ({
  observations: [],
  add: (o) =>
    set((s) => {
      // Dedup by topic + resource so repeated directives don't stack watchers.
      if (s.observations.some((x) => x.topic === o.topic && String(x.resourceId) === String(o.resourceId))) {
        return s
      }
      counter += 1
      return { observations: [...s.observations, { ...o, id: `obs-${counter}` }] }
    }),
  remove: (id) => set((s) => ({ observations: s.observations.filter((x) => x.id !== id) })),
  clear: () => set({ observations: [] }),
}))
