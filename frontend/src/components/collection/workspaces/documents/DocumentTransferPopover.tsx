import { useState } from 'react';
import { Check, CopyIcon, FolderIcon, FolderInput} from 'lucide-react';
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
// Removed obsolete store import
// import { useDocumentStore } from '@/zustand_stores/storeDocuments';
// Removed obsolete service import
// import { DocumentsService } from '@/client/services';
import { toast } from 'sonner';
import { DataSource } from '@/lib/classification/types'; // Import DataSource type if needed

interface DocumentTransferPopoverProps {
  // Rename to reflect use with DataSources
  selectedDataSourceIds: number[]; 
  onComplete: () => void;
}

export function DocumentTransferPopover({ 
  selectedDataSourceIds,
  onComplete
}: DocumentTransferPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [targetWorkspaceId, setTargetWorkspaceId] = useState<string>('');
  const [isCopy, setIsCopy] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  
  const { workspaces, activeWorkspace } = useWorkspaceStore();
  // Removed obsolete store hook
  // const { fetchDocuments } = useDocumentStore();

  const handleTransfer = async () => {
    if (!activeWorkspace || !targetWorkspaceId || selectedDataSourceIds.length === 0) return; // Check length
    
    setIsLoading(true);
    try {
      // TODO: Rework this entire logic for transferring DataSources
      // This likely involves creating new DataSources in the target workspace
      // based on the selected items, and potentially copying associated DataRecords and files.
      /*
      await SomeDataSourceTransferService.transferDataSources({
        currentWorkspaceId: activeWorkspace.id,
        targetWorkspaceId: parseInt(targetWorkspaceId),
        dataSourceIds: selectedDataSourceIds, // Use correct prop
        copy: isCopy // Indicate copy or move
      });
      
      toast.success(`Data Sources ${isCopy ? 'copied' : 'moved'} successfully`);
      setIsOpen(false);
      onComplete(); // This will clear selection and refresh
      */
     toast.info("Transfer logic for Data Sources needs backend implementation.");
     // Simulate completion for UI update
     setIsOpen(false);
     onComplete();
    } catch (error) {
      toast.error(`Failed to ${isCopy ? 'copy' : 'move'} Data Sources`);
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  // Use id, not uid
  const availableWorkspaces = workspaces.filter(w => w.id !== activeWorkspace?.id);

  // Check selectedDataSourceIds length
  if (selectedDataSourceIds.length === 0) return null;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="ml-2" disabled={selectedDataSourceIds.length === 0}>
          <FolderInput className="h-4 w-4 mr-2" />
           {/* Update text */}
          Transfer {selectedDataSourceIds.length} selected
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <div className="space-y-4">
          <h4 className="font-medium">Transfer Data Sources</h4> {/* Updated title */}
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Target Workspace
            </label>
            <Select
              value={targetWorkspaceId}
              onValueChange={setTargetWorkspaceId}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select workspace" />
              </SelectTrigger>
              <SelectContent>
                {availableWorkspaces.map((workspace) => (
                  <SelectItem key={workspace.id} value={workspace.id.toString()}>
                    {workspace.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              size="sm"
              className={!isCopy ? "" : ""}
              onClick={() => setIsCopy(false)}
            >
              <FolderIcon className="h-4 w-4 mr-2" />
              Move
            </Button>
            <Button
              variant="outline"
              size="sm"
              className={isCopy ? "" : ""}
              onClick={() => setIsCopy(true)}
            >
              <CopyIcon className="h-4 w-4 mr-2" />
              Copy
            </Button>
          </div>
          <Button
            className="w-full"
            onClick={handleTransfer}
            disabled={!targetWorkspaceId || isLoading}
          >
            {isLoading ? (
              "Processing..."
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