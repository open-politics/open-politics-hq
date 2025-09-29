import { create } from 'zustand';
import { useEffect, useRef } from 'react'; // Import useRef
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { RecurringTasksService } from '@/client';
import {
  RecurringTaskRead as ClientRecurringTaskRead,
  RecurringTasksOut,
  RecurringTaskCreate as ClientRecurringTaskCreate,
  RecurringTaskUpdate as ClientRecurringTaskUpdate,
  RecurringTaskStatus as ClientRecurringTaskStatus,
  RecurringTaskType as ClientRecurringTaskType
} from '@/client';
import { toast } from 'sonner';

// Define the shape of RecurringTask in the frontend store, extending the client model
export type RecurringTask = ClientRecurringTaskRead & {
    // Add fields potentially missing in client models but expected from backend
    last_successful_run_at?: string | null;
    consecutive_failure_count?: number | null; // Also seems likely to exist based on backend code
};
export type RecurringTaskCreate = ClientRecurringTaskCreate;
export type RecurringTaskUpdate = ClientRecurringTaskUpdate;
// Export enums/types for use in components
export type { ClientRecurringTaskStatus as RecurringTaskStatus };
export type { ClientRecurringTaskType as RecurringTaskType };


interface RecurringTasksState {
  recurringTasks: Record<number, RecurringTask>; // Use Record for easier updates/lookups
  isLoading: boolean;
  error: string | null;
  fetchRecurringTasks: () => Promise<void>;
  createRecurringTask: (taskData: RecurringTaskCreate) => Promise<RecurringTask | null>;
  updateRecurringTask: (taskId: number, taskData: RecurringTaskUpdate) => Promise<RecurringTask | null>;
  deleteRecurringTask: (taskId: number) => Promise<boolean>;
  // TODO: Add actions to activate/pause tasks? (These might just be updates)

  // NEW: Selector to find the INGEST task for a specific DataSource
  getIngestTaskForDataSource: (dataSourceId: number) => RecurringTask | null;
}

// Helper to convert array to record
const arrayToRecord = (tasks: RecurringTask[]): Record<number, RecurringTask> => {
    return tasks.reduce((acc, task) => {
        // Ensure task has an ID before adding
        if (task.id !== undefined) {
            acc[task.id] = task;
        }
        return acc;
    }, {} as Record<number, RecurringTask>);
};

export const useRecurringTasksStore = create<RecurringTasksState>((set, get) => ({
  recurringTasks: {}, // Initialize as empty object
  isLoading: false,
  error: null,

  fetchRecurringTasks: async () => {
    const { activeInfospace } = useInfospaceStore.getState();
    if (!activeInfospace?.id) {
      console.warn("Cannot fetch recurring tasks, no active Infospace.");
      set({ recurringTasks: {}, isLoading: false, error: null }); // Clear tasks
      return;
    }
    const InfospaceId = activeInfospace.id;

    set({ isLoading: true, error: null });
    try {
      const response: RecurringTasksOut = await RecurringTasksService.readRecurringTasks({
        InfospaceId: InfospaceId,
        limit: 1000,
      });
      const tasksArray = response.data as RecurringTask[];
      set({ recurringTasks: arrayToRecord(tasksArray), isLoading: false });
    } catch (err: any) {
      console.error("Error fetching recurring tasks:", err);
      const errorMsg = err.body?.detail || 'Failed to fetch recurring tasks';
      set({ error: errorMsg, isLoading: false, recurringTasks: {} }); // Ensure empty object on error
      toast.error('Error Fetching Recurring Tasks', { description: errorMsg });
    }
  },

  createRecurringTask: async (taskData: RecurringTaskCreate): Promise<RecurringTask | null> => {
    const { activeInfospace } = useInfospaceStore.getState();
    if (!activeInfospace?.id) {
      // Log the reason for failure
      console.error("Cannot create recurring task: No active Infospace selected.");
      set({ error: "No active Infospace selected" });
       toast.error('Error Creating Recurring Task', { description: "No active Infospace selected." });
      return null; // Explicitly return null
    }
    const InfospaceId = activeInfospace.id;
    console.log(`Attempting to create recurring task for Infospace ${InfospaceId}:`, taskData); // Add log

    // Check if taskData is valid before proceeding
    console.log("Validating taskData before API call:");
    console.log("  taskData:", taskData);
    console.log("  taskData.name:", !!taskData?.name);
    console.log("  taskData.type:", !!taskData?.type);
    console.log("  taskData.schedule:", !!taskData?.schedule);
    console.log("  taskData.configuration:", taskData?.configuration);
    console.log("  Is configuration present?:", !!taskData?.configuration);
    if (!taskData || !taskData.name || !taskData.type || !taskData.schedule || !taskData.configuration) {
         console.error("Cannot create recurring task: Invalid task data provided.", taskData);
         set({ error: "Invalid task data provided." });
         toast.error('Error Creating Recurring Task', { description: "Invalid task data provided." });
         return null;
    }


    set({ isLoading: true, error: null });
    try {
      console.log("Calling RecurringTasksService.createRecurringTask..."); // Log before API call
      const createdTask: ClientRecurringTaskRead = await RecurringTasksService.createRecurringTask({
         InfospaceId: InfospaceId,
         requestBody: taskData
      });
       console.log("API call successful, created task:", createdTask); // Log after API call

      const newTask = createdTask as RecurringTask;

      // Ensure the new task has an ID before adding
      if (newTask.id === undefined) {
          console.error("Created task is missing an ID:", newTask);
          throw new Error("Created task is missing an ID.");
      }

      set(state => ({
        recurringTasks: { ...state.recurringTasks, [newTask.id]: newTask }, // Add to record
        isLoading: false,
      }));
      toast.success(`Recurring Task "${newTask.name}" created.`);
      return newTask;

    } catch (err: any) {
      console.error("Error creating recurring task via API:", err); // Specific log
      const errorMsg = err.body?.detail || 'Failed to create recurring task via API';
      set({ error: errorMsg, isLoading: false });
      toast.error('Error Creating Recurring Task', { description: errorMsg });
      return null; // Ensure null is returned on error
    }
  },

 updateRecurringTask: async (taskId: number, taskData: RecurringTaskUpdate): Promise<RecurringTask | null> => {
    const { activeInfospace } = useInfospaceStore.getState();
    if (!activeInfospace?.id) {
      console.error("Cannot update recurring task: No active Infospace selected.");
      set({ error: "No active Infospace selected" });
      toast.error('Error Updating Recurring Task', { description: "No active Infospace selected." });
      return null;
    }
    const InfospaceId = activeInfospace.id;

    console.log(`Attempting to update recurring task ${taskId} for Infospace ${InfospaceId}:`, taskData);

    set({ error: null }); // Clear previous errors, don't set loading for updates
    try {
        console.log("Calling RecurringTasksService.updateRecurringTask...");
        const updatedTaskRead: ClientRecurringTaskRead = await RecurringTasksService.updateRecurringTask({
            InfospaceId: InfospaceId,
            taskId: taskId,
            requestBody: taskData
        });
        console.log("API call successful, updated task:", updatedTaskRead);

        const updatedTask = updatedTaskRead as RecurringTask;

        set(state => {
            // Check if the task exists before trying to update
            if (state.recurringTasks[taskId]) {
                 // Merge existing task data with updated data
                 // Ensure configuration is handled correctly (deep merge if needed, though update usually replaces)
                 const mergedTask = { ...state.recurringTasks[taskId], ...updatedTask };
                return {
                    recurringTasks: { ...state.recurringTasks, [taskId]: mergedTask },
                };
            }
            console.warn(`Task ${taskId} not found in store during update.`);
            return state; // Return current state if task not found
        });
         // Conditionally toast only significant updates? Or rely on parent component?
         // toast.info(`Recurring Task "${updatedTask.name}" updated.`);
        return updatedTask;

    } catch (err: any) {
      console.error(`Error updating recurring task ${taskId} via API:`, err);
      const errorMsg = err.body?.detail || 'Failed to update recurring task via API';
      set({ error: errorMsg });
      toast.error('Error Updating Recurring Task', { description: errorMsg });
      return null;
    }
  },


  deleteRecurringTask: async (taskId: number): Promise<boolean> => {
    const { activeInfospace } = useInfospaceStore.getState();
     if (!activeInfospace?.id) {
        console.error("Cannot delete recurring task: No active Infospace selected.");
        set({ error: "No active Infospace selected" });
        toast.error('Error Deleting Recurring Task', { description: "No active Infospace selected." });
        return false;
    }
    const InfospaceId = activeInfospace.id;
    // Get task name for toast message *before* deleting
    const taskToDelete = get().recurringTasks[taskId];
    const taskName = taskToDelete?.name || `ID ${taskId}`;

     console.log(`Attempting to delete recurring task ${taskId} (${taskName}) for Infospace ${InfospaceId}`);


    set({ isLoading: true, error: null });
    try {
        console.log("Calling RecurringTasksService.deleteRecurringTask...");
        await RecurringTasksService.deleteRecurringTask({
            InfospaceId: InfospaceId,
            taskId: taskId,
        });
        console.log(`API call successful, deleted task ${taskId}`);


      set(state => {
          // Create a new object excluding the deleted task
          const { [taskId]: _, ...remainingTasks } = state.recurringTasks;
          return {
              recurringTasks: remainingTasks,
              isLoading: false,
          };
      });
      toast.success(`Recurring Task "${taskName}" deleted.`);
      return true;

    } catch (err: any) {
      console.error(`Error deleting recurring task ${taskId} via API:`, err);
      const errorMsg = err.body?.detail || 'Failed to delete recurring task via API';
      set({ error: errorMsg, isLoading: false });
      toast.error('Error Deleting Recurring Task', { description: errorMsg });
      return false;
    }
  },

  getIngestTaskForDataSource: (dataSourceId: number): RecurringTask | null => {
    // Iterate over the values of the record
    const tasks = Object.values(get().recurringTasks);
    return tasks.find(task =>
        task.type === 'ingest' &&
        task.configuration?.target_datasource_id === dataSourceId
    ) || null;
  },

}));

// --- Hooks ---

// Hook to initialize the store and fetch tasks on Infospace change
export const useInitializeRecurringTasksStore = () => {
  const fetchRecurringTasks = useRecurringTasksStore((state) => state.fetchRecurringTasks);
  const { activeInfospace } = useInfospaceStore();
  const currentInfospaceIdRef = useRef<number | null | undefined>(null);

  useEffect(() => {
      const currentInfospaceId = activeInfospace?.id;
      // Fetch only if Infospace ID exists and has changed
      if (currentInfospaceId && currentInfospaceId !== currentInfospaceIdRef.current) {
          console.log("Initializing recurring tasks store for Infospace:", currentInfospaceId);
          fetchRecurringTasks();
          currentInfospaceIdRef.current = currentInfospaceId; // Update ref *after* fetch is triggered
      } else if (!currentInfospaceId && currentInfospaceIdRef.current !== null) {
          // Clear tasks if Infospace becomes inactive
          console.log("Clearing recurring tasks due to inactive/no Infospace.");
          useRecurringTasksStore.setState({ recurringTasks: {}, isLoading: false, error: null });
          currentInfospaceIdRef.current = null; // Reset ref
      }
      // Intentionally no cleanup function to clear tasks on unmount here,
      // clearing happens when activeInfospace changes.
  }, [activeInfospace?.id, fetchRecurringTasks]);
};

// Export specific hooks for loading and error status
export const useIsRecurringTasksLoading = () => useRecurringTasksStore(state => state.isLoading);
export const useRecurringTasksError = () => useRecurringTasksStore(state => state.error); 