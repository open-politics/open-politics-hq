import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  ClassificationJobRead,
  ClassificationJobsService,
  DataSourceRead,
  ClassificationSchemeRead,
  ClassificationJobCreate,
  ClassificationJobUpdate,
  ClassificationJobsOut,
} from '@/client';
import { devtools } from 'zustand/middleware';
import { shallow } from 'zustand/shallow';

interface ClassificationJobState {
  classificationJobs: Record<number, ClassificationJobRead>;
  isLoading: boolean;
  error: string | null;
  actions: {
    fetchClassificationJobs: (workspaceId: number) => Promise<void>;
    addClassificationJob: (
      workspaceId: number,
      jobData: ClassificationJobCreate
    ) => Promise<ClassificationJobRead | null>;
    updateClassificationJob: (
      workspaceId: number,
      jobId: number,
      jobData: ClassificationJobUpdate
    ) => Promise<ClassificationJobRead | null>;
    deleteClassificationJob: (
      workspaceId: number,
      jobId: number
    ) => Promise<void>;
    getClassificationJobById: (jobId: number) => ClassificationJobRead | undefined;
    getClassificationJobsByDataSourceId: (
      dataSourceId: number
    ) => ClassificationJobRead[];
    getClassificationJobsBySchemeId: (
      schemeId: number
    ) => ClassificationJobRead[];
    setClassificationJobs: (jobs: ClassificationJobRead[]) => void;
  };
}

export const useClassificationJobsStore = create<ClassificationJobState>()(
  devtools(
    immer((set, get) => ({
      classificationJobs: {},
      isLoading: false,
      error: null,
      actions: {
        setClassificationJobs: (jobs) => {
          set((state) => {
            state.classificationJobs = jobs.reduce(
              (acc, job) => {
                acc[job.id] = job;
                return acc;
              },
              {} as Record<number, ClassificationJobRead>
            );
            state.isLoading = false;
            state.error = null;
          });
        },
        fetchClassificationJobs: async (workspaceId) => {
          set({ isLoading: true, error: null });
          try {
            const response: ClassificationJobsOut =
              await ClassificationJobsService.listClassificationJobs({
                workspaceId: workspaceId,
                limit: 500,
                includeCounts: true
              });
            get().actions.setClassificationJobs(response.data);
          } catch (error) {
            console.error('Failed to fetch classification jobs:', error);
            set({ isLoading: false, error: 'Failed to fetch classification jobs' });
          }
        },
        addClassificationJob: async (workspaceId, jobData) => {
          set({ isLoading: true, error: null });
          try {
            const newJob: ClassificationJobRead =
              await ClassificationJobsService.createClassificationJob({
                workspaceId: workspaceId,
                requestBody: jobData
              });
            set((state) => {
              state.classificationJobs[newJob.id] = newJob;
              state.isLoading = false;
            });
            return newJob;
          } catch (error) {
            console.error('Failed to add classification job:', error);
            set({ isLoading: false, error: 'Failed to add classification job' });
            return null;
          }
        },
        updateClassificationJob: async (workspaceId, jobId, jobData) => {
          set({ isLoading: true, error: null });
          try {
            const updatedJob: ClassificationJobRead =
              await ClassificationJobsService.updateClassificationJob({
                workspaceId: workspaceId,
                jobId: jobId,
                requestBody: jobData
              });
            set((state) => {
              state.classificationJobs[updatedJob.id] = updatedJob;
              state.isLoading = false;
            });
            return updatedJob;
          } catch (error) {
            console.error('Failed to update classification job:', error);
            set({
              isLoading: false,
              error: 'Failed to update classification job',
            });
            return null;
          }
        },
        deleteClassificationJob: async (workspaceId, jobId) => {
          set({ isLoading: true, error: null });
          try {
            await ClassificationJobsService.deleteClassificationJob({
              workspaceId: workspaceId,
              jobId: jobId
            });
            set((state) => {
              delete state.classificationJobs[jobId];
              state.isLoading = false;
            });
          } catch (error) {
            console.error('Failed to delete classification job:', error);
            set({
              isLoading: false,
              error: 'Failed to delete classification job',
            });
          }
        },
        getClassificationJobById: (jobId) => {
          return get().classificationJobs[jobId];
        },
        getClassificationJobsByDataSourceId: (dataSourceId) => {
          const jobs = Object.values(get().classificationJobs);
          return jobs.filter((job: ClassificationJobRead) =>
            job.target_datasource_ids?.includes(dataSourceId)
          );
        },
        getClassificationJobsBySchemeId: (schemeId) => {
          const jobs = Object.values(get().classificationJobs);
          return jobs.filter((job: ClassificationJobRead) =>
            job.target_scheme_ids?.includes(schemeId)
          );
        },
      },
    })),
    { name: 'ClassificationJobsStore' }
  )
);

export const useClassificationJobsActions = () =>
  useClassificationJobsStore((state) => state.actions);
export const useIsClassificationJobsLoading = () =>
  useClassificationJobsStore((state) => state.isLoading);
export const useClassificationJobsError = () =>
  useClassificationJobsStore((state) => state.error); 