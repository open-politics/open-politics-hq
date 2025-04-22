'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import DocumentManager from './DocumentManager';
import { Button } from '@/components/ui/button';
import { useWorkspaceStore } from '@/zustand_stores/storeWorkspace';
import { DataSourceRead } from '@/client/models';
import { DataSource } from '@/lib/classification/types';
import CreateDataSourceDialog from './DocumentCreateDataSourceDialog';
import { PlusCircle } from 'lucide-react';

interface DataSourcesOverlayProps {
  open: boolean;
  onClose: () => void;
  onDataSourceSelect?: (dataSource: DataSource) => void;
}

export default function DataSourcesOverlay({ open, onClose, onDataSourceSelect }: DataSourcesOverlayProps) {
  const { activeWorkspace } = useWorkspaceStore();
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  useEffect(() => {
    console.log('DataSourcesOverlay open state:', open);
  }, [open]);

  if (!activeWorkspace) {
    return null;
  }

  const handleDataSourceSelect = (dataSource: DataSource) => {
    console.log(`Selected item: DataSource ${dataSource.id} - ${dataSource.name}`);
    onDataSourceSelect?.(dataSource);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="z-[100] max-w-[80vw] w-full h-[85vh] max-h-[900px] flex flex-col p-0">
          <DialogHeader className="p-6 pb-4 border-b">
            <div className="flex justify-between items-center">
              <DialogTitle className="text-xl font-semibold">
                Data Sources in {activeWorkspace.name}
              </DialogTitle>
              <Button size="sm" onClick={() => setIsCreateOpen(true)}>
                 <PlusCircle className="h-4 w-4 mr-2" />
                 Add Data Source
              </Button>
            </div>
          </DialogHeader>

          <div className="flex-grow overflow-hidden">
            <DocumentManager
              onDataSourceSelect={handleDataSourceSelect}
            />
          </div>
        </DialogContent>
      </Dialog>

      <CreateDataSourceDialog
         open={isCreateOpen}
         onClose={() => setIsCreateOpen(false)}
      />
    </>
  );
}