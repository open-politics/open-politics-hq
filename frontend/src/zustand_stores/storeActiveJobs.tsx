/**
 * storeActiveJobs — track ``IngestionJob`` ids that the user has spawned
 * from chat actions and should see live progress for.
 *
 * Decouples the spawning surface (e.g. ``SearchResultIngestor`` deep inside
 * a tool-result renderer tree) from the rendering surface (``Chat`` mounts
 * one ``<JobProgressBanner>`` per id) so we don't have to thread callbacks
 * through every renderer layer.
 *
 * Generic over IngestionJob kinds — any chat-spawned action that creates
 * an IngestionJob can ``addJob(jobId, label)`` and get a banner rendered.
 * The banner removes itself via ``removeJob`` when it sees a terminal
 * stream event (completed | failed).
 */

import { create } from 'zustand'

export interface ActiveJob {
  jobId: number
  infospaceId: number
  label?: string
  /** Wall-clock start so we can age out forgotten jobs if needed. */
  startedAt: number
}

interface ActiveJobsState {
  jobs: ActiveJob[]
  addJob: (job: Omit<ActiveJob, 'startedAt'>) => void
  removeJob: (jobId: number) => void
  clearAll: () => void
}

export const useActiveJobsStore = create<ActiveJobsState>((set) => ({
  jobs: [],
  addJob: (job) =>
    set((state) => {
      // Deduplicate — re-adding the same job_id is a no-op so banner state
      // (SSE connection, terminal flag) isn't reset by an accidental double-call.
      if (state.jobs.some((j) => j.jobId === job.jobId)) return state
      return { jobs: [...state.jobs, { ...job, startedAt: Date.now() }] }
    }),
  removeJob: (jobId) =>
    set((state) => ({ jobs: state.jobs.filter((j) => j.jobId !== jobId) })),
  clearAll: () => set({ jobs: [] }),
}))
