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
  ResourceType,
} from '@/client';
import { devtools } from 'zustand/middleware';
import { shallow } from 'zustand/shallow';
import { useShareableStore } from './storeShareables';
import { toast } from 'sonner';
import { useWorkspaceStore } from './storeWorkspace';

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
    exportClassificationJob: (jobId: number) => Promise<void>;
    exportMultipleClassificationJobs: (jobIds: number[]) => Promise<void>;
    importClassificationJob: (file: File) => Promise<ClassificationJobRead | null>;
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
            const errorMsg = error instanceof Error ? error.message : 'Failed to fetch classification jobs';
            console.error('Failed to fetch classification jobs:', error);
            set({ isLoading: false, error: errorMsg });
            toast.error(errorMsg);
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
            toast.success(`Job "${newJob.name}" created successfully.`);
            return newJob;
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Failed to add classification job';
            console.error('Failed to add classification job:', error);
            set({ isLoading: false, error: errorMsg });
            toast.error(errorMsg);
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
            toast.success(`Job "${updatedJob.name}" updated successfully.`);
            return updatedJob;
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Failed to update classification job';
            console.error('Failed to update classification job:', error);
            set({
              isLoading: false,
              error: errorMsg,
            });
            toast.error(errorMsg);
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
            toast.success("Job deleted successfully.");
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Failed to delete classification job';
            console.error('Failed to delete classification job:', error);
            set({
              isLoading: false,
              error: errorMsg,
            });
            toast.error(errorMsg);
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
        exportClassificationJob: async (jobId: number) => {
          set({ isLoading: true, error: null });
          try {
            await useShareableStore.getState().exportResource('classification_job' as ResourceType, jobId);
            set({ isLoading: false });
            toast.success("Classification job export initiated.");
          } catch (err) {
            console.error("Export Classification Job error:", err);
            const message = err instanceof Error ? err.message : 'Failed to export classification job';
            set({ error: message, isLoading: false });
            toast.error(message);
          }
        },
        exportMultipleClassificationJobs: async (jobIds: number[]) => {
          if (!jobIds || jobIds.length === 0) {
            toast.info("No classification jobs selected for export.");
            return;
          }
          set({ isLoading: true, error: null });
          try {
            await useShareableStore.getState().exportResourcesBatch('classification_job' as ResourceType, jobIds);
            set({ isLoading: false });
            toast.success("Batch classification job export initiated.");
          } catch (err) {
            console.error("Batch export Classification Jobs error:", err);
            const message = err instanceof Error ? err.message : 'Failed to batch export classification jobs';
            set({ error: message, isLoading: false });
            toast.error(message);
          }
        },
        importClassificationJob: async (file: File) => {
          const activeWorkspaceId = useWorkspaceStore.getState().activeWorkspace?.id;
          if (!activeWorkspaceId) {
            const msg = "No active workspace selected. Cannot import classification job.";
            toast.error(msg);
            set({ error: msg, isLoading: false });
            return null;
          }

          set({ isLoading: true, error: null });
          try {
            const importedJob = await useShareableStore.getState().importResource(file, activeWorkspaceId);
            
            const job = importedJob as ClassificationJobRead | null;

            if (job && typeof job.id === 'number') {
              set((state) => {
                state.classificationJobs[job.id] = job;
                state.isLoading = false;
              });
              toast.success(`Classification job "${job.name || job.id}" imported successfully.`);
              return job;
            } else {
              throw new Error("Imported data is not a valid classification job or import failed.");
            }
          } catch (err) {
            console.error("Import Classification Job error:", err);
            const message = err instanceof Error ? err.message : 'Failed to import classification job';
            set({ error: message, isLoading: false });
            toast.error(message);
            return null;
          }
        }
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