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
import { useInfospaceStore } from '@/zustand_stores/storeInfospace';
import { BundlesService, AssetsService } from '@/client';
import useAuth from '@/hooks/useAuth';
import { toast } from 'sonner';

interface TransferItem {
  id: number;
  type: 'asset' | 'bundle';
  title: string;
}

interface AssetTransferPopoverProps {
  selectedAssetIds?: number[];
  selectedBundleIds?: number[];
  selectedItems?: TransferItem[]; // Alternative way to pass mixed items
  onComplete: () => void;
}

export function AssetTransferPopover({
  selectedAssetIds = [],
  selectedBundleIds = [],
  selectedItems = [],
  onComplete
}: AssetTransferPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [targetInfospaceId, setTargetInfospaceId] = useState<string>('');
  const [isCopy, setIsCopy] = useState(true); // Default to Copy for safety
  const [isLoading, setIsLoading] = useState(false);
  const [isCreatingInfospace, setIsCreatingInfospace] = useState(false); // State for creation mode
  const [newInfospaceName, setNewInfospaceName] = useState(''); // State for new Infospace name
  const { user } = useAuth();
  const { infospaces, activeInfospace, createInfospace } = useInfospaceStore();

  // Calculate total items to transfer
  const totalItems = selectedItems.length > 0 
    ? selectedItems.length 
    : selectedAssetIds.length + selectedBundleIds.length;

  const getItemDescription = () => {
    if (selectedItems.length > 0) {
      const assets = selectedItems.filter(item => item.type === 'asset').length;
      const bundles = selectedItems.filter(item => item.type === 'bundle').length;
      
      if (assets > 0 && bundles > 0) {
        return `${assets} asset${assets > 1 ? 's' : ''} and ${bundles} bundle${bundles > 1 ? 's' : ''}`;
      } else if (assets > 0) {
        return `${assets} asset${assets > 1 ? 's' : ''}`;
      } else {
        return `${bundles} bundle${bundles > 1 ? 's' : ''}`;
      }
    } else {
      const assetCount = selectedAssetIds.length;
      const bundleCount = selectedBundleIds.length;
      
      if (assetCount > 0 && bundleCount > 0) {
        return `${assetCount} asset${assetCount > 1 ? 's' : ''} and ${bundleCount} bundle${bundleCount > 1 ? 's' : ''}`;
      } else if (assetCount > 0) {
        return `${assetCount} asset${assetCount > 1 ? 's' : ''}`;
      } else {
        return `${bundleCount} bundle${bundleCount > 1 ? 's' : ''}`;
      }
    }
  };

  const handleTransfer = async () => {
    setIsLoading(true);

    let finalTargetId: number | null = targetInfospaceId ? parseInt(targetInfospaceId, 10) : null;

    if (isCreatingInfospace) {
      if (!newInfospaceName.trim()) {
        toast.error('New infospace name cannot be empty.');
        setIsLoading(false);
        return;
      }
      if (!user) {
        toast.error("User not authenticated.");
        setIsLoading(false);
        return;
      }
      try {
        const newInfospace = await createInfospace({
          name: newInfospaceName,
          owner_id: user.id,
        });

        if (!newInfospace) {
          toast.error('Failed to create new infospace.');
          setIsLoading(false);
          return;
        }
        toast.success(`Infospace "${newInfospace.name}" created.`);
        finalTargetId = newInfospace.id;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Error creating infospace.";
        toast.error(message);
        setIsLoading(false);
        return;
      }
    }

    if (!finalTargetId) {
      toast.error('No target infospace selected.');
      setIsLoading(false);
      return;
    }

    const items = selectedItems.length > 0
        ? selectedItems
        : [
            ...selectedAssetIds.map(id => ({ id, type: 'asset' as const, title: `Asset ${id}` })),
            ...selectedBundleIds.map(id => ({ id, type: 'bundle' as const, title: `Bundle ${id}` }))
          ];

    const assetsToTransfer = items.filter(i => i.type === 'asset').map(i => i.id);
    const bundlesToTransfer = items.filter(i => i.type === 'bundle').map(i => i.id);
    const transferPromises: Promise<any>[] = [];

    if (bundlesToTransfer.length > 0) {
      bundlesToTransfer.forEach(bundleId => {
        transferPromises.push(
          BundlesService.transferBundle({ 
            bundleId, 
            targetInfospaceId: finalTargetId!, 
            copy: isCopy  // When copy=true, both bundle and assets are copied
          })
        );
      });
    }

    if (assetsToTransfer.length > 0) {
      if (!activeInfospace) {
        toast.error("Cannot determine source infospace for asset transfer.");
        setIsLoading(false);
        return;
      }
      // Direct asset transfer - no temporary bundles needed!
      const assetTransferPromise = AssetsService.transferAssets({
        requestBody: {
          asset_ids: assetsToTransfer,
          source_infospace_id: activeInfospace.id,
          target_infospace_id: finalTargetId!,
          copy: isCopy,
        }
      });
      transferPromises.push(assetTransferPromise);
    }

    try {
      await Promise.all(transferPromises);
      const itemDescription = getItemDescription();
      const action = isCopy ? 'Copied' : 'Moved';
      const destinationInfospace = infospaces.find(w => w.id === finalTargetId)?.name || newInfospaceName;
      
      toast.success(`${action} ${itemDescription} to "${destinationInfospace}".`);

    } catch (error) {
       const message = error instanceof Error ? error.message : "An unknown error occurred during transfer.";
       toast.error(`Transfer failed: ${message}`);
    } finally {
      setIsLoading(false);
      setIsOpen(false);
      onComplete();
    }
  };

  const availableInfospaces = infospaces.filter(w => w.id !== activeInfospace?.id);

  const isButtonDisabled = totalItems === 0;

  const isConfirmDisabled = isLoading ||
                            totalItems === 0 ||
                            (isCreatingInfospace && !newInfospaceName.trim()) ||
                            (!isCreatingInfospace && !targetInfospaceId);

  return (
    <Popover open={isOpen} onOpenChange={(open) => {
        setIsOpen(open);
        if (!open) {
            setIsCreatingInfospace(false);
            setNewInfospaceName('');
            setTargetInfospaceId('');
        }
    }}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 px-2" disabled={isButtonDisabled}>
          <FolderInput className="h-3.5 w-3.5 mr-1" />
          {isButtonDisabled ? 'Transfer' : `Transfer (${totalItems})`}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <div className="space-y-4">
          <h4 className="font-medium leading-none">Transfer Items</h4>
          <p className="text-xs text-muted-foreground">
             {isCopy ? "Copy" : "Move"} {getItemDescription()} to {isCreatingInfospace ? 'a new' : 'another'} Infospace.
          </p>

          <div className="space-y-2">
            <label htmlFor="target-Infospace" className="text-sm font-medium">
              Target Infospace
            </label>
            {!isCreatingInfospace ? (
              <div className="flex items-center gap-2">
                 <Select
                   value={targetInfospaceId}
                   onValueChange={setTargetInfospaceId}
                   disabled={isLoading}
                 >
                   <SelectTrigger id="target-Infospace">
                     <SelectValue placeholder="Select existing..." />
                   </SelectTrigger>
                   <SelectContent>
                     {availableInfospaces.length > 0 ? (
                       availableInfospaces.map((infospace) => (
                         <SelectItem key={infospace.id} value={infospace.id.toString()}>
                           {infospace.name}
                         </SelectItem>
                       ))
                     ) : (
                       <div className="p-4 text-center text-sm text-muted-foreground">No other Infospaces available.</div>
                     )}
                   </SelectContent>
                 </Select>
                 <Button variant="ghost" size="sm" onClick={() => setIsCreatingInfospace(true)} className="text-xs" title="Create New Infospace">
                     <PlusCircle className="h-4 w-4 mr-1" /> New
                 </Button>
              </div>
            ) : (
               <div className="flex items-center gap-2">
                   <Input
                      id="new-Infospace-name"
                      placeholder="New Infospace name..."
                      value={newInfospaceName}
                      onChange={(e) => setNewInfospaceName(e.target.value)}
                      disabled={isLoading}
                      className="h-9"
                   />
                   <Button variant="ghost" size="sm" onClick={() => { setIsCreatingInfospace(false); setNewInfospaceName(''); }} className="text-xs" title="Cancel Creation">
                      Cancel
                   </Button>
               </div>
            )}
          </div>

          <div className="flex items-center space-x-2">
             <Button
               variant={!isCopy ? "destructive" : "outline"}
               size="sm"
               onClick={() => setIsCopy(false)}
               className="flex-1"
               disabled={isLoading}
             >
               <FolderIcon className="h-4 w-4 mr-2" />
               Move
             </Button>
             <Button
               variant={isCopy ? "default" : "outline"}
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
            disabled={isConfirmDisabled}
          >
            {isLoading ? (
               <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                   {isCreatingInfospace ? 'Creating & Transferring...' : 'Processing...'}
               </>
            ) : (
              <>
                <Check className="h-4 w-4 mr-2" />
                Confirm {isCopy ? "Copy" : "Move"} {isCreatingInfospace ? 'to New Infospace' : ''}
              </>
            )}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
} 