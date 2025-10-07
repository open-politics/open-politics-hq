import React, { useEffect, useState, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, Loader2, AlertCircle, Play, Pause, Trash2, Edit, ExternalLink } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogFooter,
    DialogClose,
} from "@/components/ui/dialog";
import {
    useRecurringTasksStore,
    useInitializeRecurringTasksStore,
    RecurringTask,
    RecurringTaskStatus,
    RecurringTaskType,
    RecurringTaskCreate,
    RecurringTaskUpdate,
    useIsRecurringTasksLoading,
    useRecurringTasksError
} from '@/zustand_stores/storeRecurringTasks';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow } from 'date-fns';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import RecurringTaskFormDialog from './RecurringTaskFormDialog';
import { toast } from 'sonner';
import { shallow } from 'zustand/shallow';

// Helper function to format status
const formatStatus = (status: string | null | undefined) => {
    if (!status) return <Badge variant="outline">Unknown</Badge>;
    switch (status.toLowerCase()) {
        case 'success':
            return <Badge variant="default" className="bg-green-600 hover:bg-green-700">Success</Badge>;
        case 'error':
            return <Badge variant="destructive">Error</Badge>;
        case 'completed_with_errors': // Added for classification job status
            return <Badge variant="outline" className="border-yellow-500 text-yellow-600">Completed (Errors)</Badge>;
        case 'running': // Added for classification job status
            return <Badge variant="secondary">Running</Badge>;
        case 'pending': // Added for classification job status
            return <Badge variant="secondary">Pending</Badge>;
        case 'active':
             return <Badge variant="default" className="capitalize bg-blue-600 hover:bg-blue-700">Active</Badge>;
        case 'paused':
            return <Badge variant="outline" className="capitalize">Paused</Badge>;
        default:
            return <Badge variant="outline">{status}</Badge>;
    }
};

// Define Props interface
interface RecurringTasksSettingsProps {
  onLoadJob: (jobId: number) => void; // Expect the loading function as a prop
}

// Component now accepts props
export default function RecurringTasksSettings({ onLoadJob }: RecurringTasksSettingsProps) {
  // Initialize the store to fetch tasks when the component mounts
  useInitializeRecurringTasksStore();

  // Select the raw tasks object
  const tasksObject = useRecurringTasksStore((state) => state.recurringTasks);
  // Derive the array using useMemo
  const recurringTasks = useMemo(() => Object.values(tasksObject || {}), [tasksObject]);

  const isLoading = useIsRecurringTasksLoading();
  const error = useRecurringTasksError();

  // Get actions: Select the specific functions needed.
  // This avoids issues with passing shallow to the hook with middleware.
  // Zustand selectors for functions are generally stable unless the store itself is recreated.
  const createRecurringTask = useRecurringTasksStore((state) => state.createRecurringTask);
  const updateRecurringTask = useRecurringTasksStore((state) => state.updateRecurringTask);
  const deleteRecurringTask = useRecurringTasksStore((state) => state.deleteRecurringTask);

  const [taskToDelete, setTaskToDelete] = useState<RecurringTask | null>(null);
  // State to control *which* dialog is open (create or edit-ID)
  const [openDialog, setOpenDialog] = useState<'create' | number | null>(null);
  // Keep editingTask to hold data for the edit form when its dialog is open
  const [editingTask, setEditingTask] = useState<RecurringTask | null>(null);

  const handleToggleStatus = async (taskId: number, currentStatus: string) => {
      const newStatus: RecurringTaskStatus = currentStatus === 'active' ? 'paused' : 'active';
      console.log(`Toggling task ${taskId} status to ${newStatus}`);
      const updatePayload: RecurringTaskUpdate = { status: newStatus };
      await updateRecurringTask(taskId, updatePayload);
      toast.info(`Task status changed to ${newStatus}`);
  };

  const handleDelete = async (taskId: number) => {
    const task = recurringTasks.find(t => t.id === taskId);
    if (task) {
        setTaskToDelete(task);
    } else {
         console.error(`Task ${taskId} not found for deletion.`);
    }
  };

  const confirmDelete = async () => {
        if (taskToDelete) {
            console.log(`Confirming deletion of task ${taskToDelete.id}`);
            await deleteRecurringTask(taskToDelete.id);
            setTaskToDelete(null);
        }
  }

   const handleLoadJob = (jobId: number | null | undefined) => {
        if (jobId) {
            console.log(`Requesting load of Classification Job ${jobId}`);
            onLoadJob(jobId);
        } else {
            console.log("No associated job ID to load.");
        }
   }

   // This function is now passed to the FormDialog component
   // It will be called internally by the form on successful submit
   const handleFormSubmit = async (taskData: RecurringTaskCreate | RecurringTaskUpdate) => {
        try {
            // Use openDialog state to determine if we are editing
            if (typeof openDialog === 'number') {
                 const taskBeingEdited = recurringTasks.find(t => t.id === openDialog);
                 if (taskBeingEdited) {
                     console.log("Handling update for task:", taskBeingEdited.id, taskData);
                     await updateRecurringTask(taskBeingEdited.id, taskData as RecurringTaskUpdate);
                     toast.success(`Task "${taskData.name}" updated.`);
                 } else {
                      console.error("Could not find task being edited with ID:", openDialog);
                      toast.error("Update failed", { description: "Could not find the task to update." });
                 }
            } else { // Otherwise, we are creating
                console.log("Handling creation:", taskData);
                await createRecurringTask(taskData as RecurringTaskCreate);
                toast.success(`Task "${taskData.name}" created.`);
            }
            setOpenDialog(null); // Close dialog on success
        } catch (error) {
             console.error("Error submitting task form:", error);
             // Keep dialog open on error? Or display error in dialog?
             // toast.error("Submission failed", { description: "Could not save the task."});
        }
   }

    // Helper to handle opening the edit dialog
    const openEditDialog = (task: RecurringTask) => {
        setEditingTask(task); // Store the task data for the form
        setOpenDialog(task.id); // Set the open dialog to the task's ID
    };

     // Helper to handle opening the create dialog
    const openCreateDialog = () => {
        setEditingTask(null); // Clear any previous edit data
        setOpenDialog('create'); // Set the open dialog to 'create'
    };

    // Helper to handle closing any dialog
    const closeDialog = () => {
        setOpenDialog(null);
        // No need to setEditingTask(null) here, handled when opening create or closing via onOpenChange
    };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle>Recurring Tasks</CardTitle>
              <CardDescription>
                Manage automated tasks for ingestion and classification.
              </CardDescription>
            </div>
            {/* --- Dialog for Creating New Task --- */}
            <Dialog open={openDialog === 'create'} onOpenChange={(open) => !open && closeDialog()}>
              <DialogTrigger asChild>
                {/* Use the helper to open the dialog */}
                <Button onClick={openCreateDialog}>
                  <Plus className="h-4 w-4 mr-2" />
                  New Task
                </Button>
              </DialogTrigger>
              {/* Render Dialog Content using the Form Component */}
               <RecurringTaskFormDialog
                    // Key prop can help reset form state when switching between create/edit
                    key={openDialog === 'create' ? 'create' : 'edit'}
                    onSubmit={handleFormSubmit}
                    initialData={undefined} // Pass undefined for create mode
                    // Pass the close function if the form needs to close itself
                    // onClose={closeDialog}
                />
            </Dialog>
            {/* --- End Dialog for Creating New Task --- */}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading && recurringTasks.length === 0 ? (
             <div className="flex items-center justify-center py-8">
               <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
               <span className="ml-2 text-muted-foreground">Loading tasks...</span>
             </div>
           ) : error ? (
             <div className="flex items-center justify-center py-8 text-destructive">
               <AlertCircle className="h-5 w-5 mr-2" />
               <span>Error loading tasks: {error}</span>
             </div>
           ) : !isLoading && recurringTasks.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No recurring classification tasks found.
            </div>
          ) : (
            <div className="space-y-4">
              {recurringTasks
                .filter(task => task.type === 'classify')
                .map(task => (
                  <Card key={task.id} className="overflow-hidden">
                    <CardHeader className="p-4 bg-muted/30 border-b">
                       <div className="flex justify-between items-start gap-2">
                         <div>
                            <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                               {task.name}
                               <Badge variant="secondary" className="capitalize">{task.type?.toLowerCase() ?? 'UNKNOWN'}</Badge>
                               {formatStatus(task.status)}
                            </CardTitle>
                            <CardDescription className="text-xs mt-1">
                                {task.description || 'No description.'} Schedule: <code className="text-xs font-mono bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">{task.schedule || 'N/A'}</code>
                            </CardDescription>
                          </div>
                          <div className="flex gap-1 flex-shrink-0">
                             <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                title={task.status === 'active' ? 'Pause Task' : 'Activate Task'}
                                onClick={() => handleToggleStatus(task.id, task.status ?? '')}
                                disabled={isLoading}
                             >
                               {task.status === 'active' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                             </Button>
                             {/* --- Dialog for Editing Task --- */}
                             {/* Use task.id to control open state */}
                             <Dialog open={openDialog === task.id} onOpenChange={(open) => !open && closeDialog()}>
                               <DialogTrigger asChild>
                                   <Button
                                       variant="ghost"
                                       size="icon"
                                       className="h-7 w-7"
                                       title="Edit Task"
                                       // Use the helper to open dialog and set data
                                       onClick={() => openEditDialog(task)}
                                       disabled={isLoading}
                                   >
                                     <Edit className="h-4 w-4" />
                                   </Button>
                               </DialogTrigger>
                               {/* Render Dialog Content only when this dialog is open */}
                               {/* Pass editingTask data when openDialog matches this task's id */}
                               {(openDialog === task.id && editingTask) && (
                                   <RecurringTaskFormDialog
                                        key={`edit-${task.id}`} // Key helps reset form state
                                        onSubmit={handleFormSubmit}
                                        initialData={editingTask} // Pass the task to edit
                                        // Pass close function if needed
                                        // onClose={closeDialog}
                                   />
                               )}
                             </Dialog>
                             {/* --- End Dialog for Editing Task --- */}
                             {/* Wrap the delete button in the AlertDialogTrigger */}
                             {/* <AlertDialogTrigger asChild> */}
                               <Button
                                   variant="ghost"
                                   size="icon"
                                   className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                                   title="Delete Task"
                                   onClick={() => setTaskToDelete(task)} // Keep onClick here to set state
                                   disabled={isLoading}
                               >
                                 <Trash2 className="h-4 w-4" />
                               </Button>
                             {/* </AlertDialogTrigger> */}
                          </div>
                       </div>
                    </CardHeader>
                    <CardContent className="p-4 text-sm space-y-2">
                      {/* Last Run Info */}
                      <div className="flex justify-between items-center text-xs text-muted-foreground">
                         <span>Last Run: {task.last_run_at ? formatDistanceToNow(new Date(task.last_run_at), { addSuffix: true }) : 'Never'}</span>
                         <span>Last Status: {formatStatus(task.last_run_status)}</span>
                      </div>
                      {task.last_run_message && (
                         <p className="text-xs bg-secondary p-2 rounded">Last Message: {task.last_run_message}</p>
                      )}
                      {/* Last Successful Run Info */}
                      <div className="flex justify-between items-center text-xs text-muted-foreground">
                         <span>Last Success: {task.last_successful_run_at ? formatDistanceToNow(new Date(task.last_successful_run_at), { addSuffix: true }) : 'Never'}</span>
                         {task.consecutive_failure_count && task.consecutive_failure_count > 0 ? (
                              <span className="text-destructive">Failures: {task.consecutive_failure_count}</span>
                         ) : null}
                      </div>
                      {/* Link to last job if applicable */}
                      {task.type === 'classify' && task.last_job_id && (
                          <div className="text-xs pt-1">
                              Last Run Job:
                              <Button variant="link" size="sm" className="h-auto px-1 py-0 text-xs" onClick={() => handleLoadJob(task.last_job_id)}>
                                  Job ID {task.last_job_id} <ExternalLink className="h-3 w-3 ml-1"/>
                              </Button>
                          </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!taskToDelete} onOpenChange={(open) => !open && setTaskToDelete(null)}>
        {/* <AlertDialogTrigger asChild>
            <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                title="Delete Task"
                onClick={() => setTaskToDelete(taskToDelete)}
                disabled={isLoading}
            >
            <Trash2 className="h-4 w-4" />
            </Button>
        </AlertDialogTrigger> */}
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the recurring task
              <span className="font-semibold"> "{taskToDelete?.name}"</span>.
              It will no longer run automatically.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setTaskToDelete(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">
               Delete Task
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
} 