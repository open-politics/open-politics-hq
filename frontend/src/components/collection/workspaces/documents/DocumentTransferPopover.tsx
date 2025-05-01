import { useState } from 'react';
import { Check, CopyIcon, FolderIcon, FolderInput, Loader2, PlusCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from "@/components/ui/input";
import { useWorkspaceStore } from '@/zustand_stores/storeWorkspace';
// --- ADDED: Import necessary client services and models ---
import { WorkspacesService } from '@/client/services';
import { DataSourceTransferRequest, DataSourceTransferResponse } from '@/client/models';
// --- END ADDED ---
import { toast } from 'sonner';
// Removed unused DataSource import from types
// import { DataSource } from '@/lib/classification/types';

interface DocumentTransferPopoverProps {
  selectedDataSourceIds: number[];
  onComplete: () => void;
}

export function DocumentTransferPopover({
  selectedDataSourceIds,
  onComplete
}: DocumentTransferPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [targetWorkspaceId, setTargetWorkspaceId] = useState<string>('');
  const [isCopy, setIsCopy] = useState(true); // Default to Copy for safety
  const [isLoading, setIsLoading] = useState(false);
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false); // State for creation mode
  const [newWorkspaceName, setNewWorkspaceName] = useState(''); // State for new workspace name

  const { workspaces, activeWorkspace, createWorkspace } = useWorkspaceStore();

  const handleTransfer = async () => {
    if (!activeWorkspace || selectedDataSourceIds.length === 0) {
       toast.warning("Please select data sources.");
       return;
    }

    setIsLoading(true);
    let finalTargetWorkspaceId: number | null = null;

    try {
        // --- Logic for Creating Workspace ---
        if (isCreatingWorkspace) {
            if (!newWorkspaceName.trim()) {
                toast.warning("Please enter a name for the new workspace.");
                setIsLoading(false);
                return;
            }
            console.log(`Creating new workspace: ${newWorkspaceName}`);
            const createdWorkspace = await createWorkspace({ name: newWorkspaceName, description: '' }); // Pass required fields
            if (!createdWorkspace) {
                // Error is handled within the store, but we stop the process here
                toast.error("Failed to create the new workspace.");
                setIsLoading(false);
                return;
            }
            console.log("New workspace created:", createdWorkspace);
            finalTargetWorkspaceId = createdWorkspace.id;
            setNewWorkspaceName(''); // Clear input
            setIsCreatingWorkspace(false); // Exit creation mode
            // Optionally, you might want to refresh the workspace list in the dropdown
            // but the store already calls fetchWorkspaces, so the list *should* update
            // on next open or if we manually trigger a refresh here.
            // For now, we'll proceed with the transfer using the new ID.
        } else {
            // --- Logic for Existing Workspace ---
            if (!targetWorkspaceId) {
                toast.warning("Please select a target workspace or create a new one.");
                setIsLoading(false);
                return;
            }
            const targetWsIdNum = parseInt(targetWorkspaceId, 10);
            if (isNaN(targetWsIdNum)) {
                toast.error("Invalid target workspace selected.");
                setIsLoading(false);
                return;
            }
            finalTargetWorkspaceId = targetWsIdNum;
        }

        if (finalTargetWorkspaceId === null) {
             toast.error("Target workspace ID could not be determined.");
             setIsLoading(false);
             return;
        }

        // --- Transfer Logic (Common) ---
        console.log(`Initiating ${isCopy ? 'copy' : 'move'} of DataSources:`, selectedDataSourceIds);
        console.log(`From Workspace: ${activeWorkspace.id} to Workspace: ${finalTargetWorkspaceId}`);

        const requestBody: DataSourceTransferRequest = {
            source_workspace_id: activeWorkspace.id,
            target_workspace_id: finalTargetWorkspaceId,
            datasource_ids: selectedDataSourceIds,
            copy: isCopy
        };

        const response: DataSourceTransferResponse = await WorkspacesService.transferDatasourcesEndpoint({
            requestBody: requestBody
        });

        if (response.success) {
            toast.success(response.message || `Data Sources ${isCopy ? 'copied' : 'moved'} successfully.`);
            setIsOpen(false);
            onComplete();
        } else {
            const errorDetails = response.errors
                ? Object.entries(response.errors).map(([id, msg]) => `DS ${id}: ${msg}`).join(', ')
                : 'No specific details provided.';
            toast.error(response.message || `Failed to ${isCopy ? 'copy' : 'move'} some or all Data Sources.`, {
                description: errorDetails,
            });
            setIsOpen(false);
            onComplete();
        }

    } catch (error: any) {
        console.error("Transfer or Workspace Creation API call failed:", error);
        const errorMsg = error?.body?.detail || `An unexpected error occurred during the ${isCreatingWorkspace ? 'workspace creation or ' : ''}transfer process.`;
        toast.error("Operation Failed", { description: errorMsg });
        // Keep popover open on critical failure? Maybe, depends on UX preference.
    } finally {
        setIsLoading(false);
    }
  };
  // --- END UPDATED ---

  // Use id, not uid
  const availableWorkspaces = workspaces.filter(w => w.id !== activeWorkspace?.id);

  // Disable button if nothing selected
  const isButtonDisabled = selectedDataSourceIds.length === 0;

  // Determine if Confirm button should be disabled
  const isConfirmDisabled = isLoading ||
                            selectedDataSourceIds.length === 0 ||
                            (isCreatingWorkspace && !newWorkspaceName.trim()) ||
                            (!isCreatingWorkspace && !targetWorkspaceId);

  return (
    <Popover open={isOpen} onOpenChange={(open) => {
        setIsOpen(open);
        // Reset creation state when popover closes
        if (!open) {
            setIsCreatingWorkspace(false);
            setNewWorkspaceName('');
            setTargetWorkspaceId(''); // Also clear selection
        }
    }}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="ml-2 h-7 px-2" disabled={isButtonDisabled}>
          <FolderInput className="h-3.5 w-3.5 mr-1" />
           {isButtonDisabled ? 'Transfer' : `${selectedDataSourceIds.length}`}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <div className="space-y-4">
          <h4 className="font-medium leading-none">Transfer Data Sources</h4>
          <p className="text-xs text-muted-foreground">
             {isCopy ? "Copy" : "Move"} {selectedDataSourceIds.length} data source(s) to {isCreatingWorkspace ? 'a new' : 'another'} workspace.
          </p>

          {/* --- Target Workspace Selection / Creation --- */}
          <div className="space-y-2">
            <label htmlFor="target-workspace" className="text-sm font-medium">
              Target Workspace
            </label>
            {!isCreatingWorkspace ? (
              <div className="flex items-center gap-2">
                 <Select
                   value={targetWorkspaceId}
                   onValueChange={setTargetWorkspaceId}
                   disabled={isLoading}
                 >
                   <SelectTrigger id="target-workspace">
                     <SelectValue placeholder="Select existing..." />
                   </SelectTrigger>
                   <SelectContent>
                     {availableWorkspaces.length > 0 ? (
                       availableWorkspaces.map((workspace) => (
                         <SelectItem key={workspace.id} value={workspace.id.toString()}>
                           {workspace.name}
                         </SelectItem>
                       ))
                     ) : (
                       <div className="p-4 text-center text-sm text-muted-foreground">No other workspaces available.</div>
                     )}
                   </SelectContent>
                 </Select>
                 <Button variant="ghost" size="sm" onClick={() => setIsCreatingWorkspace(true)} className="text-xs" title="Create New Workspace">
                     <PlusCircle className="h-4 w-4 mr-1" /> New
                 </Button>
              </div>
            ) : (
               <div className="flex items-center gap-2">
                   <Input
                      id="new-workspace-name"
                      placeholder="New workspace name..."
                      value={newWorkspaceName}
                      onChange={(e) => setNewWorkspaceName(e.target.value)}
                      disabled={isLoading}
                      className="h-9" // Match select trigger height
                   />
                   <Button variant="ghost" size="sm" onClick={() => { setIsCreatingWorkspace(false); setNewWorkspaceName(''); }} className="text-xs" title="Cancel Creation">
                      Cancel
                   </Button>
               </div>
            )}
          </div>
          {/* --- End Target Workspace --- */}


          {/* Simpler Move/Copy Toggle using Button variant */}
          <div className="flex items-center space-x-2">
             <Button
               variant={!isCopy ? "destructive" : "outline"} // Use destructive variant for Move
               size="sm"
               onClick={() => setIsCopy(false)}
               className="flex-1"
               disabled={isLoading}
             >
               <FolderIcon className="h-4 w-4 mr-2" />
               Move
             </Button>
             <Button
               variant={isCopy ? "default" : "outline"} // Highlight the active choice (Copy)
               size="sm"
               onClick={() => setIsCopy(true)}
               className="flex-1"
               disabled={isLoading}
             >
               <CopyIcon className="h-4 w-4 mr-2" />
               Copy
             </Button>
          </div>
          <Button
            className="w-full"
            onClick={handleTransfer}
            disabled={isConfirmDisabled} // Updated disabled logic
          >
            {isLoading ? (
               <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                   {isCreatingWorkspace ? 'Creating & Transferring...' : 'Processing...'}
               </>
            ) : (
              <>
                <Check className="h-4 w-4 mr-2" />
                Confirm {isCopy ? "Copy" : "Move"} {isCreatingWorkspace ? 'to New Workspace' : ''}
              </>
            )}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
} 