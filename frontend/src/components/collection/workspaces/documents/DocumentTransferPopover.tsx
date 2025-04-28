import { useState } from 'react';
import { Check, CopyIcon, FolderIcon, FolderInput, Loader2 } from 'lucide-react';
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

  const { workspaces, activeWorkspace } = useWorkspaceStore();

  const handleTransfer = async () => {
    if (!activeWorkspace || !targetWorkspaceId || selectedDataSourceIds.length === 0) {
       toast.warning("Please select data sources and a target workspace.");
       return;
    }

    setIsLoading(true);
    const targetWsIdNum = parseInt(targetWorkspaceId, 10); // Convert to number
    if (isNaN(targetWsIdNum)) {
        toast.error("Invalid target workspace selected.");
        setIsLoading(false);
        return;
    }

    // --- UPDATED: Use the actual backend service ---
    try {
      console.log(`Initiating ${isCopy ? 'copy' : 'move'} of DataSources:`, selectedDataSourceIds);
      console.log(`From Workspace: ${activeWorkspace.id} to Workspace: ${targetWsIdNum}`);

      // Construct the request body
      const requestBody: DataSourceTransferRequest = {
         source_workspace_id: activeWorkspace.id,
         target_workspace_id: targetWsIdNum,
         datasource_ids: selectedDataSourceIds,
         copy: isCopy
      };

      // Call the backend service
      // Assuming the client service method is named 'transferDatasourcesEndpoint'
      const response: DataSourceTransferResponse = await WorkspacesService.transferDatasourcesEndpoint({
          requestBody: requestBody // Pass the data nested under requestBody
      });

      if (response.success) {
          toast.success(response.message || `Data Sources ${isCopy ? 'copied' : 'moved'} successfully.`);
          setIsOpen(false);
          onComplete(); // This will clear selection and refresh source/target lists possibly
      } else {
          // Handle partial or full failure reported by the backend
          const errorDetails = response.errors
              ? Object.entries(response.errors).map(([id, msg]) => `DS ${id}: ${msg}`).join(', ')
              : 'No specific details provided.';
          toast.error(response.message || `Failed to ${isCopy ? 'copy' : 'move'} some or all Data Sources.`, {
              description: errorDetails,
          });
           // Keep popover open on partial failure? Or close? Let's close for now.
          setIsOpen(false);
          onComplete(); // Still call onComplete to potentially refresh lists
      }

    } catch (error: any) {
      // Handle network errors or unexpected backend errors (e.g., 500)
      console.error("Transfer API call failed:", error);
      const errorMsg = error?.body?.detail || `Failed to ${isCopy ? 'copy' : 'move'} Data Sources due to a network or server error.`;
      toast.error("Transfer Failed", { description: errorMsg });
      // Keep popover open on critical failure?
    } finally {
      setIsLoading(false);
    }
  };
  // --- END UPDATED ---

  // Use id, not uid
  const availableWorkspaces = workspaces.filter(w => w.id !== activeWorkspace?.id);

  // Disable button if nothing selected
  const isButtonDisabled = selectedDataSourceIds.length === 0;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="ml-2" disabled={isButtonDisabled}>
          <FolderInput className="h-4 w-4 mr-2" />
           {isButtonDisabled ? 'Transfer' : `Transfer ${selectedDataSourceIds.length} selected`}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <div className="space-y-4">
          <h4 className="font-medium leading-none">Transfer Data Sources</h4>
          <p className="text-xs text-muted-foreground">
             {isCopy ? "Copy" : "Move"} the selected data sources to another workspace. Moving will delete them from the current workspace.
          </p>
          <div className="space-y-2">
            <label htmlFor="target-workspace" className="text-sm font-medium">
              Target Workspace
            </label>
            <Select
              value={targetWorkspaceId}
              onValueChange={setTargetWorkspaceId}
            >
              <SelectTrigger id="target-workspace">
                <SelectValue placeholder="Select workspace..." />
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
          </div>
          {/* Simpler Move/Copy Toggle using Button variant */}
          <div className="flex items-center space-x-2">
             <Button
               variant={!isCopy ? "destructive" : "outline"} // Use destructive variant for Move
               size="sm"
               onClick={() => setIsCopy(false)}
               className="flex-1"
             >
               <FolderIcon className="h-4 w-4 mr-2" />
               Move
             </Button>
             <Button
               variant={isCopy ? "default" : "outline"} // Highlight the active choice (Copy)
               size="sm"
               onClick={() => setIsCopy(true)}
               className="flex-1"
             >
               <CopyIcon className="h-4 w-4 mr-2" />
               Copy
             </Button>
          </div>
          <Button
            className="w-full"
            onClick={handleTransfer}
            disabled={!targetWorkspaceId || isLoading || availableWorkspaces.length === 0}
          >
            {isLoading ? (
               <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processing...
               </>
            ) : (
              <>
                <Check className="h-4 w-4 mr-2" />
                Confirm {isCopy ? "Copy" : "Move"}
              </>
            )}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
} 