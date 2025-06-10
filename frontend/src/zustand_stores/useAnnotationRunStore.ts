import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  AnnotationRunRead,
  AnnotationRunsService,
  AnnotationRunCreate,
  AnnotationRunUpdate,
  AnnotationRunsOut,
  ResourceType,
} from '@/client';
import { devtools } from 'zustand/middleware';
import { shallow } from 'zustand/shallow';
import { useShareableStore } from './storeShareables';
import { toast } from 'sonner';
import { useInfospaceStore } from './storeInfospace';

interface AnnotationRunState {
  runs: Record<number, AnnotationRunRead>;
  isLoading: boolean;
  error: string | null;
  actions: {
    fetchAnnotationRuns: (infospaceId: number) => Promise<void>;
    addAnnotationRun: (
      infospaceId: number,
      runData: AnnotationRunCreate
    ) => Promise<AnnotationRunRead | null>;
    updateAnnotationRun: (
      infospaceId: number,
      runId: number,
      runData: AnnotationRunUpdate
    ) => Promise<AnnotationRunRead | null>;
    deleteAnnotationRun: (
      infospaceId: number,
      runId: number
    ) => Promise<void>;
    getAnnotationRunById: (runId: number) => AnnotationRunRead | undefined;
    setAnnotationRuns: (runs: AnnotationRunRead[]) => void;
    exportAnnotationRun: (runId: number) => Promise<void>;
    exportMultipleAnnotationRuns: (runIds: number[]) => Promise<void>;
    importAnnotationRun: (file: File) => Promise<AnnotationRunRead | null>;
  };
}

export const useAnnotationRunStore = create<AnnotationRunState>()(
  devtools(
    immer((set, get) => ({
      runs: {},
      isLoading: false,
      error: null,
      actions: {
        setAnnotationRuns: (runs) => {
          set((state) => {
            state.runs = runs.reduce(
              (acc, run) => {
                acc[run.id] = run;
                return acc;
              },
              {} as Record<number, AnnotationRunRead>
            );
            state.isLoading = false;
            state.error = null;
          });
        },
        fetchAnnotationRuns: async (infospaceId) => {
          set({ isLoading: true, error: null });
          try {
            const response: AnnotationRunsOut =
              await AnnotationRunsService.listAnnotationRuns({
                infospaceId: infospaceId,
                limit: 500,
              });
            get().actions.setAnnotationRuns(response.data);
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Failed to fetch annotation runs';
            console.error('Failed to fetch annotation runs:', error);
            set({ isLoading: false, error: errorMsg });
            toast.error(errorMsg);
          }
        },
        addAnnotationRun: async (infospaceId, runData) => {
          set({ isLoading: true, error: null });
          try {
            const newRun: AnnotationRunRead =
              await AnnotationRunsService.createAnnotationRun({
                infospaceId: infospaceId,
                requestBody: runData
              });
            set((state) => {
              state.runs[newRun.id] = newRun;
              state.isLoading = false;
            });
            toast.success(`Run "${newRun.name}" created successfully.`);
            return newRun;
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Failed to add annotation run';
            console.error('Failed to add annotation run:', error);
            set({ isLoading: false, error: errorMsg });
            toast.error(errorMsg);
            return null;
          }
        },
        updateAnnotationRun: async (infospaceId, runId, runData) => {
          set({ isLoading: true, error: null });
          try {
            const updatedRun: AnnotationRunRead =
              await AnnotationRunsService.updateAnnotationRun({
                infospaceId: infospaceId,
                runId: runId,
                requestBody: runData
              });
            set((state) => {
              state.runs[updatedRun.id] = updatedRun;
              state.isLoading = false;
            });
            toast.success(`Run "${updatedRun.name}" updated successfully.`);
            return updatedRun;
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Failed to update annotation run';
            console.error('Failed to update annotation run:', error);
            set({
              isLoading: false,
              error: errorMsg,
            });
            toast.error(errorMsg);
            return null;
          }
        },
        deleteAnnotationRun: async (infospaceId, runId) => {
          set({ isLoading: true, error: null });
          try {
            await AnnotationRunsService.deleteAnnotationRun({
              infospaceId: infospaceId,
              runId: runId
            });
            set((state) => {
              delete state.runs[runId];
              state.isLoading = false;
            });
            toast.success("Run deleted successfully.");
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Failed to delete annotation run';
            console.error('Failed to delete annotation run:', error);
            set({
              isLoading: false,
              error: errorMsg,
            });
            toast.error(errorMsg);
          }
        },
        getAnnotationRunById: (runId) => {
          return get().runs[runId];
        },
        exportAnnotationRun: async (runId: number) => {
          set({ isLoading: true, error: null });
          try {
            await useShareableStore.getState().exportResource('run' as ResourceType, runId);
            set({ isLoading: false });
            toast.success("Annotation run export initiated.");
          } catch (err) {
            console.error("Export Annotation Run error:", err);
            const message = err instanceof Error ? err.message : 'Failed to export annotation run';
            set({ error: message, isLoading: false });
            toast.error(message);
          }
        },
        exportMultipleAnnotationRuns: async (runIds: number[]) => {
          if (!runIds || runIds.length === 0) {
            toast.info("No annotation runs selected for export.");
            return;
          }
          set({ isLoading: true, error: null });
          try {
            await useShareableStore.getState().exportResourcesBatch('run' as ResourceType, runIds);
            set({ isLoading: false });
            toast.success("Batch annotation run export initiated.");
          } catch (err) {
            console.error("Batch export Annotation Runs error:", err);
            const message = err instanceof Error ? err.message : 'Failed to batch export annotation runs';
            set({ error: message, isLoading: false });
            toast.error(message);
          }
        },
        importAnnotationRun: async (file: File) => {
          const activeInfospaceId = useInfospaceStore.getState().activeInfospace?.id;
          if (!activeInfospaceId) {
            const msg = "No active Infospace selected. Cannot import annotation run.";
            toast.error(msg);
            set({ error: msg, isLoading: false });
            return null;
          }

          set({ isLoading: true, error: null });
          try {
            const importedRun = await useShareableStore.getState().importResource(file, activeInfospaceId);
            
            const run = importedRun as AnnotationRunRead | null;

            if (run && typeof run.id === 'number') {
              set((state) => {
                state.runs[run.id] = run;
                state.isLoading = false;
              });
              toast.success(`Annotation run "${run.name || run.id}" imported successfully.`);
              return run;
            } else {
              throw new Error("Imported data is not a valid annotation run or import failed.");
            }
          } catch (err) {
            console.error("Import Annotation Run error:", err);
            const message = err instanceof Error ? err.message : 'Failed to import annotation run';
            set({ error: message, isLoading: false });
            toast.error(message);
            return null;
          }
        }
      },
    })),
    { name: 'AnnotationRunStore' }
  )
);

export const useAnnotationRunActions = () =>
  useAnnotationRunStore((state) => state.actions);
export const useIsAnnotationRunsLoading = () =>
  useAnnotationRunStore((state) => state.isLoading);
export const useAnnotationRunsError = () =>
  useAnnotationRunStore((state) => state.error); 